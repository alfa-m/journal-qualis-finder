import { appConfig } from "../config/appConfig.js";
import { normalizeText } from "../core/textUtils.js";

/**
 * Recomendador por tema (abstract/ideia) via Springer Meta API (v2),
 * SEM expor a API key no frontend.
 *
 * Fluxo:
 * 1) Frontend chama appConfig.springerProxyUrl (Cloudflare Worker)
 * 2) Worker injeta SPRINGER_API_KEY (secret) e chama:
 *    https://api.springernature.com/meta/v2/json
 * 3) Provider agrega resultados por periódico e cruza com Qualis local.
 */
export function createSpringerQualisRecommenderProvider() {
  let qualisCache = null;
  let qualisIndex = null;

  async function loadQualis() {
    if (qualisCache) return qualisCache;
    const res = await fetch(appConfig.qualisJsonUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Falha ao carregar qualis JSON.");
    qualisCache = await res.json();
    return qualisCache;
  }

  async function buildQualisIndex() {
    if (qualisIndex) return qualisIndex;
    const data = await loadQualis();

    const byIssn = new Map();
    const byTitle = new Map();

    for (const row of data) {
      // Seu dataset: ISSN, "Título", Estrato
      const issnRaw = (row?.ISSN || "").trim();
      const title = (row?.["Título"] || "").trim();
      const qualis = (row?.Estrato || "").trim().toUpperCase();

      const issn = issnRaw ? normalizeIssn(issnRaw) : null;

      if (issn) byIssn.set(issn, { title: title || null, qualis, issn });
      if (title) byTitle.set(normalizeText(title), { title, qualis, issn });
    }

    qualisIndex = { byIssn, byTitle };
    return qualisIndex;
  }

  function normalizeIssn(issn) {
    return (issn || "").replace(/\s/g, "");
  }

  // Tenta extrair ISSN de respostas que podem variar
  function extractIssn(rec) {
    // Alguns formatos possíveis:
    // - rec.issn
    // - rec.issn = ["xxxx-xxxx", ...]
    // - rec.issnPrint / rec.issnElectronic
    // - rec.publication?.issn (objeto)
    const v =
      rec?.issn ??
      rec?.issnPrint ??
      rec?.issnElectronic ??
      rec?.publication?.issn ??
      rec?.publication?.issnPrint ??
      rec?.publication?.issnElectronic ??
      null;

    if (Array.isArray(v)) return v.find(Boolean) || null;
    if (typeof v === "string") return v || null;
    return null;
  }

  function extractJournalTitle(rec) {
    // Possíveis campos:
    // - publicationName
    // - journalTitle
    // - journal
    // - publication.title
    return (
      rec?.publicationName ||
      rec?.journalTitle ||
      rec?.journal ||
      rec?.publication?.title ||
      null
    );
  }

  function extractUrl(rec) {
    // Possíveis formatos:
    // - rec.url = [{ value: "..." }]
    // - rec.url = "..."
    // - rec.doi -> montar URL
    const u = rec?.url ?? rec?.urls ?? null;
    if (Array.isArray(u)) return u?.[0]?.value || u?.[0] || null;
    if (typeof u === "string") return u;

    const doi = rec?.doi || rec?.DOI || null;
    if (doi) return `https://doi.org/${doi}`;

    return null;
  }

  // Detecta lista de resultados em diferentes formatos de payload.
  function extractRecords(payload) {
    // Alguns retornos comuns em APIs Springer:
    // - { records: [...] }
    // - { result: [...] }
    // - { results: [...] }
    // - { data: { records: [...] } }
    // - { response: { records: [...] } }
    const candidates = [
      payload?.records,
      payload?.result,
      payload?.results,
      payload?.data?.records,
      payload?.data?.results,
      payload?.response?.records,
      payload?.response?.results
    ];

    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }

    // fallback: se payload já for array
    if (Array.isArray(payload)) return payload;

    return [];
  }

  return {
    id: "springer-qualis-recommender",
    name: "Recomendador (Springer Meta v2 via Worker + Qualis)",
    async search(query, options = {}) {
      const qNorm = normalizeText(query);
      if (!qNorm) return [];

      if (!appConfig.springerProxyUrl) {
        throw new Error("springerProxyUrl não configurada no appConfig.");
      }

      const { byIssn, byTitle } = await buildQualisIndex();

      // Chama o Cloudflare Worker (que por sua vez chama:
      // https://api.springernature.com/meta/v2/json com a key em secret)
      const url = new URL(appConfig.springerProxyUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("p", String(options.p || 5));

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `Proxy Springer falhou (HTTP ${res.status}). ${txt?.slice(0, 200) || ""}`.trim()
        );
      }

      const payload = await res.json();
      const records = extractRecords(payload);

      // Agrega por periódico (maior "hits" => mais recorrente nos resultados do tema)
      const counts = new Map();

      for (const rec of records) {
        const journalTitle = extractJournalTitle(rec);
        if (!journalTitle) continue;

        const issnRaw = extractIssn(rec);
        const issn = issnRaw ? normalizeIssn(issnRaw) : null;

        const key = issn || normalizeText(journalTitle);
        const prev =
          counts.get(key) || {
            journalTitle,
            issn,
            hits: 0,
            url: null
          };

        prev.hits += 1;
        prev.journalTitle = prev.journalTitle || journalTitle;
        prev.issn = prev.issn || issn;
        prev.url = prev.url || extractUrl(rec);

        counts.set(key, prev);
      }

      // Converte para resultados e cruza com Qualis local
      let results = Array.from(counts.values())
        .sort((a, b) => b.hits - a.hits)
        .slice(0, options.maxResults || appConfig.maxResults || 5)
        .map((j) => {
          // Match por ISSN primeiro; senão por título normalizado
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
            // score simples: frequência do periódico nos resultados
            score: j.hits
          };
        });

      // Filtro por Qualis mínimo (se definido)
      const minQualis = (options.minQualis || "").trim().toUpperCase();
      if (minQualis) {
        results = results.filter((r) =>
          r.qualis ? qualisRank(r.qualis) <= qualisRank(minQualis) : false
        );
      }

      return results;
    }
  };
}

// Quanto menor, melhor (A1 é topo)
function qualisRank(q) {
  const order = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
  const idx = order.indexOf((q || "").toUpperCase());
  return idx === -1 ? 999 : idx;
}
