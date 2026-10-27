// PlanoExactoCR en Cloudflare Workers (con archivos estáticos).
// · Cuentas de usuario con correo y contraseña (base de datos D1, binding DB): mapa abierto, ficha con cuenta gratis.
// · Administración con la contraseña del sitio (variable secreta SITE_PASSWORD): /admin, catastro y vista PRO de prueba.
// · Puente /api hacia servicios públicos del SNIT y del MINAE (solo destinos permitidos).
// · Dominio propio: con la variable DOMINIO (p. ej. planoexactocr.com) el resto de direcciones redirige allí.

const enc = new TextEncoder();
const txt = (t, status, extra) => new Response(t, { status, headers: Object.assign({ "content-type": "text/plain; charset=utf-8" }, extra || {}) });
const json = (o, status = 200, cache = 3600, extra) =>
  new Response(JSON.stringify(o), { status, headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": cache ? `public, max-age=${cache}` : "no-store" }, extra || {}) });
const b64u = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uDec = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const igual = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const azar = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PERFILES = new Set(["comprador", "inversionista", "abogado", "corredor", "desarrollador", "otro"]);
const CONTACTO = "hola@planoexactocr.com";

function leerCookie(request, n) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + n + "=([^;]+)"));
  return m ? m[1] : null;
}
const galleta = (n, v, edad) => `${n}=${v}; Path=/; Max-Age=${edad}; HttpOnly; Secure; SameSite=Lax`;
async function hmac(clave, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

// ---------- Administración: contraseña del sitio ----------
const COOKIE_ADMIN = "pecr_s";
const firmaAdmin = async (pw) => [...(await hmac(pw, "planoexactocr-sesion-v1"))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function esAdmin(request, pw) {
  const ck = leerCookie(request, COOKIE_ADMIN);
  if (ck && igual(ck, await firmaAdmin(pw))) return true;
  const h = request.headers.get("authorization") || "";   // usuario y contraseña (Basic): lo usa el botón del catastro
  if (!h.startsWith("Basic ")) return false;
  try { const d = new TextDecoder().decode(b64uDec(h.slice(6).trim())); return igual(d.slice(d.indexOf(":") + 1), pw); } catch (_) { return false; }
}

// ---------- Base de datos (D1) ----------
let listo = null, SECRETO = null;
function initDB(env) {
  if (!listo) listo = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, correo TEXT UNIQUE NOT NULL, nombre TEXT, perfil TEXT, prov TEXT,
      hash TEXT NOT NULL, sal TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 1, plan TEXT NOT NULL DEFAULT 'free', pro_hasta TEXT, cupon TEXT, fuente TEXT, pais TEXT,
      creado TEXT, ultimo TEXT, solicita_pro TEXT, nota TEXT, datos TEXT)`),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tokens (t TEXT PRIMARY KEY, uid INTEGER NOT NULL, vence INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS intentos (correo TEXT NOT NULL, ts INTEGER NOT NULL)")
  ]).catch((e) => { listo = null; throw e; });
  return listo;
}
async function secreto(env) {
  if (SECRETO) return SECRETO;
  await initDB(env);
  let row = await env.DB.prepare("SELECT v FROM config WHERE k='secreto'").first();
  if (!row) { await env.DB.prepare("INSERT OR IGNORE INTO config (k, v) VALUES ('secreto', ?)").bind(azar(32)).run(); row = await env.DB.prepare("SELECT v FROM config WHERE k='secreto'").first(); }
  return (SECRETO = row.v);
}

// ---------- Contraseñas y sesiones de usuario ----------
async function hashClave(clave, salB64) {
  const sal = salB64 ? b64uDec(salB64) : crypto.getRandomValues(new Uint8Array(16));
  const k = await crypto.subtle.importKey("raw", enc.encode(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: 100000 }, k, 256);
  return { hash: b64u(new Uint8Array(bits)), sal: b64u(sal) };
}
const COOKIE_USER = "pecr_u", DURACION = 60 * 60 * 24 * 60;   // 60 días
async function crearSesion(env, u) {
  const p = `${u.id}.${u.ver}.${Math.floor(Date.now() / 1000) + DURACION}`;
  return galleta(COOKIE_USER, p + "." + b64u(await hmac(await secreto(env), "u:" + p)), DURACION);
}
async function leerSesion(request, env) {
  const ck = leerCookie(request, COOKIE_USER);
  if (!ck || !env.DB) return null;
  const partes = ck.split(".");
  if (partes.length !== 4) return null;
  const p = partes.slice(0, 3).join(".");
  if (!igual(partes[3], b64u(await hmac(await secreto(env), "u:" + p)))) return null;
  if (Number(partes[2]) * 1000 < Date.now()) return null;
  return { id: Number(partes[0]), ver: Number(partes[1]) };
}
async function usuarioActual(request, env) {
  const s = await leerSesion(request, env);
  if (!s) return null;
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(s.id).first();
  return u && u.ver === s.ver ? u : null;
}
const hoy = () => new Date().toISOString().slice(0, 10);
const planVigente = (u) => (u.plan === "pro" && (!u.pro_hasta || u.pro_hasta >= hoy()) ? "pro" : "free");
const publico = (u) => ({ correo: u.correo, nombre: u.nombre || "", perfil: u.perfil, prov: u.prov || "", plan: planVigente(u), proHasta: u.pro_hasta, cupon: u.cupon, solicitaPro: u.solicita_pro, creado: u.creado });

async function cupon(correo) {   // determinista: el mismo correo recibe siempre el mismo cupón
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("pecr-cupon:" + correo)));
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "PECR-" + [...h.slice(0, 5)].map((b) => A[b % A.length]).join("");
}
const leerJSON = async (request) => {
  if (!(request.headers.get("content-type") || "").includes("application/json")) return null;   // evita envíos de formularios de otros sitios
  return request.json().catch(() => null);
};

// ---------- /api/cuenta/* ----------
async function cuenta(request, env, u, pw) {
  if (!env.DB) return json({ error: "Las cuentas no están disponibles en este momento." }, 503, 0);
  await initDB(env);
  const ruta = u.pathname.slice("/api/cuenta/".length);
  const ahora = new Date().toISOString();

  if (ruta === "yo") {
    const us = await usuarioActual(request, env);
    let datos = null;
    if (us && us.datos) try { datos = JSON.parse(us.datos); } catch (_) {}
    return json({ user: us ? publico(us) : null, datos, admin: await esAdmin(request, pw) }, 200, 0);
  }
  if (request.method !== "POST" && request.method !== "PUT") return json({ error: "Método no permitido" }, 405, 0);
  const b = await leerJSON(request);
  if (!b) return json({ error: "Solicitud inválida" }, 400, 0);

  if (ruta === "crear") {
    const correo = String(b.correo || "").trim().toLowerCase().slice(0, 120), clave = String(b.clave || "");
    if (!CORREO_OK.test(correo)) return json({ error: "Revisa el correo: parece incompleto." }, 400, 0);
    if (clave.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400, 0);
    if (!b.acepto) return json({ error: "Para crear la cuenta, acepta la política de privacidad." }, 400, 0);
    if (await env.DB.prepare("SELECT id FROM usuarios WHERE correo = ?").bind(correo).first()) return json({ error: "Ya existe una cuenta con ese correo. Entra con tu contraseña.", existe: true }, 409, 0);
    const utm = b.utm || {};
    let fuente = [utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.ref].filter(Boolean).join("/").slice(0, 120);
    if (!fuente && env.REGISTROS) { const prev = await env.REGISTROS.getWithMetadata("r:" + correo).catch(() => null); if (prev && prev.metadata) fuente = prev.metadata.fuente || "registro previo"; }
    const h = await hashClave(clave), cp = await cupon(correo);
    const r = await env.DB.prepare(`INSERT INTO usuarios (correo, nombre, perfil, prov, hash, sal, cupon, fuente, pais, creado, ultimo) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
      .bind(correo, String(b.nombre || "").trim().slice(0, 80), PERFILES.has(b.perfil) ? b.perfil : "otro", String(b.prov || "").slice(0, 20), h.hash, h.sal, cp, fuente, (request.cf && request.cf.country) || "", ahora, ahora).first();
    return json({ ok: true, user: publico(r) }, 200, 0, { "Set-Cookie": await crearSesion(env, r) });
  }

  if (ruta === "entrar") {
    const correo = String(b.correo || "").trim().toLowerCase().slice(0, 120), clave = String(b.clave || "");
    const desde = Date.now() - 15 * 60 * 1000;
    await env.DB.prepare("DELETE FROM intentos WHERE ts < ?").bind(desde).run();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM intentos WHERE correo = ?").bind(correo).first();
    if (n && n.n >= 8) return json({ error: "Demasiados intentos. Espera 15 minutos o restablece tu contraseña." }, 429, 0);
    const us = await env.DB.prepare("SELECT * FROM usuarios WHERE correo = ?").bind(correo).first();
    if (!us || !igual((await hashClave(clave, us.sal)).hash, us.hash)) {
      await env.DB.prepare("INSERT INTO intentos (correo, ts) VALUES (?, ?)").bind(correo, Date.now()).run();
      return json({ error: "El correo o la contraseña no coinciden." }, 401, 0);
    }
    await env.DB.batch([env.DB.prepare("DELETE FROM intentos WHERE correo = ?").bind(correo), env.DB.prepare("UPDATE usuarios SET ultimo = ? WHERE id = ?").bind(ahora, us.id)]);
    return json({ ok: true, user: publico(us) }, 200, 0, { "Set-Cookie": await crearSesion(env, us) });
  }

  if (ruta === "olvide") {
    const correo = String(b.correo || "").trim().toLowerCase().slice(0, 120);
    const us = CORREO_OK.test(correo) ? await env.DB.prepare("SELECT id FROM usuarios WHERE correo = ?").bind(correo).first() : null;
    let enviado = false;
    if (us && env.RESEND_API_KEY) {
      const t = azar(24);
      await env.DB.prepare("INSERT INTO tokens (t, uid, vence) VALUES (?, ?, ?)").bind(t, us.id, Date.now() + 60 * 60 * 1000).run();
      const enlace = `${u.origin}/restablecer?t=${t}`;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.CORREO_DE || `PlanoExactoCR <${CONTACTO}>`, to: correo, subject: "Restablece tu contraseña de PlanoExactoCR",
          text: `Hola:\n\nPara elegir una contraseña nueva, abre este enlace (vale por una hora):\n${enlace}\n\nSi no lo pediste, ignora este correo.\n\nPlanoExactoCR` }) }).catch(() => null);
      enviado = !!(r && r.ok);
    }
    return json({ ok: true, enviado, contacto: CONTACTO }, 200, 0);   // misma respuesta exista o no la cuenta
  }

  if (ruta === "restablecer") {
    const t = String(b.t || ""), clave = String(b.clave || "");
    if (clave.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400, 0);
    const tk = await env.DB.prepare("SELECT * FROM tokens WHERE t = ?").bind(t).first();
    if (!tk || tk.vence < Date.now()) return json({ error: "El enlace venció o ya se usó. Pide uno nuevo." }, 400, 0);
    const h = await hashClave(clave);
    const us = await env.DB.prepare("UPDATE usuarios SET hash = ?, sal = ?, ver = ver + 1, ultimo = ? WHERE id = ? RETURNING *").bind(h.hash, h.sal, ahora, tk.uid).first();
    await env.DB.prepare("DELETE FROM tokens WHERE t = ? OR vence < ?").bind(t, Date.now()).run();
    return json({ ok: true }, 200, 0, { "Set-Cookie": await crearSesion(env, us) });
  }

  // Lo que sigue requiere sesión
  const us = await usuarioActual(request, env);
  if (!us) return json({ error: "Tu sesión terminó. Entra de nuevo." }, 401, 0);
  if (ruta === "datos") {
    const s = JSON.stringify(b.datos || {});
    if (s.length > 300000) return json({ error: "Demasiados datos guardados." }, 413, 0);
    await env.DB.prepare("UPDATE usuarios SET datos = ? WHERE id = ?").bind(s, us.id).run();
    return json({ ok: true }, 200, 0);
  }
  if (ruta === "perfil") {
    await env.DB.prepare("UPDATE usuarios SET nombre = ?, perfil = ?, prov = ? WHERE id = ?")
      .bind(String(b.nombre || "").trim().slice(0, 80), PERFILES.has(b.perfil) ? b.perfil : us.perfil, String(b.prov || "").slice(0, 20), us.id).run();
    return json({ ok: true }, 200, 0);
  }
  if (ruta === "clave") {
    if (!igual((await hashClave(String(b.actual || ""), us.sal)).hash, us.hash)) return json({ error: "La contraseña actual no coincide." }, 400, 0);
    if (String(b.clave || "").length < 8) return json({ error: "La contraseña nueva debe tener al menos 8 caracteres." }, 400, 0);
    const h = await hashClave(String(b.clave));
    const nu = await env.DB.prepare("UPDATE usuarios SET hash = ?, sal = ?, ver = ver + 1 WHERE id = ? RETURNING *").bind(h.hash, h.sal, us.id).first();
    return json({ ok: true }, 200, 0, { "Set-Cookie": await crearSesion(env, nu) });
  }
  if (ruta === "solicitar-pro") {
    await env.DB.prepare("UPDATE usuarios SET solicita_pro = ? WHERE id = ?").bind(ahora, us.id).run();
    return json({ ok: true }, 200, 0);
  }
  if (ruta === "borrar") {
    if (!igual((await hashClave(String(b.clave || ""), us.sal)).hash, us.hash)) return json({ error: "La contraseña no coincide." }, 400, 0);
    await env.DB.batch([env.DB.prepare("DELETE FROM tokens WHERE uid = ?").bind(us.id), env.DB.prepare("DELETE FROM usuarios WHERE id = ?").bind(us.id)]);
    return json({ ok: true }, 200, 0, { "Set-Cookie": galleta(COOKIE_USER, "", 0) });
  }
  return json({ error: "Ruta desconocida" }, 404, 0);
}

