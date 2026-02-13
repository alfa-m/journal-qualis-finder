import { appConfig } from "../config/appConfig.js";
import { normalizeText } from "../core/textUtils.js";

export function createSpringerProvider() {
  return {
    id: "springer",
    name: "Springer (API/Meta)",
    async search(query) {
      const q = normalizeText(query);
      if (!q) return [];

      // Sem chave, devolve vazio (não falha).
      if (!appConfig.springerApiKey) return [];

      // Observação: a API oficial e campos variam; adapte conforme seu endpoint/contrato.
      // Exemplo ilustrativo: usa endpoint genérico; ajuste para o que você contratar/usar.
      const url = new URL("https://api.springernature.com/metadata/json");
      url.searchParams.set("q", q);
      url.searchParams.set("p", "50");
      url.searchParams.set("api_key", appConfig.springerApiKey);

      const res = await fetch(url.toString());
      if (!res.ok) return [];

      const data = await res.json();

      // Resultado *exemplo*: você vai mapear conforme o retorno real do endpoint que usar.
      const records = Array.isArray(data?.records) ? data.records : [];

      return records.map((r) => ({
        provider: "springer",
        journalTitle: r.publicationName || r.journalTitle || r.title || "Unknown",
        issn: r.issn || null,
        area: null,
        qualis: null,
        event: null,
        url: r.url?.[0]?.value || null,
        score: 0.1
      }));
    }
  };
}
