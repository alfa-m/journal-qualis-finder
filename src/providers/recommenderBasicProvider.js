import { normalizeText, tokenOverlapScore } from "../core/textUtils.js";
import { appConfig } from "../config/appConfig.js";

export function createRecommenderBasicProvider() {
  let qualisCache = null;

  async function loadQualis() {
    if (qualisCache) return qualisCache;
    const res = await fetch(appConfig.qualisJsonUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Falha ao carregar qualis JSON");
    qualisCache = await res.json();
    return qualisCache;
  }

  return {
    id: "recommender-basic",
    name: "Recomendador (heurístico)",
    async search(query, options = {}) {
      const q = normalizeText(query);
      if (!q) return [];

      const data = await loadQualis();

      // O JSON tem: ISSN, Título, Estrato :contentReference[oaicite:2]{index=2}
      const normalized = data
        .map((row) => ({
          issn: (row?.ISSN || "").trim() || null,
          title: (row?.["Título"] || "").trim(),
          qualis: (row?.Estrato || "").trim().toUpperCase() || null
        }))
        .filter((j) => j.title);

      const scored = normalized
        .map((j) => ({
          ...j,
          _score: tokenOverlapScore(q, j.title)
        }))
        .filter((j) => j._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, options.maxResults || 20);

      return scored.map((j) => ({
        provider: "recommender-basic",
        journalTitle: j.title,
        issn: j.issn,
        area: null,
        qualis: j.qualis,
        event: null,
        url: null,
        score: j._score
      }));
    }
  };
}
