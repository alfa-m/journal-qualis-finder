import React, { useMemo, useState } from "react";
import { ProviderRegistry } from "./core/providerRegistry.js";
import { appConfig } from "./config/appConfig.js";
import { createQualisLocalProvider } from "./providers/qualisLocalProvider.js";
import { createSpringerProvider } from "./providers/springerProvider.js";
import { createRecommenderBasicProvider } from "./providers/recommenderBasicProvider.js";
import { createSpringerQualisRecommenderProvider } from "./providers/springerQualisRecommenderProvider.js";
import React, { useEffect, useMemo, useState } from "react";
import { loadQualisCatalog, findQualisFile } from "./core/qualisCatalog.js";

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [periodId, setPeriodId] = useState("");
  const [areaId, setAreaId] = useState("");

  useEffect(() => {
    loadQualisCatalog().then((c) => {
      setCatalog(c);
      // define defaults
      const p0 = c?.periods?.[0];
      const a0 = p0?.areas?.[0];
      if (p0?.id) setPeriodId(p0.id);
      if (a0?.id) setAreaId(a0.id);
    }).catch(console.error);
  }, []);

  const areaOptions = catalog?.periods?.find(p => p.id === periodId)?.areas ?? [];
  const qualisFile = catalog ? findQualisFile(catalog, periodId, areaId) : null;

  async function onSearch() {
    setError("");
    setLoading(true);
    try {
      const results = await registry.runAll(text, {
      minQualis,
      maxResults: appConfig.maxResults,
      qualisFile
    });

      // Merge por ISSN/título
      const byKey = new Map();
      for (const r of results) {
        const key = (r.issn || "").trim() || r.journalTitle;
        const prev = byKey.get(key);

        if (!prev) byKey.set(key, r);
        else {
          // se um provider trouxe qualis e outro trouxe URL, junta.
          byKey.set(key, {
            ...prev,
            ...r,
            qualis: prev.qualis || r.qualis,
            url: prev.url || r.url,
            provider: `${prev.provider}+${r.provider}`,
            score: Math.max(prev.score || 0, r.score || 0)
          });
        }
      }

      const merged = Array.from(byKey.values())
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, appConfig.maxResults);

      setRows(merged);
    } catch (e) {
      setError(e?.message || "Erro ao buscar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="row">
        <div>
          <label><small>Período (Evento de Classificação)</small></label>
          <select value={periodId} onChange={(e)=>{ setPeriodId(e.target.value); setAreaId(""); }}>
            <option value="" disabled>Selecione</option>
            {catalog?.periods?.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label><small>Área</small></label>
          <select value={areaId} onChange={(e)=>setAreaId(e.target.value)} disabled={!periodId}>
            <option value="" disabled>Selecione</option>
            {areaOptions.map(a => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
      </div>
      {/* resto do seu UI */}
    </>
  );
}

function ResultsTable({ rows }) {
  if (!rows?.length) {
    return (
      <p style={{ marginTop: 12 }}>
        <small>Nenhum resultado ainda.</small>
      </p>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Periódico</th>
          <th>ISSN</th>
          <th>Qualis</th>
          <th>Fonte</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.journalTitle}-${i}`}>
            <td>
              <div style={{ fontWeight: 600 }}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.journalTitle}
                  </a>
                ) : (
                  r.journalTitle
                )}
              </div>
              <small>score: {(r.score ?? 0).toFixed(2)}</small>
            </td>
            <td>{r.issn || "-"}</td>
            <td>{r.qualis ? <span className="badge">{r.qualis}</span> : "-"}</td>
            <td>
              <small>{r.provider}</small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