// ---------- /api/admin/* ----------
const csv = (filas, nombre) => new Response("﻿" + filas.map((f) => f.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\n"),
  { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "no-store" } });
async function admin(request, env, u) {
  if (!env.DB) return json({ error: "Falta la base de datos (D1)." }, 503, 0);
  await initDB(env);
  const ruta = u.pathname.slice("/api/admin/".length);
  if (ruta === "usuarios") {
    const r = await env.DB.prepare("SELECT id, correo, nombre, perfil, prov, plan, pro_hasta, cupon, fuente, pais, creado, ultimo, solicita_pro, nota FROM usuarios ORDER BY id DESC").all();
    return json({ usuarios: r.results, hoy: hoy() }, 200, 0);
  }
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405, 0);
  const b = await leerJSON(request);
  if (!b || !b.id) return json({ error: "Solicitud inválida" }, 400, 0);
  if (ruta === "usuario") {
    const plan = b.plan === "pro" ? "pro" : "free", hasta = /^\d{4}-\d{2}-\d{2}$/.test(b.pro_hasta || "") ? b.pro_hasta : null;
    await env.DB.prepare("UPDATE usuarios SET plan = ?, pro_hasta = ?, nota = ?, solicita_pro = CASE WHEN ? = 'pro' THEN NULL ELSE solicita_pro END WHERE id = ?")
      .bind(plan, plan === "pro" ? hasta : null, String(b.nota || "").slice(0, 300), plan, b.id).run();
    return json({ ok: true }, 200, 0);
  }
  if (ruta === "enlace") {   // enlace para que el usuario elija una contraseña nueva (vale 72 horas)
    const t = azar(24);
    await env.DB.prepare("INSERT INTO tokens (t, uid, vence) VALUES (?, ?, ?)").bind(t, b.id, Date.now() + 72 * 3600 * 1000).run();
    return json({ ok: true, enlace: `${u.origin}/restablecer?t=${t}` }, 200, 0);
  }
  return json({ error: "Ruta desconocida" }, 404, 0);
}
async function exportarUsuarios(env) {
  await initDB(env);
  const r = await env.DB.prepare("SELECT creado, correo, nombre, perfil, prov, plan, pro_hasta, cupon, fuente, pais, ultimo, solicita_pro FROM usuarios ORDER BY id").all();
  const cols = ["creado", "correo", "nombre", "perfil", "prov", "plan", "pro_hasta", "cupon", "fuente", "pais", "ultimo", "solicita_pro"];
  return csv([cols, ...r.results.map((x) => cols.map((c) => x[c]))], "usuarios-planoexactocr.csv");
}

