export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/springer") {
      if (request.method === "OPTIONS") {
        return corsResponse(request, null, 204);
      }
      if (request.method !== "GET") {
        return corsResponse(request, { error: "Method Not Allowed" }, 405);
      }

      const q = url.searchParams.get("q") || "";
      const p = url.searchParams.get("p") || "5";

      if (!q.trim()) {
        return corsResponse(request, { error: "Missing query param: q" }, 400);
      }
      if (!env.SPRINGER_API_KEY) {
        return corsResponse(request, { error: "Server not configured (missing SPRINGER_API_KEY)" }, 500);
      }

      const origin = request.headers.get("Origin") || "";
      const cacheKey = new Request(`${url.toString()}::origin=${origin}`, request);
      const cache = caches.default;

      const cached = await cache.match(cacheKey);
      if (cached) return withCors(request, cached);

      // Upstream: Springer Meta API v2
      const springer = new URL("https://api.springernature.com/meta/v2/json");
      springer.searchParams.set("q", q);
      springer.searchParams.set("p", p);
      springer.searchParams.set("api_key", env.SPRINGER_API_KEY);

      const upstream = await fetch(springer.toString(), {
        headers: { Accept: "application/json" }
      });

      const bodyText = await upstream.text();

      const resp = new Response(bodyText, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "cache-control": "public, max-age=600"
        }
      });

      if (upstream.ok) {
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      }

      return withCors(request, resp);
    }

    return new Response("Not found", { status: 404 });
  }
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const cacheKey = new Request(`${url.toString()}::origin=${origin}`, request);

  // Restrinja ao seu Pages
  const allowList = [
    "https://alfa-m.github.io/journal-qualis-finder/",
    "https://alfa-m.github.io/",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ];

  // Se não tem Origin (ex.: curl), não precisa CORS
  if (!origin) return {};

  // Bloqueia origens não permitidas
  if (!allowList.includes(origin)) {
    return {
      "access-control-allow-origin": "null"
    };
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400"
  };
}

function withCors(request, response) {
  const newHeaders = new Headers(response.headers);
  const ch = corsHeaders(request);
  for (const [k, v] of Object.entries(ch)) newHeaders.set(k, v);
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

function corsResponse(request, json, status = 200) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(request)
  };
  return new Response(json ? JSON.stringify(json) : null, { status, headers });
}
