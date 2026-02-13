import { appConfig } from "../config/appConfig.js";

let catalogCache = null;

export async function loadQualisCatalog() {
  if (catalogCache) return catalogCache;
  const res = await fetch(appConfig.qualisIndexUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar qualis/index.json");
  catalogCache = await res.json();
  return catalogCache;
}

export function findQualisFile(catalog, periodId, areaId) {
  const period = catalog?.periods?.find((p) => p.id === periodId);
  const area = period?.areas?.find((a) => a.id === areaId);
  return area?.file || null;
}
