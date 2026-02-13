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

      const scored = data
        .map((j) => ({
          ...j,
          _score: tokenOverlapScore(q, j.title)
        }))
        .filter((j) => j._score > 0);

      const top = scored
        .sort((a, b) => b._score - a._score)
        .slice(0, options.maxResults || 20);

      return top.map((j) => ({
        provider: "recommender-basic",
        journalTitle: j.title,
        issn: j.issn,
        area: j.area,
        qualis: j.qualis,
        event: j.event,
        url: null,
        score: j._score
      }));
    }
  };
}
