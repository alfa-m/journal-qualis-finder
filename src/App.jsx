import React, { useMemo, useState } from "react";
import { ProviderRegistry } from "./core/providerRegistry.js";
import { appConfig } from "./config/appConfig.js";
import { createQualisLocalProvider } from "./providers/qualisLocalProvider.js";
import { createSpringerProvider } from "./providers/springerProvider.js";
import { createRecommenderBasicProvider } from "./providers/recommenderBasicProvider.js";
import { createSpringerQualisRecommenderProvider } from "./providers/springerQualisRecommenderProvider.js";

export default function App() {

const registry = useMemo(() => {
  const r = new ProviderRegistry();

  // Recomendação real por tema:
  r.register(createSpringerQualisRecommenderProvider());

  // (Opcional) manter consulta direta ao Qualis por nome do periódico:
  // r.register(createQualisLocalProvider());

  // (Opcional) manter Springer's raw provider:
  // r.register(createSpringerProvider());

  return r;
}, []);


  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [area, setArea] = useState("");
  const [minQualis, setMinQualis] = useState("");
  const [error, setError] = useState("");

  async function onSearch() {
    setError("");
    setLoading(true);
    try {
      const results = await registry.runAll(text, {
        area,
        minQualis,
        maxResults: appConfig.maxResults
      });

      // Merge por ISSN/título (bem simples)
      const byKey = new Map();
      for (const r of results) {
        const key = (r.issn || "").trim() || r.journalTitle;
        const prev = byKey.get(key);

        if (!prev) byKey.set(key, r);
        else {
          // “enriquece”: se um provider trouxe qualis e outro trouxe URL, junta.
          byKey.set(key, {
            ...prev,
            ...r,
            qualis: prev.qualis || r.qualis,
            area: prev.area || r.area,
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
          Cole um título/abstract/ideia e receba periódicos sugeridos + classificação Qualis.
          (Base inicial: Qualis via JSON local; Springer via API quando configurada.)
        </small>

        <div style={{ height: 12 }} />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: 'Explainable AI para diagnóstico médico usando Grad-CAM e CNN...' "
        />

        <div style={{ height: 12 }} />

        <div className="row">
          <div className="grow">
            <label>
              <small>Área (opcional)</small>
            </label>
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Ex.: CIÊNCIA DA COMPUTAÇÃO"
              style={{ width: "100%" }}
            />
          </div>

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

        {error ? (
          <p style={{ color: "crimson", marginTop: 10 }}>{error}</p>
        ) : null}

        <ResultsTable rows={rows} />
      </div>

      <div style={{ height: 14 }} />

      <div className="card">
        <h1>Como evoluir esse projeto</h1>
        <ul>
          <li>
            Substituir o <span className="badge">qualis.sample.json</span> por um JSON real do Qualis (por quadriênio e área).
          </li>
          <li>
            Trocar o <span className="badge">recommender-basic</span> por embeddings (ex.: TF-IDF, sentence transformers via serviço, etc.).
          </li>
          <li>
            Adicionar novos providers (Scopus, DOAJ, Semantic Scholar, OpenAlex, etc.) usando o mesmo contrato.
          </li>
        </ul>
      </div>
    </div>
  );
}

function ResultsTable({ rows }) {
  if (!rows?.length) {
    return <p style={{ marginTop: 12 }}><small>Nenhum resultado ainda.</small></p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Periódico</th>
          <th>ISSN</th>
          <th>Área</th>
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
            <td>{r.area || "-"}</td>
            <td>
              {r.qualis ? <span className="badge">{r.qualis}</span> : "-"}
              {r.event ? <div><small>{r.event}</small></div> : null}
            </td>
            <td><small>{r.provider}</small></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