// ---------- Registro previo de interesados (lista de espera, KV) ----------
async function registrar(request, env) {
  if (!env.REGISTROS) return json({ error: "El registro no está disponible en este momento." }, 503, 0);
  const b = await leerJSON(request);
  const correo = String((b && b.correo) || "").trim().toLowerCase().slice(0, 120);
  if (!CORREO_OK.test(correo)) return json({ error: "El correo no es válido." }, 400, 0);
  const previo = await env.REGISTROS.getWithMetadata("r:" + correo);
  if (previo && previo.metadata && previo.metadata.cupon) return json({ ok: true, cupon: previo.metadata.cupon, repetido: true }, 200, 0);
  const utm = b.utm || {};
  const meta = { correo, cupon: await cupon(correo), nombre: String(b.nombre || "").slice(0, 80), perfil: PERFILES.has(b.perfil) ? b.perfil : "otro", prov: String(b.prov || "").slice(0, 20),
    fuente: [utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.ref].filter(Boolean).join("/").slice(0, 120), fecha: new Date().toISOString(), pais: (request.cf && request.cf.country) || "" };
  await env.REGISTROS.put("r:" + correo, "1", { metadata: meta });
  return json({ ok: true, cupon: meta.cupon }, 200, 0);
}
async function exportarRegistros(env) {
  const filas = [["fecha", "correo", "nombre", "perfil", "provincia", "fuente", "pais", "cupon"]];
  let cursor;
  do {
    const l = await env.REGISTROS.list({ prefix: "r:", cursor });
    for (const k of l.keys) { const m = k.metadata || {}; filas.push([m.fecha, m.correo, m.nombre, m.perfil, m.prov, m.fuente, m.pais, m.cupon]); }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  return csv(filas, "lista-espera-planoexactocr.csv");
}

// ---------- Páginas generadas aquí ----------
const ESTILO = `:root{--bg:#F1EEE7;--panel:#FCFBF8;--ink:#15302A;--muted:#4C5953;--line:#DCD8CE;--accent:#1F5A47;--bad:#B42318}
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
a{color:var(--accent)}.err{color:var(--bad);font-size:13px;text-align:center}`;
const pagina = (titulo, cuerpo, status = 200) => new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PlanoExactoCR · ${titulo}</title><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/assets/img/favicon.png"><style>${ESTILO}</style></head><body>${cuerpo}</body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
const LOGO = '<img class="logo" src="/assets/img/logo.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="463">';
function paginaAdmin(error, sig) {
  return pagina("Administración", `<form class="card" method="post" action="/__acceso">${LOGO}
<h1>Administración</h1><p>Ingresa la contraseña del sitio.</p>${error ? '<div class="err" role="alert">La contraseña no es correcta. Intenta de nuevo.</div>' : ""}
<input type="hidden" name="sig" value="${String(sig || "/admin").replace(/[^\w\/.?=&#-]/g, "")}">
<label>Contraseña<input type="password" name="clave" autocomplete="current-password" required autofocus></label><button type="submit">Entrar</button>
<p><a href="/mapa">Volver al mapa</a></p></form>`, 401);
}
function paginaRestablecer(t) {
  return pagina("Nueva contraseña", `<form class="card" id="f">${LOGO}<h1>Elige una contraseña nueva</h1>
<label>Contraseña nueva<input type="password" id="c" minlength="8" autocomplete="new-password" required autofocus></label>
<div class="err" id="e" role="alert"></div><button type="submit">Guardar y entrar</button></form>
<script>document.getElementById('f').onsubmit=async ev=>{ev.preventDefault();const e=document.getElementById('e');e.textContent='';
const r=await fetch('/api/cuenta/restablecer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t:${JSON.stringify(t)},clave:document.getElementById('c').value})});
const j=await r.json().catch(()=>({}));if(r.ok)location.href='/mapa';else e.textContent=j.error||'No se pudo guardar.';};</script>`);
}

// ---------- Puente hacia servicios públicos ----------
async function get(url, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, headers: { "user-agent": "PlanoExactoCR/1.0" } }); }
  finally { clearTimeout(t); }
}
const SIN_SNIT = "El catastro del SNIT solo responde a consultas hechas desde Costa Rica, y este servidor está fuera del país. La búsqueda por plano o finca no está disponible por ahora; los remates del mapa sí están ubicados.";
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
      if (!r.ok) return json({ error: SIN_SNIT }, 502, 0);
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
    if (u.pathname === "/api/plano" || u.pathname === "/api/finca") return json({ error: SIN_SNIT }, 502, 0);
    return json({ error: "Servicio no disponible" }, 504, 0);
  }
}

