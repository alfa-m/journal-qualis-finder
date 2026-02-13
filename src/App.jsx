// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ProviderRegistry } from "./core/providerRegistry.js";
import { appConfig } from "./config/appConfig.js";
import { loadQualisCatalog, findQualisFile } from "./core/qualisCatalog.js";
import { createSpringerQualisRecommenderProvider } from "./providers/springerQualisRecommenderProvider.js";

export default function App() {
  // Providers
  const registry = useMemo(() => {
    const r = new ProviderRegistry();
    r.register(createSpringerQualisRecommenderProvider());
    return r;
  }, []);

  // Input + UI state
  const [text, setText] = useState("");
  const [minQualis, setMinQualis] = useState("");
  const [onlyWithQualis, setOnlyWithQualis] = useState(true);

  // Qualis Catalog (período/área)
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState("");

  const [periodId, setPeriodId] = useState("");
  const [areaId, setAreaId] = useState("");

  // Results + status
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const [meta, setMeta] = useState({
    qualisFile: null,
    qualisCount: null,
    springerRecords: null
  });

  // Load Qualis catalog on mount
  useEffect(() => {
    let mounted = true;

    loadQualisCatalog()
      .then((c) => {
        if (!mounted) return;
        setCatalog(c);
        setCatalogError("");

        // defaults: 1º período e 1ª área
        const p0 = c?.periods?.[0];
        const a0 = p0?.areas?.[0];

        if (p0?.id) setPeriodId(p0.id);
        if (a0?.id) setAreaId(a0.id);
      })
      .catch((e) => {
        if (!mounted) return;
        setCatalogError(e?.message || "Falha ao carregar qualis/index.json");
      });

    return () => {
      mounted = false;
    };
  }, []);

  const periodOptions = catalog?.periods || [];
  const areaOptions = periodOptions.find((p) => p.id === periodId)?.areas || [];

  const qualisFile = catalog ? findQualisFile(catalog, periodId, areaId) : null;

  async function onSearch() {
    setError("");
    setRows([]);
    setMeta({ qualisFile: qualisFile || null, qualisCount: null, springerRecords: null });

    if (!qualisFile) {
      setError("Selecione um período e uma área do Qualis.");
      return;
    }

    setLoading(true);
    try {
      const results = await registry.runAll(text, {
        minQualis,
        onlyWithQualis,
        maxResults: appConfig.maxResults,
        qualisFile,
        onMeta: (m) => setMeta((prev) => ({ ...prev, ...m }))
      });

      // Merge por ISSN/título (mantém o melhor score e completa campos)
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

  function exportCSV() {
    const header = ["journalTitle", "issn", "qualis", "provider", "url", "score"];
    const lines = [
      header.join(","),
      ...rows.map((r) => header.map((k) => csvEscape(r[k])).join(","))
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `journal_qualis_${periodId || "period"}_${areaId || "area"}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Journal + Qualis Finder</h1>
        <small>
          Cole um título/abstract/ideia e receba periódicos sugeridos via Springer + cruzamento com Qualis.
        </small>

        <div style={{ height: 12 }} />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Cole aqui seu título/abstract/ideia…"
        />

        <div style={{ height: 12 }} />

        {/* Seletores de Período/Área + Filtros + Ações */}
        <div className="row">
          <div>
            <label>
              <small>Período (Evento de Classificação)</small>
            </label>
            <select
              value={periodId}
              onChange={(e) => {
                const newPeriod = e.target.value;
                setPeriodId(newPeriod);

                // reseta área para a primeira área do novo período
                const nextAreas =
                  (catalog?.periods || []).find((p) => p.id === newPeriod)?.areas || [];
                setAreaId(nextAreas?.[0]?.id || "");
              }}
              disabled={!periodOptions.length}
            >
              {!periodOptions.length ? <option value="">Carregando…</option> : null}
              {periodOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>
              <small>Área</small>
            </label>
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              disabled={!periodId || !areaOptions.length}
            >
              {!areaOptions.length ? <option value="">Selecione um período</option> : null}
              {areaOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
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
            <button
              onClick={onSearch}
              disabled={loading || !text.trim() || !periodId || !areaId}
            >
              {loading ? "Buscando..." : "Buscar"}
            </button>
          </div>

          <div style={{ alignSelf: "flex-end" }}>
            <button onClick={exportCSV} disabled={!rows.length}>
              Exportar CSV
            </button>
          </div>
        </div>

        <div style={{ height: 10 }} />

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={onlyWithQualis}
            onChange={(e) => setOnlyWithQualis(e.target.checked)}
          />
          <small>Mostrar apenas revistas com Qualis (match por ISSN/título)</small>
        </label>

        <div style={{ height: 10 }} />

        {/* Status */}
        <div>
          <small>
            Qualis file: <span className="badge">{meta.qualisFile || "-"}</span>{" "}
            | Registros Qualis: <span className="badge">{meta.qualisCount ?? "-"}</span>{" "}
            | Springer records: <span className="badge">{meta.springerRecords ?? "-"}</span>
          </small>
        </div>

        {catalogError ? (
          <p style={{ color: "crimson", marginTop: 10 }}>
            {catalogError} (verifique public/qualis/index.json)
          </p>
        ) : null}

        {error ? <p style={{ color: "crimson", marginTop: 10 }}>{error}</p> : null}

        <ResultsTable rows={rows} />
      </div>

      <div style={{ height: 14 }} />

      <div className="card">
        <h1>Como adicionar períodos e áreas</h1>
        <ul>
          <li>
            Coloque os JSONs em{" "}
            <span className="badge">public/qualis/&lt;periodo&gt;/&lt;area&gt;.json</span>.
          </li>
          <li>
            Registre tudo em <span className="badge">public/qualis/index.json</span>.
          </li>
          <li>
            O app carrega o catálogo e oferece seleção de período/área automaticamente.
          </li>
        </ul>
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
        {rows.map((r) => (
          <tr key={`${(r.issn || "").trim() || r.journalTitle}`}>
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

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
