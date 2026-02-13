export class ProviderRegistry {
  constructor() {
    this.providers = [];
  }

  register(provider) {
    if (!provider?.id || typeof provider.search !== "function") {
      throw new Error("Provider inválido: precisa ter {id, search()}");
    }
    this.providers.push(provider);
  }

  list() {
    return [...this.providers];
  }

  async runAll(query, options = {}) {
    const results = await Promise.allSettled(
      this.providers.map((p) => p.search(query, options))
    );

    const merged = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) merged.push(...r.value);
    }
    return merged;
  }
}
