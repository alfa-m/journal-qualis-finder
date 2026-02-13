import React, { useMemo, useState } from "react";
import { ProviderRegistry } from "./core/providerRegistry.js";
import { appConfig } from "./config/appConfig.js";
import { createSpringerQualisRecommenderProvider } from "./providers/springerQualisRecommenderProvider.js";

export default function App() {
  const registry = useMemo(() => {
    const r = new ProviderRegistry();
    r.register(createSpringerQualisRecommenderProvider());
    return r;
  }, []);

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [minQualis, setMinQualis] = useState("");
  const [error, setError] = useState("");

  async function onSearch() {
    setError("");
    setLoading(true);

    try {
      const results = await registry.runAll(text, {
        minQualis,
        maxResults: appConfig.maxResults,
        // respeita plano grátis: provider vai capar em 25 e paginar
        p: appConfig.springerPageSize,
        maxPages: appConfig.springerMaxPages
      });

      // Merge por ISSN/título
      const byKey = new Map();
      for (const r of results) {
        const key = (r.issn || "").trim() || r.journalTitle;
        const prev = byKey.get(key);

        if (!prev) byKey.set(key, r);
        else {
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
    <div className="container">
      <div className="card">
        <h1>Journal + Qualis Finder</h1>
        <small>
          Cole um título/abstract/ideia e receba periódicos sugeridos + classificação
          Qualis (via cruzamento com a base local).
        </small>

        <div style={{ height: 12 }} />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: 'Off-grid systems'"
        />

        <div style={{ height: 12 }} />

        <div className="row">
          <div>
            <label>
              <small>Qualis mínimo</small>
            </label>
            <select value={minQualis} onChange={(e) => setMinQualis(e.target.value)}>
              <option value="">(qualquer)</option>
              <option value="A1">A1</option>
              <option value="A2">A2</option>
              <option value="A3">A3</option>
              <option value="A4">A4</option>
              <option value="B1">B1</option>
              <option value="B2">B2</option>
              <option value="B3">B3</option>
              <option value="B4">B4</option>
              <option value="C">C</option>
            </select>
          </div>

          <div style={{ alignSelf: "flex-end" }}>
            <button onClick={onSearch} disabled={loading || !text.trim()}>
              {loading ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <small>
            Plano grátis Springer: busca paginada com p={appConfig.springerPageSize} e até{" "}
            {appConfig.springerMaxPages} páginas.
          </small>
        </div>

        {error ? <p style={{ color: "crimson", marginTop: 10 }}>{error}</p> : null}

        <ResultsTable rows={rows} />
      </div>
    </div>
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
