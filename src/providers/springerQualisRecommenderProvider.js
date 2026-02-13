import { appConfig } from "../config/appConfig.js";
import { normalizeText } from "../core/textUtils.js";

/**
 * Provider de recomendação "por tema":
 * 1) Consulta a Springer Metadata API com o texto (título/abstract/ideia)
 * 2) Agrega os resultados por periódico (publicationName)
 * 3) Cruza com o Qualis local (JSON) selecionado por período + área via options.qualisFile
 *
 * Espera que o JSON Qualis tenha colunas (como seu dataset atual):
 * - ISSN
 * - "Título"
 * - Estrato
 */
export function createSpringerQualisRecommenderProvider() {
  // cache por arquivo Qualis selecionado
  const qualisCacheByFile = new Map(); // qualisFile -> array
  const qualisIndexByFile = new Map(); // qualisFile -> { byIssn, byTitle }

  function baseUrlJoin(relPath) {
    // relPath: "qualis/2021-2024/engenharias-iv.json"
    // BASE_URL já contém "/repo/" em GitHub Pages quando base está configurado
    const base = import.meta.env.BASE_URL || "/";
    if (!relPath) return base;
    if (relPath.startsWith("/")) return `${base}${relPath.slice(1)}`;
    return `${base}${relPath}`;
  }

  async function loadQualis(qualisFile) {
    if (!qualisFile) throw new Error("Arquivo Qualis não selecionado (qualisFile).");

    if (qualisCacheByFile.has(qualisFile)) return qualisCacheByFile.get(qualisFile);

    const url = baseUrlJoin(qualisFile);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar Qualis (${res.status}): ${qualisFile}`);

    const json = await res.json();
    qualisCacheByFile.set(qualisFile, json);
    return json;
  }

  async function buildQualisIndex(qualisFile) {
    if (qualisIndexByFile.has(qualisFile)) return qualisIndexByFile.get(qualisFile);

    const data = await loadQualis(qualisFile);

    const byIssn = new Map(); // "1234-5678" -> { title, qualis, issn }
    const byTitle = new Map(); // normalizeText(title) -> { title, qualis, issn }

    for (const row of data) {
      const issnRaw = (row?.ISSN || "").toString().trim();
      const titleRaw = (row?.["Título"] || "").toString().trim();
      const qualisRaw = (row?.Estrato || "").toString().trim().toUpperCase();

      if (!titleRaw) continue;

      const issn = normalizeIssn(issnRaw) || null;
      const titleKey = normalizeText(titleRaw);

      const entry = { title: titleRaw, qualis: qualisRaw || null, issn };

      if (issn) byIssn.set(issn, entry);
      if (titleKey) byTitle.set(titleKey, entry);
    }

    const idx = { byIssn, byTitle, count: data.length };
    qualisIndexByFile.set(qualisFile, idx);
    return idx;
  }

  function normalizeIssn(issn) {
    return (issn || "").toString().replace(/\s/g, "").trim();
  }

  function extractIssn(record) {
    // A Metadata API pode retornar formatos diferentes
    const v =
      record?.issn ||
      record?.issnPrint ||
      record?.issnElectronic ||
      record?.pissn ||
      record?.eissn ||
      null;

    if (Array.isArray(v)) return v.find(Boolean) || null;
    return v;
  }

  function extractUrl(record) {
    // No payload da Springer, "url" costuma ser lista [{format, value}]
    const u = record?.url;
    if (Array.isArray(u) && u.length > 0) return u[0]?.value || null;
    if (typeof u === "string") return u;
    return null;
  }

  return {
    id: "springer-qualis-recommender",
    name: "Recomendador (Springer + Qualis)",
    async search(query, options = {}) {
      const qNorm = normalizeText(query);
      if (!qNorm) return [];

      // 1) key obrigatória
      if (!appConfig.springerApiKey) return [];

      // 2) Qualis file selecionado
      const qualisFile = options.qualisFile;
      const idx = await buildQualisIndex(qualisFile);

      // meta/debug opcional (ajuda a validar que carregou)
      if (typeof options.onMeta === "function") {
        options.onMeta({
          qualisCount: idx.count,
          qualisFile
        });
      }

      // 3) Springer Metadata API
      // Docs: https://dev.springernature.com/docs/api-endpoints/metadata-api/
      const url = new URL("https://api.springernature.com/metadata/json");
      url.searchParams.set("q", query); // texto original
      url.searchParams.set("p", String(options.p || 50)); // 50 tende a dar recomendações melhores
      url.searchParams.set("api_key", appConfig.springerApiKey);

      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`Springer API falhou (HTTP ${res.status}).`);
      }

      const data = await res.json();
      const records = Array.isArray(data?.records) ? data.records : [];

      if (typeof options.onMeta === "function") {
        options.onMeta({ springerRecords: records.length });
      }

      // 4) Agrega por periódico
      const counts = new Map(); // key -> { journalTitle, issn, hits, url }

      for (const r of records) {
        const journalTitle =
          r.publicationName || r.journalTitle || r.journal || r.publication || null;
        if (!journalTitle) continue;

        const issn = normalizeIssn(extractIssn(r));
        const key = issn || normalizeText(journalTitle);

        const prev = counts.get(key) || {
          journalTitle,
          issn: issn || null,
          hits: 0,
          url: extractUrl(r) || null
        };

        prev.hits += 1;
        prev.journalTitle = prev.journalTitle || journalTitle;
        prev.issn = prev.issn || (issn || null);
        prev.url = prev.url || (extractUrl(r) || null);

        counts.set(key, prev);
      }

      // 5) Converte para lista e cruza com Qualis
      const minQualis = (options.minQualis || "").trim().toUpperCase();
      const onlyWithQualis = !!options.onlyWithQualis;

      let results = Array.from(counts.values())
        .sort((a, b) => b.hits - a.hits)
        .slice(0, options.maxResults || 50)
        .map((j) => {
          let qualis = null;

          // Match por ISSN primeiro
          if (j.issn && idx.byIssn.has(j.issn)) {
            qualis = idx.byIssn.get(j.issn).qualis;
          } else {
            // Match exato por título normalizado
            const hit = idx.byTitle.get(normalizeText(j.journalTitle));
            if (hit) qualis = hit.qualis;
          }

          return {
            provider: "springer-qualis-recommender",
            journalTitle: j.journalTitle,
            issn: j.issn,
            area: null,
            qualis,
            event: null,
            url: j.url,
            // score baseado em frequência do periódico nos records retornados
            score: j.hits
          };
        });

      // 6) filtros
      if (onlyWithQualis) {
        results = results.filter((r) => !!r.qualis);
      }

      if (minQualis) {
        results = results.filter((r) =>
          r.qualis ? qualisRank(r.qualis) <= qualisRank(minQualis) : false
        );
      }

      return results;
    }
  };
}

function qualisRank(q) {
  const order = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
  const idx = order.indexOf((q || "").toUpperCase());
  return idx === -1 ? 999 : idx;
}
