export const appConfig = {
  springerApiKey: import.meta.env.VITE_SPRINGER_API_KEY || "",
  qualisJsonUrl: `${import.meta.env.BASE_URL}qualis.sample.json`,
  maxResults: 50
};
