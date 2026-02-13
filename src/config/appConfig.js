export const appConfig = {
  // Proxy no Cloudflare Worker (a API key fica lá como secret)
  springerProxyUrl:
    "https://journal-qualis-springer-proxy.alfa-m-account.workers.dev/api/springer",

  // Plano grátis: page size máximo (p)
  springerPageSize: 25,

  // Quantas páginas buscar (p=25). Ex.: 4 páginas => até ~100 registros
  springerMaxPages: 4,

  // Parâmetro de paginação usado no Worker/endpoint (geralmente "s" ou "start")
  springerStartParam: "s",

  // Arquivo Qualis local (no /public)
  qualisJsonUrl: `${import.meta.env.BASE_URL}qualis.sample.json`,

  // Quantos periódicos mostrar no final
  maxResults: 50
};
