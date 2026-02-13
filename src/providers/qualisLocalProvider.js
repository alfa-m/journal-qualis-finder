import { normalizeText, tokenOverlapScore } from "../core/textUtils.js";
import { appConfig } from "../config/appConfig.js";

export function createQualisLocalProvider() {
  let cache = null;

  async function load() {
    if (cache) return cache;
    const res = await fetch(appConfig.qualisJsonUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Falha ao carregar qualis JSON");
    cache = await res.json();
    return cache;
  }

  return {
    id: "qualis-local",
    name: "Qualis (JSON local)",
    async search(query, options = {}) {
      const q = normalizeText(query);
      if (!q) return [];

      const data = await load();

      // O JSON tem: ISSN, Título, Estrato :contentReference[oaicite:1]{index=1}
      const normalized = data
        .map((row) => ({
          issn: (row?.ISSN || "").trim() || null,
          title: (row?.["Título"] || "").trim(),
          qualis: (row?.Estrato || "").trim().toUpperCase() || null
        }))
        .filter((j) => j.title);

      const minQualis = (options.minQualis || "").trim().toUpperCase();

      const scored = normalized
        .map((j) => ({
          ...j,
          _score: tokenOverlapScore(q, j.title)
        }))
        .filter((j) => j._score > 0)
        .filter((j) => (minQualis ? qualisRank(j.qualis) <= qualisRank(minQualis) : true))
        .sort((a, b) => b._score - a._score)
        .slice(0, options.maxResults || 50);

      return scored.map((j) => ({
        provider: "qualis-local",
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

// Quanto menor, melhor (A1 é topo)
function qualisRank(q) {
  const order = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
  const idx = order.indexOf((q || "").toUpperCase());
  return idx === -1 ? 999 : idx;
}