// ---------- Catastro desde Costa Rica (botón «Ubicar remates») ----------
const REPO = "buenaventurag650gs-cloud/PlanoExactoCR";
const ORIGENES_SNIT = new Set(["https://www.snitcr.go.cr", "https://snitcr.go.cr"]);
function cors(request) {
  const o = request.headers.get("origin") || "";
  return ORIGENES_SNIT.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" } : {};
}
const b64 = (s) => { const b = enc.encode(s); let t = ""; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t); };
const deb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
async function gh(env, ruta, opts) {
  return fetch("https://api.github.com/repos/" + REPO + ruta, Object.assign({}, opts, { headers: { "Authorization": "Bearer " + env.GH_TOKEN, "Accept": "application/vnd.github+json", "User-Agent": "PlanoExactoCR", "Content-Type": "application/json" } }));
}
async function guardarCatastro(request, env) {
  const h = cors(request), j = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ "content-type": "application/json" }, h) });
  if (!env.GH_TOKEN) return j({ error: "Falta el token de GitHub (GH_TOKEN) en Cloudflare" }, 500);
  const nuevos = await request.json().catch(() => null);
  if (!nuevos || typeof nuevos !== "object") return j({ error: "Datos inválidos" }, 400);
  const ruta = "/contents/data/catastro_resultados.json";
  const actual = await gh(env, ruta + "?ref=main");
  let previo = {}, sha;
  if (actual.ok) { const a = await actual.json(); sha = a.sha; try { previo = JSON.parse(deb64(a.content)); } catch (_) {} }
  const put = await gh(env, ruta, { method: "PUT", body: JSON.stringify({ message: "Catastro: " + Object.keys(nuevos).length + " consultas desde el SNIT", content: b64(JSON.stringify(Object.assign(previo, nuevos))), sha, branch: "main" }) });
  if (!put.ok) return j({ error: "GitHub no aceptó el archivo (" + put.status + ")" }, 502);
  await gh(env, "/actions/workflows/actualizar.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });
  return j({ ok: true, guardados: Object.keys(nuevos).length });
}

