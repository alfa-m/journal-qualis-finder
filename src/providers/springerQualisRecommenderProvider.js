import { appConfig } from "../config/appConfig.js";
import { normalizeText } from "../core/textUtils.js";

/**
 * Recomendador por tema (abstract/ideia) via Springer Meta API v2,
 * SEM expor API key no frontend.
 *
 * Este provider chama um Cloudflare Worker (proxy), que injeta a key e consulta:
 *   https://api.springernature.com/meta/v2/json
 *
 * Para se adequar ao plano grátis:
 * - Nunca solicita p > 25 (capado)
 * - Usa paginação (s/start) para obter mais resultados com múltiplas chamadas
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

  function extractIssn(rec) {
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
    return (
      rec?.publicationName ||
      rec?.journalTitle ||
      rec?.journal ||
      rec?.publication?.title ||
      null
    );
  }

  function extractUrl(rec) {
    const u = rec?.url ?? rec?.urls ?? null;
    if (Array.isArray(u)) return u?.[0]?.value || u?.[0] || null;
    if (typeof u === "string") return u;

    const doi = rec?.doi || rec?.DOI || null;
    if (doi) return `https://doi.org/${doi}`;

    return null;
  }

  function extractRecords(payload) {
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
    if (Array.isArray(payload)) return payload;
    return [];
  }

  function looksLikePremiumRestriction(payload) {
    // Ex.: {status:"Fail", message:"Access to this resource is restricted. This is a premium feature", ...}
    const status = (payload?.status || "").toString().toLowerCase();
    const msg = (payload?.message || "").toString().toLowerCase();
    const errDesc = (payload?.error?.error_description || "").toString().toLowerCase();
    return (
      status === "fail" &&
      (msg.includes("premium") ||
        msg.includes("restricted") ||
        errDesc.includes("premium"))
    );
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

      // Plano grátis: p máximo 25 (capado)
      const pageSize = Math.min(
        Number(options.p || appConfig.springerPageSize || 25),
        25
      );

      const maxPages = Math.max(
        1,
        Number(options.maxPages || appConfig.springerMaxPages || 4)
      );

      // Parâmetro de paginação (no Worker você deve repassar isso para a Springer)
      const startParam = (appConfig.springerStartParam || "s").toString();

      // Coleta paginada
      const allRecords = [];
      for (let page = 0; page < maxPages; page++) {
        const start = 1 + page * pageSize;

        const url = new URL(appConfig.springerProxyUrl);
        url.searchParams.set("q", query);
        url.searchParams.set("p", String(pageSize));
        url.searchParams.set(startParam, String(start));

        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" }
        });

        // Se der rate limit, para e devolve o que já tem
        if (res.status === 429) break;

        // Se o proxy repassar 403, para (premium/forbidden/etc.)
        if (res.status === 403) break;

        if (!res.ok) {
          // Qualquer erro -> para e devolve o que já tem (não explode a UX)
          break;
        }

        const payload = await res.json();

        // Se payload indicar premium restriction, para
        if (looksLikePremiumRestriction(payload)) break;

        const records = extractRecords(payload);
        if (!records.length) break;

        allRecords.push(...records);

        // Se veio menos que pageSize, provavelmente acabou
        if (records.length < pageSize) break;
      }

      // Agrega por periódico
      const counts = new Map();
      for (const rec of allRecords) {
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

      // Converte e cruza com Qualis
      let results = Array.from(counts.values())
        .sort((a, b) => b.hits - a.hits)
        .slice(0, options.maxResults || appConfig.maxResults || 50)
        .map((j) => {
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
            score: j.hits
          };
        });

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

function qualisRank(q) {
  const order = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
  const idx = order.indexOf((q || "").toUpperCase());
  return idx === -1 ? 999 : idx;
}
