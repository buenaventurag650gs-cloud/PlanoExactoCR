/* Worker del tablero municipal. Sirve los archivos estáticos (binding ASSETS) y agrega un
   único endpoint: /geoproxy?url=<URL de geoservicio>.

   Para qué: el navegador no puede pedir directo las capas del SNIT/CNE/SINAC porque esos
   servidores no habilitan CORS, y algunos son solo http (contenido mixto, bloqueado en una
   página https). El proxy las pide desde el Worker (mismo origen, https) y las devuelve con
   las cabeceras CORS puestas. NO es un proxy abierto: solo deja pasar GET a una lista fija de
   servidores de geoservicios oficiales. */

const HOSTS_PERMITIDOS = new Set([
  "geos.snitcr.go.cr",
  "geos1.snitcr.go.cr",
  "geos1pne.sirefor.go.cr",
  "mapas.cne.go.cr",
  "geoserver.mag.go.cr",
  "www.snitcr.go.cr",
  "snitcr.go.cr",
]);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function geoproxy(url, request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET") {
    return new Response("Solo GET", { status: 405, headers: CORS });
  }

  const destino = url.searchParams.get("url");
  if (!destino) {
    return new Response("Falta ?url=", { status: 400, headers: CORS });
  }

  let u;
  try {
    u = new URL(destino);
  } catch {
    return new Response("URL inválida", { status: 400, headers: CORS });
  }
  if (!HOSTS_PERMITIDOS.has(u.hostname)) {
    return new Response(`Host no permitido: ${u.hostname}`, { status: 403, headers: CORS });
  }

  // Cache de borde: estas capas cambian poco; evita golpear el SNIT en cada carga.
  const cache = caches.default;
  const claveCache = new Request(url.toString(), { method: "GET" });
  const enCache = await cache.match(claveCache);
  if (enCache) return enCache;

  let upstream;
  try {
    upstream = await fetch(u.toString(), {
      method: "GET",
      headers: { accept: "application/json, */*" },
      // Los servidores del SNIT a veces tardan; el Worker tiene su propio límite.
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch (e) {
    return new Response(`No se pudo contactar el geoservicio: ${e}`, { status: 502, headers: CORS });
  }

  const tipo = upstream.headers.get("content-type") || "application/json";
  const cuerpo = await upstream.arrayBuffer();
  const resp = new Response(cuerpo, {
    status: upstream.status,
    headers: {
      ...CORS,
      "content-type": tipo,
      "cache-control": "public, max-age=3600",
    },
  });
  if (upstream.ok) {
    // Guarda en cache de borde sin bloquear la respuesta.
    cache.put(claveCache, resp.clone());
  }
  return resp;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/geoproxy") {
      return geoproxy(url, request);
    }
    return env.ASSETS.fetch(request);
  },
};