// ---------- Remates para visitantes sin cuenta: solo lo que se ve en el mapa y la lista ----------
const VISIBLES = ["id", "prov", "finca", "der", "filial", "multi", "base", "mon", "f", "area", "tipo", "ll", "loc", "dc", "dn", "cn", "pn", "nom", "pubF", "bol", "bols"];
let LITE = { etag: null, body: null };
async function rematesLibres(u, env) {
  const r = await env.ASSETS.fetch(new Request(new URL("/data/remates.json", u)));
  const et = r.headers.get("etag") || "";
  if (LITE.body && et && LITE.etag === et) return LITE.body;
  const R = await r.json();
  const body = JSON.stringify(R.map((x) => { const o = { ent: {}, lite: 1 }; for (const k of VISIBLES) if (x[k] !== undefined) o[k] = x[k]; return o; }));
  LITE = { etag: et, body };
  return body;
}

const SOLO_ADMIN = new Set(["/admin", "/admin.html", "/catastro", "/catastro.html", "/data/pendientes.json", "/data/catastro_resultados.json", "/data/estado.json", "/admin/registros.csv", "/admin/usuarios.csv"]);
const INDEXABLES = new Set(["/", "/mapa", "/privacidad", "/robots.txt"]);

export default {
  async fetch(request, env) {
    const pw = env.SITE_PASSWORD;
    if (!pw) return txt("Sitio en configuración.", 503);
    const u = new URL(request.url);
    const p = u.pathname;

    // Dominio propio: todo lo demás redirige (salvo el botón del catastro, que ya guardó la dirección anterior)
    if (env.DOMINIO && u.hostname !== env.DOMINIO && !p.startsWith("/api/catastro/") && u.hostname !== "localhost")
      return Response.redirect(`https://${env.DOMINIO}${p}${u.search}`, 301);

    if (p.startsWith("/api/catastro/")) {
      const h = cors(request);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
      if (!(await esAdmin(request, pw))) return new Response(JSON.stringify({ error: "Contraseña incorrecta" }), { status: 401, headers: Object.assign({ "content-type": "application/json" }, h) });
      if (p === "/api/catastro/pendientes") {
        const r = await env.ASSETS.fetch(new Request(new URL("/data/pendientes.json", u), request));
        return new Response(r.body, { status: r.status, headers: Object.assign({ "content-type": "application/json", "cache-control": "no-store" }, h) });
      }
      if (p === "/api/catastro/resultados" && request.method === "POST") return guardarCatastro(request, env);
      return new Response("{}", { status: 404, headers: h });
    }
    if (p === "/__acceso" && request.method === "POST") {
      const f = await request.formData().catch(() => null);
      const sig = f ? String(f.get("sig") || "/admin") : "/admin";
      if (!f || !igual(String(f.get("clave") || ""), pw)) return paginaAdmin(true, sig);
      return new Response(null, { status: 303, headers: { "Location": sig.startsWith("/") && !sig.startsWith("//") ? sig : "/admin", "Set-Cookie": galleta(COOKIE_ADMIN, await firmaAdmin(pw), 2592000) } });
    }
    if (p === "/__salir") {
      const hs = new Headers({ "Location": "/" });
      hs.append("Set-Cookie", galleta(COOKIE_ADMIN, "", 0)); hs.append("Set-Cookie", galleta(COOKIE_USER, "", 0));
      return new Response(null, { status: 303, headers: hs });
    }
    if (p === "/api/registro" && request.method === "POST") return registrar(request, env);
    if (p.startsWith("/api/cuenta/")) return cuenta(request, env, u, pw);
    if (p === "/restablecer") return paginaRestablecer(u.searchParams.get("t") || "");

    const adm = await esAdmin(request, pw);
    if (SOLO_ADMIN.has(p) || p.startsWith("/api/admin/")) {
      if (!adm) return p.startsWith("/api/") || p.startsWith("/data/") ? json({ error: "Acceso restringido" }, 401, 0) : paginaAdmin(false, p);
      if (p.startsWith("/api/admin/")) return admin(request, env, u);
      if (p === "/admin/registros.csv") return env.REGISTROS ? exportarRegistros(env) : txt("Falta el almacenamiento de registros (KV).", 503);
      if (p === "/admin/usuarios.csv") return env.DB ? exportarUsuarios(env) : txt("Falta la base de datos (D1).", 503);
    }
    const ses = adm ? null : await leerSesion(request, env).catch(() => null);
    const dentro = adm || !!ses;

    // Rutas limpias: / (presentación), /mapa (la aplicación)
    if (p === "/index.html") return Response.redirect(new URL("/mapa" + u.search, u).toString(), 301);
    if (p === "/inicio.html") return Response.redirect(new URL("/" + u.search, u).toString(), 301);
    if ((p === "/expediente" || p === "/expediente.html") && !dentro) return Response.redirect(new URL("/mapa?entrar=1", u).toString(), 302);
    if ((p === "/api/plano" || p === "/api/finca") && !dentro) return json({ error: "Entra con tu cuenta para buscar planos y fincas." }, 401, 0);

    let res;
    if (p === "/data/remates.json" && !dentro) res = new Response(await rematesLibres(u, env), { headers: { "content-type": "application/json; charset=utf-8" } });
    else if (p.startsWith("/api/")) res = await api(u);
    else {
      // Los archivos estáticos se sirven sin «.html» (/inicio, /admin…) y index.html en «/»
      const archivo = p === "/" ? "/inicio" : p === "/mapa" ? "/" : null;
      res = await env.ASSETS.fetch(archivo ? new Request(new URL(archivo, u), request) : request);
    }
    const out = new Response(res.body, res);
    if (!(env.DOMINIO && u.hostname === env.DOMINIO && INDEXABLES.has(p))) out.headers.set("X-Robots-Tag", "noindex, nofollow");
    out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    out.headers.set("X-Content-Type-Options", "nosniff");
    if (p.startsWith("/data/")) out.headers.set("Cache-Control", dentro && p === "/data/remates.json" ? "private, max-age=0, must-revalidate" : "public, max-age=0, must-revalidate");
    if (p === "/data/remates.json") out.headers.set("Vary", "Cookie");
    if (p === "/" || p === "/mapa" || p.endsWith(".html")) out.headers.set("Cache-Control", "no-cache");
    return out;
  }
};
