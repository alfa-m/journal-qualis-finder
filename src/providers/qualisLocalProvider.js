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
      const data = await load();

      const area = options.area?.trim() || "";
      const minQualis = options.minQualis || "";

      // Ordenação aproximada por similaridade com título do periódico
      const scored = data
        .map((j) => ({
          ...j,
          _score: tokenOverlapScore(q, j.title)
        }))
        .filter((j) => j._score > 0);

      const filtered = scored
        .filter((j) => (area ? j.area === area : true))
        .filter((j) => (minQualis ? qualisRank(j.qualis) <= qualisRank(minQualis) : true))
        .sort((a, b) => b._score - a._score)
        .slice(0, options.maxResults || 10);

      // Padroniza o formato de saída
      return filtered.map((j) => ({
        provider: "qualis-local",
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

// Quanto menor, melhor (A1 é topo)
function qualisRank(q) {
  const order = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
  const idx = order.indexOf((q || "").toUpperCase());
  return idx === -1 ? 999 : idx;
}
