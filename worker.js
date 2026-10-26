// PlanoExactoCR en Cloudflare Workers (con archivos estáticos).
// 1) Contraseña de la etapa de prueba: variable secreta SITE_PASSWORD del Worker (nunca en el código).
//    Página de acceso propia con sesión de 30 días (cookie firmada); también acepta usuario y contraseña (Basic).
//    Si la variable no existe, el sitio queda cerrado (falla de forma segura).
// 2) Puente /api hacia servicios públicos del SNIT y del MINAE (solo destinos permitidos).
// 3) El resto se sirve desde los archivos estáticos del repositorio (binding ASSETS).

const txt = (t, status, extra) => new Response(t, { status, headers: Object.assign({ "content-type": "text/plain; charset=utf-8" }, extra || {}) });
const json = (o, status = 200, cache = 3600) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${cache}` } });

// Sesión: cookie firmada con la contraseña (si la contraseña cambia, todas las sesiones caducan)
const COOKIE = "pecr_s";
async function firma(pw) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("planoexactocr-sesion-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function leerCookie(request, n) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + n + "=([^;]+)"));
  return m ? m[1] : null;
}
async function autorizado(request, pw) {
  const ck = leerCookie(request, COOKIE);
  if (ck && ck === await firma(pw)) return true;
  const h = request.headers.get("authorization") || "";   // acceso con usuario y contraseña (Basic) sigue sirviendo
  if (!h.startsWith("Basic ")) return false;
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), (c) => c.charCodeAt(0)));
    return decoded.slice(decoded.indexOf(":") + 1) === pw;
  } catch (_) { return false; }
}

// Página de acceso con la marca
function paginaAcceso(error) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PlanoExactoCR · Acceso</title><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/assets/img/favicon.png">
<style>
:root{--bg:#F1EEE7;--panel:#FCFBF8;--ink:#15302A;--muted:#4C5953;--line:#DCD8CE;--accent:#1F5A47;--bad:#B42318}
@media (prefers-color-scheme:dark){:root{--bg:#0F1513;--panel:#151C1A;--ink:#E5ECE8;--muted:#A7B4AE;--line:#28332F;--accent:#5FB8AE;--bad:#F2735F}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px 26px;display:grid;gap:16px;box-shadow:0 10px 30px rgba(20,35,30,.12);position:relative;overflow:hidden}
.card:before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#15302A 0 46%,#539279 46% 82%,#D9906E 82%)}
.logo{justify-self:center;width:230px;max-width:100%;height:auto;background:#F1EEE7;border-radius:10px;padding:6px}
h1{margin:0;font-size:17px;text-align:center}p{margin:0;color:var(--muted);text-align:center;font-size:13.5px}
label{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
input{width:100%;margin-top:6px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{padding:11px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:600 15px/1 inherit;font-family:inherit;cursor:pointer}
.err{color:var(--bad);font-size:13px;text-align:center}
</style></head><body><form class="card" method="post" action="/__acceso">
<img class="logo" src="/assets/img/logo.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="463">
<h1>Versión de prueba</h1><p>Ingresa la contraseña de acceso que te compartimos.</p>
${error ? '<div class="err" role="alert">La contraseña no es correcta. Intenta de nuevo.</div>' : ""}
<label>Contraseña<input type="password" name="clave" autocomplete="current-password" required autofocus></label>
<button type="submit">Entrar</button></form></body></html>`;
  return new Response(html, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

async function get(url, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, headers: { "user-agent": "PlanoExactoCR/1.0" } }); }
  finally { clearTimeout(t); }
}

async function api(u) {
  const q = u.searchParams;
  try {
    if (u.pathname === "/api/plano" || u.pathname === "/api/finca") {
      const v = (q.get("v") || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 16);
      if (!v) return json({ error: "Falta el número" }, 400, 0);
      const params = u.pathname === "/api/plano"
        ? new URLSearchParams({ tipoquery: "plano", plano: v })
        : new URLSearchParams({ tipoquery: "finca", finca: v.padStart(7, "0"), provincia: (q.get("p") || "").replace(/\D/g, "").slice(0, 1) });
      const r = await get("https://www.snitcr.go.cr/Visor/services/siri?" + params);
      if (!r.ok) return json({ error: "El catastro no respondió" }, 502, 0);
      return json(await r.json());
    }
    if (u.pathname === "/api/cobertura") {
      const lon = Number(q.get("lon")), lat = Number(q.get("lat"));
      if (!isFinite(lon) || !isFinite(lat)) return json({ error: "Coordenadas inválidas" }, 400, 0);
      const e = 0.0005;
      const p = new URLSearchParams({ service: "WMS", version: "1.1.1", request: "GetFeatureInfo", layers: "MAF2020", query_layers: "MAF2020", srs: "EPSG:4326", bbox: `${lon - e},${lat - e},${lon + e},${lat + e}`, width: "11", height: "11", x: "5", y: "5", info_format: "application/json", feature_count: "1" });
      const r = await get("https://geodatos.sinia.go.cr/geoserver/MAF2020/wms?" + p);
      if (!r.ok) return json({ error: "El servicio del MINAE no respondió" }, 502, 0);
      const j = await r.json();
      const f = j.features && j.features[0];
      return json({ cat: f ? f.properties.CATEGORIA : null }, 200, 86400);
    }
    return json({ error: "Ruta desconocida" }, 404, 0);
  } catch (_) {
    return json({ error: "Servicio no disponible" }, 504, 0);
  }
}

// Archivos que la página de acceso necesita antes de iniciar sesión
const PUBLICOS = new Set(["/assets/img/logo.webp", "/assets/img/favicon.png", "/robots.txt"]);

export default {
  async fetch(request, env) {
    const pw = env.SITE_PASSWORD;
    if (!pw) return txt("Sitio en configuración.", 503);
    const u = new URL(request.url);
    if (u.pathname === "/__acceso" && request.method === "POST") {
      const f = await request.formData().catch(() => null);
      const clave = f ? String(f.get("clave") || "") : "";
      if (clave !== pw) return paginaAcceso(true);
      return new Response(null, { status: 303, headers: { "Location": "/", "Set-Cookie": `${COOKIE}=${await firma(pw)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (u.pathname === "/__salir") return new Response(null, { status: 303, headers: { "Location": "/", "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
    if (!PUBLICOS.has(u.pathname) && !(await autorizado(request, pw))) {
      if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/data/")) return json({ error: "Acceso restringido" }, 401, 0);
      return paginaAcceso(false);
    }
    const res = u.pathname.startsWith("/api/") ? await api(u) : await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("X-Robots-Tag", "noindex, nofollow");
    out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    out.headers.set("X-Content-Type-Options", "nosniff");
    if (u.pathname.startsWith("/data/")) out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return out;
  }
};
