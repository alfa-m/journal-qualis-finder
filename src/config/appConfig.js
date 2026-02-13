export const appConfig = {
  // Para Springer: coloque sua chave em Settings → Secrets se for usar via build,
  // ou use VITE_SPRINGER_API_KEY em ambiente local.
  springerProxyUrl: "https://journal-qualis-springer-proxy.alfa-m-account.workers.dev/api/springer",  // Arquivo Qualis local (no /public)
  qualisJsonUrl: `${import.meta.env.BASE_URL}qualis.sample.json`,
  maxResults: 5
};
