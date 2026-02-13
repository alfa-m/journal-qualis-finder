export const appConfig = {
  springerApiKey: import.meta.env.VITE_SPRINGER_API_KEY || "",
  qualisIndexUrl: `${import.meta.env.BASE_URL}qualis/index.json`,
  maxResults: 50
};
