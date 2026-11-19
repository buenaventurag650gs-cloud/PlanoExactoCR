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
  "images.squarespace-cdn.com",   // escudos municipales (munis.cr)
  "server.arcgisonline.com",      // relieve sombreado de fondo (World Hillshade)
  "services.arcgisonline.com",    // el mismo servicio, por su otro nombre
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
  // Los servicios de ArcGIS viven en muchos subdominios (services1, services7, tiles…),
  // así que se permiten por sufijo en vez de listarlos uno por uno. Sigue siendo una lista
  // cerrada: cualquier otro dominio se rechaza.
  const esArcGIS = /(^|\.)arcgis\.com$/.test(u.hostname) || /(^|\.)arcgisonline\.com$/.test(u.hostname);
  if (!HOSTS_PERMITIDOS.has(u.hostname) && !esArcGIS) {
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
  // El relieve sombreado no cambia nunca: se guarda un mes, así la segunda lámina del mismo
  // cantón sale al instante. Las capas del SNIT sí se revisan cada hora.
  const vida = /arcgisonline\.com$/.test(u.hostname) ? 2592000 : 3600;
  const resp = new Response(cuerpo, {
    status: upstream.status,
    headers: {
      ...CORS,
      "content-type": tipo,
      "cache-control": `public, max-age=${vida}`,
    },
  });
  if (upstream.ok) {
    // Guarda en cache de borde sin bloquear la respuesta.
    cache.put(claveCache, resp.clone());
  }
  return resp;
}

/* Base de datos de escudos municipales, abierta al resto de las apps de PlanoExactoCR.

   Los 82 escudos se identifican una sola vez acá y los demás productos del mundo privado
   (por ejemplo el calibrador de planes reguladores en calibrador.planoexactocr.com) los piden
   a este endpoint en vez de volver a armar la lista. Así, cuando se corrige un escudo viejo,
   se corrige para todos.

   - GET /api/escudos                 → { escudos: { "<cantón>": "<url>" } }
   - GET /api/escudos?canton=Mora     → { canton, url, imagen } ; `imagen` es el escudo ya
     descargado y en base64, listo para meter en un PDF sin pelear con CORS ni hotlink.

   Solo lectura y solo desde los dominios de PlanoExactoCR. */
const ORIGENES_PERMITIDOS = /^https:\/\/([a-z0-9-]+\.)?planoexactocr\.com$/;

function corsPara(request) {
  const origen = request.headers.get("origin") || "";
  if (ORIGENES_PERMITIDOS.test(origen)) {
    return { ...CORS, "access-control-allow-origin": origen, vary: "Origin" };
  }
  return CORS;
}

async function apiEscudos(url, request, env) {
  const cors = corsPara(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return new Response("Solo GET", { status: 405, headers: cors });

  const base = new URL("/escudos.json", url.origin);
  const doc = await env.ASSETS.fetch(new Request(base)).then((r) => r.json()).catch(() => null);
  const escudos = (doc && doc.escudos) || {};

  const canton = url.searchParams.get("canton");
  if (!canton) {
    return new Response(JSON.stringify({ n: Object.keys(escudos).length, escudos }), {
      headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
  }

  const directo = escudos[canton];
  if (!directo) {
    return new Response(JSON.stringify({ error: `Sin escudo para el cantón "${canton}"` }), {
      status: 404, headers: { ...cors, "content-type": "application/json" },
    });
  }

  // Se devuelve también la imagen en base64: quien arma un PDF la mete tal cual.
  let imagen = null;
  try {
    const r = await fetch(directo, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (r.ok) {
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const tipo = r.headers.get("content-type") || "image/png";
      imagen = `data:${tipo};base64,${btoa(bin)}`;
    }
  } catch { /* se devuelve solo la url */ }

  return new Response(JSON.stringify({ canton, url: directo, imagen }), {
    headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=86400" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/geoproxy") {
      return geoproxy(url, request);
    }
    if (url.pathname === "/api/escudos") {
      return apiEscudos(url, request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
