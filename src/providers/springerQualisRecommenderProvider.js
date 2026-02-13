import { appConfig } from "../config/appConfig.js";
import { normalizeText } from "../core/textUtils.js";

// Recomendação por "tema": busca artigos na Springer (Metadata API),
// agrega por periódico e cruza com Qualis local.
export function createSpringerQualisRecommenderProvider() {
  let qualisCache = null;
  let qualisIndex = null;

  async function loadQualis(qualisFile) {
  if (!qualisFile) throw new Error("Arquivo Qualis não selecionado.");
  const url = `${import.meta.env.BASE_URL}${qualisFile}`; // qualisFile já é relativo ao public
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar Qualis: ${qualisFile}`);
  return await res.json();
}


  async function buildQualisIndex() {
    if (qualisIndex) return qualisIndex;
    const data = await loadQualis();

    // O JSON: ISSN, "Título", Estrato
    const byIssn = new Map();
    const byTitle = new Map();

    for (const row of data) {
      const issn = (row?.ISSN || "").trim();
      const title = (row?.["Título"] || "").trim();
      const qualis = (row?.Estrato || "").trim().toUpperCase();

      if (issn) byIssn.set(issn.replace(/\s/g, ""), { title, qualis, issn });
      if (title) byTitle.set(normalizeText(title), { title, qualis, issn: issn || null });
    }

    qualisIndex = { byIssn, byTitle };
    return qualisIndex;
  }

  function normalizeIssn(issn) {
    return (issn || "").replace(/\s/g, "");
  }

  function extractIssn(record) {
    // A resposta da Metadata API pode variar. Tentamos alguns formatos comuns:
    // - r.issn
    // - r.issn = ["xxxx-xxxx", ...]
    // - r.issnPrint / r.issnElectronic (dependendo do payload)
    const v = record?.issn || record?.issnPrint || record?.issnElectronic || null;
    if (Array.isArray(v)) return v.find(Boolean) || null;
    return v;
  }

  return {
    id: "springer-qualis-recommender",
    name: "Recomendador (Springer + Qualis)",
    async search(query, options = {}) {
      const q = normalizeText(query);
      if (!q) return [];

      if (!appConfig.springerApiKey) {
        // Sem key, não dá para chamar a API
        return [];
      }

      const { byIssn, byTitle } = await buildQualisIndex();

      // Springer Metadata API endpoint (conforme seu provider atual)
      const url = new URL("https://api.springernature.com/metadata/json");
      url.searchParams.set("q", query);       // usa o texto original (não normalizado)
      url.searchParams.set("p", String(options.p || 50)); // mais docs => melhor agregação
      url.searchParams.set("api_key", appConfig.springerApiKey);

      const res = await fetch(url.toString());
      if (!res.ok) {
        // Mostra erro “amigável”
        throw new Error(`Springer API falhou (HTTP ${res.status}).`);
      }

      const data = await res.json();
      const records = Array.isArray(data?.records) ? data.records : [];

      // Agrega por periódico (publicationName)
      const counts = new Map();

      for (const r of records) {
        const journalTitle =
          r.publicationName || r.journalTitle || r.journal || r.title || null;
        if (!journalTitle) continue;

        const issn = extractIssn(r);
        const key = normalizeIssn(issn) || normalizeText(journalTitle);

        const prev = counts.get(key) || {
          journalTitle,
          issn: issn ? normalizeIssn(issn) : null,
          hits: 0,
          url: r?.url?.[0]?.value || null
        };

        prev.hits += 1;
        // tenta manter o “melhor” title/url/issn conforme aparece
        prev.journalTitle = prev.journalTitle || journalTitle;
        prev.issn = prev.issn || (issn ? normalizeIssn(issn) : null);
        prev.url = prev.url || (r?.url?.[0]?.value || null);

        counts.set(key, prev);
      }

      // Converte para resultados e cruza com Qualis local
      const results = Array.from(counts.values())
        .sort((a, b) => b.hits - a.hits)
        .slice(0, options.maxResults || 50)
        .map((j) => {
          // Match por ISSN primeiro; senão por título aproximado (normalizado)
          let qualis = null;

          if (j.issn && byIssn.has(j.issn)) {
            qualis = byIssn.get(j.issn).qualis;
          } else {
            const hit = byTitle.get(normalizeText(j.journalTitle));
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
            // score proporcional à frequência do periódico nos resultados da Springer
            score: j.hits
          };
        });

      // Filtro por Qualis mínimo (se definido)
      const minQualis = (options.minQualis || "").trim().toUpperCase();
      if (minQualis) {
        return results.filter((r) => (r.qualis ? qualisRank(r.qualis) <= qualisRank(minQualis) : false));
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
