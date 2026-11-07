import { EmailMessage } from "cloudflare:email";
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

// Si una promesa no se resuelve en `ms`, la rechaza igual: evita que una llamada atascada
// (por ejemplo a D1) deje una petición esperando para siempre en vez de fallar rápido.
const conLimite = (p, ms, msj) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msj)), ms))]);

// ---------- Base de datos (D1) ----------
let listo = null, SECRETO = null;
function initDB(env) {
  if (!listo) {
    const p = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, correo TEXT UNIQUE NOT NULL, nombre TEXT, perfil TEXT, prov TEXT,
        hash TEXT NOT NULL, sal TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 1, plan TEXT NOT NULL DEFAULT 'free', pro_hasta TEXT, cupon TEXT, fuente TEXT, pais TEXT,
        creado TEXT, ultimo TEXT, solicita_pro TEXT, nota TEXT, datos TEXT)`),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS tokens (t TEXT PRIMARY KEY, uid INTEGER NOT NULL, vence INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS intentos (correo TEXT NOT NULL, ts INTEGER NOT NULL)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS pagos (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, correo TEXT, concepto TEXT NOT NULL, cantidad INTEGER DEFAULT 1,
        monto INTEGER NOT NULL, descuento INTEGER DEFAULT 0, ref TEXT, telefono TEXT, estado TEXT NOT NULL DEFAULT 'pendiente', nota TEXT, creado TEXT, resuelto TEXT, img TEXT)`)
    ]).then(async (r) => {
      // Migraciones secundarias: cada una se aísla con su propio catch, para que si UNA falla
      // (columna o tabla nueva con algún problema) no arrastre a las demás ni deje `listo` sin
      // resolver — eso bloquearía /api/cuenta/yo, y con él, el mapa entero, para todo el mundo.
      for (const c of ["creditos INTEGER NOT NULL DEFAULT 0", "cupon_usado TEXT", "google_sub TEXT", "origen TEXT", "no_correos INTEGER NOT NULL DEFAULT 0",
        "referido_por TEXT", "dias_regalo INTEGER NOT NULL DEFAULT 0", "referido_premiado INTEGER NOT NULL DEFAULT 0"]) await env.DB.prepare("ALTER TABLE usuarios ADD COLUMN " + c).run().catch(() => {});
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS enlaces (t TEXT PRIMARY KEY, correo TEXT NOT NULL, vence INTEGER NOT NULL, datos TEXT)").run().catch(() => {});
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS campanas (campana TEXT NOT NULL, correo TEXT NOT NULL, enviado TEXT NOT NULL, PRIMARY KEY (campana, correo))").run().catch(() => {});
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS apoyo_legal (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, telefono TEXT, correo TEXT,
        juzgados TEXT NOT NULL DEFAULT '[]', zona TEXT, especialidad TEXT,
        activo INTEGER NOT NULL DEFAULT 1, notas TEXT, creado TEXT)`).run().catch(() => {});
      return r;
    });
    // Tiempo límite de 8 s: si D1 no responde, la petición falla rápido y con un error claro
    // en vez de dejar al navegador esperando sin fin (y a `listo` listo para reintentarlo).
    listo = conLimite(p, 8000, "La base de datos no respondió a tiempo.").catch((e) => { listo = null; throw e; });
  }
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
// Planes: free (cuenta gratis), basico (Esencial) y pro (acceso total). pro_hasta vale para los dos de pago.
const PLANES = new Set(["free", "basico", "pro"]);
const planVigente = (u) => (u.plan !== "free" && PLANES.has(u.plan) && (!u.pro_hasta || u.pro_hasta >= hoy()) ? u.plan : "free");
const publico = (u) => ({ correo: u.correo, nombre: u.nombre || "", perfil: u.perfil, prov: u.prov || "", plan: planVigente(u), proHasta: u.pro_hasta, cupon: u.cupon, solicitaPro: u.solicita_pro, creado: u.creado, creditos: u.creditos || 0, cuponUsado: !!u.cupon_usado });

// ---------- Pagos por SINPE Móvil: el usuario reporta el pago con su comprobante y el administrador lo aprueba ----------
// Precios en colones (deben coincidir con PX.PRECIOS en assets/core.js). El cupón especial del
// correo descuenta un 50 % de una mensualidad en el primer pago de un plan, solo con el código.
const CATALOGO = {
  "esencial-mes": { plan: "basico", meses: 1, monto: 5190, mensual: 5190, txt: "Plan Esencial · 1 mes" },
  "esencial-anual": { plan: "basico", meses: 12, monto: 51900, mensual: 5190, txt: "Plan Esencial · 1 año" },
  "pro-mes": { plan: "pro", meses: 1, monto: 11290, mensual: 11290, txt: "Plan PRO · 1 mes" },
  "pro-anual": { plan: "pro", meses: 12, monto: 112900, mensual: 11290, txt: "Plan PRO · 1 año" },
  "expedientes": { unidad: 5000, txt: "Expedientes adicionales" }
};
const CUPON_PCT = 0.5;   // cupón especial del correo: 50 % en la primera mensualidad, solo al escribir el código correcto al pagar
// El descuento NO se aplica solo: requiere que el usuario escriba su código (su propio cupón) al pagar.
// Así el sitio muestra precio completo y el 50 % queda exclusivo de quien recibe el correo.
function cotizar(us, concepto, cantidad, codigo) {
  const c = CATALOGO[concepto]; if (!c) return null;
  if (c.unidad) { const n = Math.max(1, Math.min(20, Math.round(Number(cantidad) || 1))); return { concepto, cantidad: n, monto: c.unidad * n, descuento: 0, txt: `${c.txt} · ${n}` }; }
  const valido = !!(codigo && us && us.cupon && !us.cupon_usado && String(codigo).trim().toUpperCase() === String(us.cupon).toUpperCase());
  const descuento = valido ? Math.round(c.mensual * CUPON_PCT) : 0;
  return { concepto, cantidad: 1, monto: c.monto - descuento, descuento, txt: c.txt };
}
const sumarMeses = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const sumarDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function cupon(correo) {   // determinista: el mismo correo recibe siempre el mismo cupón
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("pecr-cupon:" + correo)));
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "PECR-" + [...h.slice(0, 5)].map((b) => A[b % A.length]).join("");
}
const leerJSON = async (request) => {
  if (!(request.headers.get("content-type") || "").includes("application/json")) return null;   // evita envíos de formularios de otros sitios
  return request.json().catch(() => null);
};

// ---------- Avisos por correo al administrador ----------
// Usa el envío de correos de Cloudflare (binding AVISOS, tipo send_email) hacia AVISOS_A, que debe ser una
// dirección verificada en Email Routing. Si falta alguno de los dos, no hace nada.
async function avisar(env, asunto, lineas) {
  if (!env.AVISOS || !env.AVISOS_A) return;
  try {
    const de = "avisos@" + (env.DOMINIO || "planoexactocr.com");
    const cuerpo = b64(lineas.join("\n")).replace(/.{1,76}/g, "$&\r\n");
    const raw = [`From: PlanoExactoCR <${de}>`, `To: ${env.AVISOS_A}`, `Subject: =?UTF-8?B?${b64(asunto)}?=`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${azar(12)}@${env.DOMINIO || "planoexactocr.com"}>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", cuerpo].join("\r\n");
    await env.AVISOS.send(new EmailMessage(de, env.AVISOS_A, raw));
  } catch (_) {}   // un aviso fallido nunca impide el registro
}
const NOMPLAN = { free: "Gratis", basico: "Esencial", pro: "PRO" };

// ---------- Correo a usuarios (Resend) ----------
// Requiere la variable secreta RESEND_API_KEY y el dominio verificado en Resend. CORREO_DE: remitente (opcional).
async function enviarCorreo(env, para, asunto, texto, html) {
  return (await enviarCorreoDbg(env, para, asunto, texto, html)).ok;
}
// Igual que enviarCorreo, pero devuelve el motivo del fallo (se usa en /admin,
// donde conviene ver si falló por falta de API key, por Resend o por red).
async function enviarCorreoDbg(env, para, asunto, texto, html) {
  if (!env.RESEND_API_KEY) return { ok: false, error: "Falta configurar RESEND_API_KEY" };
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.CORREO_DE || `PlanoExactoCR <hola@${env.DOMINIO || "planoexactocr.com"}>`, to: para, subject: asunto, text: texto, html, reply_to: `hola@${env.DOMINIO || "planoexactocr.com"}` }) });
    if (r.ok) return { ok: true };
    const t = await r.text().catch(() => "");
    return { ok: false, error: `Resend respondió ${r.status}: ${t.slice(0, 200)}` };
  } catch (e) { return { ok: false, error: "Error de red: " + String((e && e.message) || e) }; }
}
const correoHTML = (titulo, parrafos, boton, enlace) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#15302A">
<p style="font-size:18px;font-weight:bold;margin:0 0 4px">PlanoExactoCR</p><p style="color:#4C5953;margin:0 0 20px;font-size:13px">Remates judiciales de Costa Rica en un mapa</p>
<h1 style="font-size:20px;margin:0 0 12px">${titulo}</h1>${parrafos.map((t) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${t}</p>`).join("")}
${boton ? `<p style="margin:20px 0"><a href="${enlace}" style="background:#1F5A47;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${boton}</a></p><p style="font-size:12px;color:#4C5953">Si el botón no funciona, copia este enlace: ${enlace}</p>` : ""}
<p style="font-size:12px;color:#4C5953;margin-top:24px">Si no solicitaste este correo, ignóralo.</p></div>`;

// ---------- Campañas de correo a usuarios existentes ----------
// Mensajes para disparar a mano desde /admin a quienes ya tienen cuenta y todavía
// no pagan un plan. Cada envío queda en "campanas" para no repetirle el mismo
// correo a la misma persona si se vuelve a pulsar el botón.
const correoHTMLCampana = (titulo, parrafos, extra, boton, enlace, env) => { const dom = (env && env.DOMINIO) || "planoexactocr.com"; return `<div style="background:#EEF2F0;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E3E7E5">
<div style="background:#1F5A47;height:6px;line-height:6px;font-size:0">&nbsp;</div>
<div style="padding:26px 28px 6px">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>
<td style="vertical-align:middle;padding-right:10px"><img src="https://${dom}/assets/img/correo-logo.png" width="40" height="27" alt="PlanoExactoCR" style="display:block"></td>
<td style="vertical-align:middle">
<div style="font-size:18px;font-weight:bold;color:#15302A;line-height:1.3">PlanoExactoCR</div>
<div style="color:#4C5953;font-size:12px">Remates judiciales de Costa Rica en un mapa</div>
</td></tr></table>
<h1 style="font-size:20px;margin:0 0 12px;color:#15302A">${titulo}</h1>
${parrafos.map((t) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px;color:#15302A">${t}</p>`).join("")}
${extra || ""}
${boton ? `<p style="margin:20px 0"><a href="${enlace}" style="background:#1F5A47;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${boton}</a></p>` : ""}
</div>
<div style="background:#F7F9F8;padding:14px 28px;border-top:1px solid #E3E7E5">
<p style="font-size:12px;color:#4C5953;margin:0">Te escribimos porque tenés una cuenta en PlanoExactoCR. Si preferís no recibir estos correos, respondé este mensaje y te quitamos de la lista.</p>
</div></div></div>`; };
// Imagen satelital (Esri World Imagery) centrada en el punto del remate, con el
// recuadro (bbox) calculado para el tamaño de salida que se pide — sin llave de API.
function miniMapaURL(ll, altoM) {
  if (!Array.isArray(ll) || ll.length < 2) return null;
  const [lon, lat] = ll;
  const ANCHO = 600, ALTO = 300, ALTO_M = altoM || 340;   // metros de norte a sur que abarca la imagen
  const latD = (ALTO_M / 2) / 111320;
  const lonD = (ALTO_M / 2) * (ANCHO / ALTO) / (111320 * Math.cos(lat * Math.PI / 180));
  const bbox = [lon - lonD, lat - latD, lon + lonD, lat + latD].join(",");
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=102100&size=${ANCHO},${ALTO}&format=jpg&f=image`;
}
// Metros N-S que debe abarcar el mapa del correo. Zoom adaptativo (el lote ocupa ~1/3 del
// encuadre), pero con un MÍNIMO de 150 m: por debajo de eso, el satélite de Esri pediría un
// zoom (~z19+) que no existe en todo el país y la imagen sale rota. 150 m ≈ z18, que Esri sí
// tiene siempre; el polígono SVG marca el lote con precisión aunque se vea chico.
function altoCorreo(r) {
  if (!r || !r.poly || !r.ll) return 220;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const pg of r.poly) for (const ring of pg) for (const [x, y] of ring) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  if (!isFinite(minx)) return 220;
  const hM = (maxy - miny) * 111320, wM = (maxx - minx) * 111320 * Math.cos(r.ll[1] * Math.PI / 180);
  return Math.max(150, Math.min(380, Math.max(hM, wM / 2) * 3));
}

// ---------- Mini-plano del predio para el correo ----------
// Plano técnico (no foto aérea): fondo claro con cuadrícula a escala real, el polígono del
// lote dibujado (casing blanco + relleno + borde terracota), flecha norte y barra de escala.
// Se dibuja entero acá y se entrega como UNA sola imagen PNG —sin fetch externo ni llave de
// API— para que se vea idéntico en cualquier cliente de correo, Gmail incluido (que elimina
// SVG, position:absolute y data: URIs).
const MERC_R = 6378137;
const aMerc = ([lon, lat]) => [MERC_R * lon * Math.PI / 180, MERC_R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const secLat = (lat) => 1 / Math.cos(lat * Math.PI / 180);   // unidades mercator → metros ≈ × cos(lat)
async function desinflar(bytes) {
  const cs = new CompressionStream("deflate"), w = cs.writable.getWriter(); w.write(bytes); w.close();
  const partes = [], rd = cs.readable.getReader();
  for (; ;) { const { done, value } = await rd.read(); if (done) break; partes.push(value); }
  let n = 0; partes.forEach((p) => n += p.length); const out = new Uint8Array(n); let o = 0; partes.forEach((p) => { out.set(p, o); o += p.length; }); return out;
}
async function inflar(bytes) {
  const ds = new DecompressionStream("deflate"), w = ds.writable.getWriter(); w.write(bytes); w.close();
  const partes = [], rd = ds.readable.getReader();
  for (; ;) { const { done, value } = await rd.read(); if (done) break; partes.push(value); }
  let n = 0; partes.forEach((p) => n += p.length); const out = new Uint8Array(n); let o = 0; partes.forEach((p) => { out.set(p, o); o += p.length; }); return out;
}
const paethPred = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
// Decodifica un PNG (colorType 2/6/3, 8 bits) a RGBA. Para la base topográfica del correo.
async function decodificarPNG(buf) {
  if (buf[0] !== 137 || buf[1] !== 80) throw new Error("no es PNG");
  let p = 8, w = 0, h = 0, bd = 0, ct = 0, plte = null, trns = null; const idat = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (p < buf.length) {
    const len = dv.getUint32(p), t = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    if (t === "IHDR") { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); bd = buf[p + 16]; ct = buf[p + 17]; }
    else if (t === "PLTE") plte = buf.subarray(p + 8, p + 8 + len);
    else if (t === "tRNS") trns = buf.subarray(p + 8, p + 8 + len);
    else if (t === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (t === "IEND") break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error("bd " + bd);
  const ch = ct === 2 ? 3 : ct === 6 ? 4 : ct === 0 ? 1 : ct === 3 ? 1 : -1;
  if (ch < 0) throw new Error("ct " + ct);
  let comp = 0; idat.forEach((d) => comp += d.length); const cb = new Uint8Array(comp); let o = 0; idat.forEach((d) => { cb.set(d, o); o += d.length; });
  const raw = await inflar(cb), stride = w * ch, out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride); let sp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[sp++];
    for (let i = 0; i < stride; i++) { const x = raw[sp++], a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0; let v; if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1); else if (f === 4) v = x + paethPred(a, b, c); else v = x; cur[i] = v & 0xff; }
    for (let xx = 0; xx < w; xx++) { const di = (y * w + xx) * 4; if (ct === 3) { const idx = cur[xx]; out[di] = plte ? plte[idx * 3] : 0; out[di + 1] = plte ? plte[idx * 3 + 1] : 0; out[di + 2] = plte ? plte[idx * 3 + 2] : 0; out[di + 3] = trns && idx < trns.length ? trns[idx] : 255; } else { const si = xx * ch; out[di] = cur[si]; out[di + 1] = ch >= 3 ? cur[si + 1] : cur[si]; out[di + 2] = ch >= 3 ? cur[si + 2] : cur[si]; out[di + 3] = ch === 4 ? cur[si + 3] : 255; } }
    prev.set(cur);
  }
  return { w, h, data: out };
}
// Trae una capa de Esri (base o referencia) como RGBA del tamaño pedido, o null si falla.
async function esriCapa(servicio, bx0, by0, bx1, by1, W, H, fmt) {
  try {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/${servicio}/MapServer/export?bbox=${bx0},${by0},${bx1},${by1}&bboxSR=102100&imageSR=102100&size=${W},${H}&format=${fmt}&transparent=true&f=image`;
    const resp = await fetch(url, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!resp.ok) return null;
    const img = await decodificarPNG(new Uint8Array(await resp.arrayBuffer()));
    return (img.w === W && img.h === H) ? img : null;
  } catch (e) { return null; }
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
async function codificarPNG(img) {
  const { w, h, rgb } = img, raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const idat = await desinflar(raw), ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const partes = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  let n = 0; partes.forEach((p) => n += p.length); const out = new Uint8Array(n); let o = 0; partes.forEach((p) => { out.set(p, o); o += p.length; }); return out;
}
function mezclar(rgb, i, cr, cg, cb, a) { rgb[i] = (cr * a + rgb[i] * (1 - a)) | 0; rgb[i + 1] = (cg * a + rgb[i + 1] * (1 - a)) | 0; rgb[i + 2] = (cb * a + rgb[i + 2] * (1 - a)) | 0; }
function rellenarPoly(img, rings, cr, cg, cb, a) {
  const { w, h, rgb } = img; let ymin = h, ymax = 0;
  for (const r of rings) for (const pt of r) { if (pt[1] < ymin) ymin = pt[1]; if (pt[1] > ymax) ymax = pt[1]; }
  ymin = Math.max(0, Math.floor(ymin)); ymax = Math.min(h - 1, Math.ceil(ymax));
  for (let y = ymin; y <= ymax; y++) {
    const yc = y + 0.5, xs = [];
    for (const r of rings) for (let i = 0, n = r.length; i < n; i++) {
      const p1 = r[i], p2 = r[(i + 1) % n];
      if ((p1[1] <= yc && p2[1] > yc) || (p2[1] <= yc && p1[1] > yc)) xs.push(p1[0] + (yc - p1[1]) / (p2[1] - p1[1]) * (p2[0] - p1[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(w - 1, Math.round(xs[k + 1])); for (let x = xa; x <= xb; x++) mezclar(rgb, (y * w + x) * 3, cr, cg, cb, a); }
  }
}
function sello(img, cx, cy, rad, cr, cg, cb, a) {
  const { w, h, rgb } = img, x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad)), y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad)), r2 = rad * rad;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy <= r2) mezclar(rgb, (y * w + x) * 3, cr, cg, cb, a); }
}
function trazarPoly(img, rings, rad, cr, cg, cb, a) {
  for (const r of rings) for (let i = 0, n = r.length; i < n; i++) {
    const p1 = r[i], p2 = r[(i + 1) % n], dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy), pasos = Math.max(1, Math.ceil(len / (rad * 0.6)));
    for (let s = 0; s <= pasos; s++) sello(img, p1[0] + dx * s / pasos, p1[1] + dy * s / pasos, rad, cr, cg, cb, a);
  }
}
// Lienzo de color sólido y primitivas de dibujo (líneas, rectángulos, texto).
function lienzo(W, H, r, g, b) { const rgb = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) { rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b; } return { w: W, h: H, rgb }; }
function pintarPx(img, x, y, cr, cg, cb, a) { if (x < 0 || y < 0 || x >= img.w || y >= img.h) return; mezclar(img.rgb, (y * img.w + x) * 3, cr, cg, cb, a); }
function hLinea(img, x0, x1, y, cr, cg, cb, a) { y = Math.round(y); for (let x = Math.round(x0); x <= Math.round(x1); x++) pintarPx(img, x, y, cr, cg, cb, a); }
function vLinea(img, x, y0, y1, cr, cg, cb, a) { x = Math.round(x); for (let y = Math.round(y0); y <= Math.round(y1); y++) pintarPx(img, x, y, cr, cg, cb, a); }
function rectangulo(img, x0, y0, x1, y1, cr, cg, cb, a) { for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) pintarPx(img, x, y, cr, cg, cb, a); }
// Fuente de mapa de bits 3×5 (y 5×5 para la "m") para la escala y la "N".
const FUENTE = { "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"], "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"], "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"], "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"], "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"], "m": ["00000", "00000", "11110", "10101", "10101"], "k": ["100", "101", "110", "101", "101"], "N": ["1001", "1101", "1011", "1011", "1001"], " ": ["000", "000", "000", "000", "000"] };
function textoPlano(img, s, x, y, sc, cr, cg, cb) { let cx = x; for (const ch of s) { const g = FUENTE[ch] || FUENTE[" "], gw = g[0].length; for (let r = 0; r < 5; r++) for (let c = 0; c < gw; c++) if (g[r][c] === "1") rectangulo(img, cx + c * sc, y + r * sc, cx + c * sc + sc - 1, y + r * sc + sc - 1, cr, cg, cb, 1); cx += (gw + 1) * sc; } }
// Devuelve el PNG (Uint8Array) del mini-plano técnico del remate r, o null si no se puede.
async function planoCorreoPNG(r) {
  try {
    if (!r || !r.poly || !r.poly.length) return null;
    const W = 600, H = 360, latC = r.ll ? r.ll[1] : 9.9;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const ringsM = [];
    for (const pg of r.poly) for (const ring of pg) {
      const rm = ring.map(aMerc); ringsM.push(rm);
      for (const m of rm) { if (m[0] < x0) x0 = m[0]; if (m[0] > x1) x1 = m[0]; if (m[1] < y0) y0 = m[1]; if (m[1] > y1) y1 = m[1]; }
    }
    if (!ringsM.length || !isFinite(x0)) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let hw = (x1 - x0) / 2 * 2.3, hh = (y1 - y0) / 2 * 2.3;   // margen amplio alrededor del lote (contexto)
    const may = Math.max(hw, hh, 1); let k = 1; if (may < 28) k = 28 / may; else if (may > 600) k = 600 / may; hw *= k; hh *= k;
    const ar = W / H; if (hw / hh < ar) hw = hh * ar; else hh = hw / ar;
    const bx0 = cx - hw, bx1 = cx + hw, by0 = cy - hh, by1 = cy + hh;

    // Paso de escala "redondo" (para la barra de escala y la cuadrícula de respaldo).
    const spanMx = (bx1 - bx0) / secLat(latC);   // ancho en metros (aprox)
    const escalas = [2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
    let g = escalas[0]; for (const e of escalas) { g = e; if (spanMx / e <= 9) break; }
    const gM = g * secLat(latC);

    // Base del plano: imagen satelital (World_Imagery) con el polígono encima, como el
    // recuadro "Detalle del predio" de las fichas. Si no se puede traer, cuadrícula local.
    let img = null, sat = false;
    const base = await esriCapa("World_Imagery", bx0, by0, bx1, by1, W, H, "png24");
    if (base) {
      sat = true; img = { w: W, h: H, rgb: new Uint8Array(W * H * 3) };
      for (let i = 0; i < W * H; i++) { img.rgb[i * 3] = base.data[i * 4]; img.rgb[i * 3 + 1] = base.data[i * 4 + 1]; img.rgb[i * 3 + 2] = base.data[i * 4 + 2]; }
    } else {
      img = lienzo(W, H, 244, 245, 242);
      for (let mx = Math.ceil(bx0 / gM) * gM; mx <= bx1; mx += gM) vLinea(img, (mx - bx0) / (bx1 - bx0) * W, 0, H - 1, 214, 221, 216, 0.9);
      for (let my = Math.ceil(by0 / gM) * gM; my <= by1; my += gM) hLinea(img, 0, W - 1, (by1 - my) / (by1 - by0) * H, 214, 221, 216, 0.9);
    }

    // Polígono del lote
    const toPx = (m) => [(m[0] - bx0) / (bx1 - bx0) * W, (by1 - m[1]) / (by1 - by0) * H];
    const ringsPx = ringsM.map((r) => r.map(toPx));
    trazarPoly(img, ringsPx, 4.5, 255, 255, 255, 0.95);    // casing blanco
    rellenarPoly(img, ringsPx, 232, 149, 111, sat ? 0.3 : 0.45);   // relleno terracota translúcido
    trazarPoly(img, ringsPx, 2.6, 200, 85, 61, 1);         // borde terracota

    // Color de los elementos (norte/escala): blanco sobre satélite, verde oscuro sobre la cuadrícula.
    const U0 = sat ? 255 : 21, U1 = sat ? 255 : 48, U2 = sat ? 255 : 42;
    const fondo = (x0b, y0b, x1b, y1b) => { if (sat) rectangulo(img, x0b, y0b, x1b, y1b, 15, 25, 20, 0.42); };

    // Flecha norte (arriba-derecha): "N" + punta + astil
    const nx = W - 26, ny = 16;
    fondo(nx - 14, ny - 4, nx + 14, ny + 44);
    textoPlano(img, "N", nx - 3, ny - 1, 3, U0, U1, U2);
    const ay = ny + 20;
    for (let yy = 0; yy <= 11; yy++) { const half = yy * 0.55; hLinea(img, nx - half, nx + half, ay + yy, U0, U1, U2, 1); }
    rectangulo(img, nx - 1, ay + 11, nx + 1, ay + 22, U0, U1, U2, 1);

    // Barra de escala (abajo-izquierda) = un paso de cuadrícula
    const barPx = gM / (bx1 - bx0) * W, sx = 16, sy = H - 24;
    fondo(sx - 6, sy - 22, sx + Math.max(barPx, 40) + 6, sy + 12);
    rectangulo(img, sx, sy, sx + barPx, sy + 6, U0, U1, U2, 1);
    rectangulo(img, sx, sy, sx + barPx / 2, sy + 6, sat ? 15 : 244, sat ? 25 : 245, sat ? 20 : 242, sat ? 0.5 : 1);
    hLinea(img, sx, sx + barPx, sy, U0, U1, U2, 1); hLinea(img, sx, sx + barPx, sy + 6, U0, U1, U2, 1);
    vLinea(img, sx, sy, sy + 6, U0, U1, U2, 1); vLinea(img, sx + barPx / 2, sy, sy + 6, U0, U1, U2, 1); vLinea(img, sx + barPx, sy, sy + 6, U0, U1, U2, 1);
    textoPlano(img, g >= 1000 ? (g / 1000 + " km") : (g + " m"), sx, sy - 16, 3, U0, U1, U2);

    return await codificarPNG(img);
  } catch (e) { return null; }
}
// Endpoint público para el <img> del correo: /api/plano-correo?id=<id>. Devuelve el PNG
// del mini-plano (cacheado); si el remate no tiene polígono, redirige a la imagen satelital.
async function planoCorreo(request, env, u) {
  // Diagnóstico: /api/plano-correo?debug=1 prueba el bbox REAL de las 3 propiedades del
  // correo (y reporta formato PNG, tamaño y tiempo de decodificación) para ver por qué falla.
  if (u.searchParams.get("debug")) {
    const out = [];
    try {
      const props = await mejoresPropiedades(u, env, 3);
      for (const r of props) {
        const W = 600, H = 360; const row = { id: r.id, loc: r.cn };
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const pg of r.poly) for (const ring of pg) for (const pt of ring) { const m = aMerc(pt); if (m[0] < x0) x0 = m[0]; if (m[0] > x1) x1 = m[0]; if (m[1] < y0) y0 = m[1]; if (m[1] > y1) y1 = m[1]; }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; let hw = (x1 - x0) / 2 * 1.9, hh = (y1 - y0) / 2 * 1.9;
        const may = Math.max(hw, hh, 1); let k = 1; if (may < 16) k = 16 / may; else if (may > 600) k = 600 / may; hw *= k; hh *= k;
        const ar = W / H; if (hw / hh < ar) hw = hh * ar; else hh = hw / ar;
        const bx0 = cx - hw, bx1 = cx + hw, by0 = cy - hh, by1 = cy + hh;
        row.spanM = Math.round((bx1 - bx0) / secLat(r.ll ? r.ll[1] : 9.9));
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bx0},${by0},${bx1},${by1}&bboxSR=102100&imageSR=102100&size=${W},${H}&format=png24&f=image`;
        try {
          const resp = await fetch(url); row.status = resp.status; row.type = resp.headers.get("content-type");
          const ab = await resp.arrayBuffer(), b = new Uint8Array(ab); row.bytes = ab.byteLength;
          if (b[0] === 137) { const dv = new DataView(b.buffer, b.byteOffset); row.ihdr = { w: dv.getUint32(16), h: dv.getUint32(20), bitDepth: b[24], colorType: b[25], interlace: b[28] }; }
          else row.head = String.fromCharCode(...b.slice(0, 40)).replace(/[^\x20-\x7e]/g, ".");
          try { const t0 = Date.now(); const img = await decodificarPNG(b); row.decoded = img.w + "x" + img.h; row.decodeMs = Date.now() - t0; } catch (de) { row.decodeErr = String(de && de.message || de).slice(0, 160); }
        } catch (e) { row.fetchErr = String(e && e.message || e).slice(0, 160); }
        out.push(row);
      }
    } catch (e) { out.push({ error: String(e && e.message || e).slice(0, 200) }); }
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const id = String(u.searchParams.get("id") || "").slice(0, 16), v = String(u.searchParams.get("v") || "").slice(0, 4);
  const cache = caches.default, clave = new Request("https://" + u.host + "/api/plano-correo?id=" + encodeURIComponent(id) + "&v=" + encodeURIComponent(v));
  const hit = await cache.match(clave).catch(() => null); if (hit) return hit;
  let png = null, rem = null;
  try {
    const r = await env.ASSETS.fetch(new Request(new URL("/data/remates.json", u)));
    const R = await r.json(); rem = R.find((x) => String(x.id) === id);
    if (rem) png = await planoCorreoPNG(rem);
  } catch (e) {}
  if (!png) return new Response("", { status: 404 });
  const resp = new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "X-Robots-Tag": "noindex" } });
  try { await cache.put(clave, resp.clone()); } catch (e) {}
  return resp;
}
// Capa SVG con el polígono del lote, posicionada sobre la imagen satelital del correo.
// Usa el MISMO recuadro (bbox) que miniMapaURL para que el polígono calce con la imagen.
function svgPoligonoCorreo(r, altoM) {
  if (!r || !r.ll || !r.poly || !r.poly.length) return "";
  const [lon, lat] = r.ll, ALTO_M = altoM || 340;
  const lonD = (ALTO_M / 2) * (600 / 300) / (111320 * Math.cos(lat * Math.PI / 180)), latD = (ALTO_M / 2) / 111320;
  const lon0 = lon - lonD, lat1 = lat + latD;
  const px = (v) => ((v - lon0) / (2 * lonD) * 600).toFixed(1), py = (v) => ((lat1 - v) / (2 * latD) * 300).toFixed(1);
  let d = "";
  for (const pg of r.poly) for (const ring of pg) { if (!ring.length) continue; d += "M" + ring.map(([x, y]) => px(x) + "," + py(y)).join("L") + "Z"; }
  if (!d) return "";
  return `<svg viewBox="0 0 600 300" preserveAspectRatio="none" width="600" height="300" style="position:absolute;top:0;left:0;width:100%;height:100%" aria-hidden="true"><path d="${d}" fill="#C8553D" fill-opacity="0.28" fill-rule="evenodd" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="${d}" fill="none" fill-rule="evenodd" stroke="#C8553D" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
}
// Tarjeta de una propiedad destacada dentro del correo: mini-mapa satelital con el
// polígono del lote marcado, tipo + índice PECR, ubicación, área, base y fecha.
function tarjetaPropiedadCorreo(r, env) {
  const dom = env.DOMINIO || "planoexactocr.com";
  const loc = [r.cn, r.pn].filter(Boolean).join(", ");
  const st = r.st || 0;
  const fecha = (r.f && r.f[st]) ? fechaTxt(r.f[st]) : "";
  const etapa = ETAPA[st] || "";
  const baseActual = r.base != null ? r.base * (PCT[st] || 1) : null;
  const enlace = `https://${dom}/mapa#r${r.id}`;
  // Imagen satelital centrada en el lote con el polígono dibujado encima (capa SVG), con un
  // zoom adaptativo al tamaño del lote. La imagen es un <img> directo (sin procesamiento del
  // worker) y el polígono usa el mismo recuadro, así calza exacto.
  const altoM = altoCorreo(r);
  const mapa = miniMapaURL(r.ll, altoM);
  const imgBloque = mapa ? `<div style="position:relative;line-height:0">
<img src="${mapa}" width="600" height="300" alt="Ubicación del lote" style="display:block;width:100%;height:auto;border-radius:9px 9px 0 0">
${svgPoligonoCorreo(r, altoM)}</div>` : "";
  return { enlace, loc, fecha,
    html: `<a href="${enlace}" style="display:block;text-decoration:none;color:inherit;border:1px solid #E3E7E5;border-radius:10px;margin:0 0 10px;background:#F7F9F8;overflow:hidden">
${imgBloque}<div style="padding:12px 16px 14px">
<div style="font-size:11px;color:#1F5A47;font-weight:bold;text-transform:uppercase;letter-spacing:.4px;margin:0 0 5px">${esc(tipoTxt(r.tipo))} &middot; Índice PECR ${r.pecr}/10</div>
<div style="font-size:15px;font-weight:bold;color:#15302A;margin:0 0 3px">${esc(loc || "Costa Rica")}</div>
<div style="font-size:13px;color:#4C5953;margin:0 0 8px">${r.area ? miles(r.area) + " m² &middot; " : ""}${dinero(baseActual, r.mon)}${fecha ? " &middot; " + etapa + " el " + fecha : ""}</div>
<span style="font-size:13px;color:#1F5A47;font-weight:bold">Ver en el mapa →</span></div></a>` };
}
const CAMPANAS = {
  tour: {
    nombre: "Tour rápido + cupón de 50 %",
    construir: (us, props, env) => {
      const dom = (env && env.DOMINIO) || "planoexactocr.com";
      const cp = us.cupon || "EJEMPLO50";
      const pct = Math.round(CUPON_PCT * 100);
      const nombre = us.nombre ? esc(String(us.nombre).trim().split(/\s+/)[0]) : "";
      const asunto = nombre ? `${nombre}, tu cupón de ${pct} % en PlanoExactoCR` : `Tu cupón de ${pct} % en PlanoExactoCR`;
      const parrafos = [
        nombre ? `Hola ${nombre},` : "Hola,",
        "PlanoExactoCR junta en un solo mapa todos los remates judiciales vigentes en Costa Rica: ubicación exacta por plano o finca, zona homogénea de Hacienda, agua potable, electricidad, cobertura móvil, vías, ríos y distancia a la costa.",
        "Con tu cuenta gratis ya ves lo básico de cada remate. Con un plan de pago generás el expediente completo en PDF: gravámenes explicados, potencial constructivo, valor de referencia y los riesgos del lote, listo para imprimir o mandarle a quien decida con vos."
      ];
      // Cupón especial del correo: 50 % con el código, escribiéndolo al pagar.
      const cupon = `<div style="margin:4px 0 22px;border:2px solid #C8553D;border-radius:12px;background:#FBF1EE;padding:18px 20px;text-align:center">
<p style="font-size:12px;font-weight:bold;color:#C8553D;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 6px">Cupón especial &middot; solo por correo</p>
<p style="font-size:24px;font-weight:bold;color:#15302A;margin:0 0 4px">${pct}&nbsp;% de descuento</p>
<p style="font-size:13px;color:#4C5953;margin:0 0 14px">en la primera mensualidad de cualquier plan. Escribí este código al pagar:</p>
<span style="display:inline-block;background:#fff;border:2px dashed #C8553D;border-radius:8px;padding:10px 24px;font-size:21px;font-weight:bold;letter-spacing:2px;color:#15302A">${esc(cp)}</span></div>`;
      const tarjetas = (props || []).map((r) => tarjetaPropiedadCorreo(r, env));
      const bloqueProps = tarjetas.length ? `<div style="margin:4px 0 20px">
<p style="font-size:13px;font-weight:bold;color:#15302A;text-transform:uppercase;letter-spacing:.4px;margin:0 0 10px">3 remates con mejor índice PECR esta semana</p>
${tarjetas.map((t) => t.html).join("")}</div>` : "";
      // Promo de referidos (2x1 con un compa): el amigo entra con 50 % y vos ganás un mes gratis.
      const refLink = `https://${dom}/mapa?ref=${encodeURIComponent(cp)}`;
      const promoRef = `<div style="margin:4px 0 22px;border:2px dashed #1F5A47;border-radius:12px;background:#F2F7F4;padding:16px 18px">
<p style="font-size:16px;font-weight:bold;color:#15302A;margin:0 0 6px">2&times;1: traé un compa y ganan los dos</p>
<p style="font-size:13px;color:#4C5953;margin:0 0 12px">Invitá a un amigo con tu enlace. Él entra con <b>${pct}&nbsp;% de descuento</b> en su primer mes y, cuando pague su primer plan, vos te ganás <b>un mes gratis</b> del tuyo.</p>
<a href="${refLink}" style="background:#1F5A47;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;font-size:13px;display:inline-block">Compartir mi invitación</a></div>`;
      const extra = cupon + bloqueProps + promoRef;
      const enlace = `https://${dom}/mapa`;
      const cuponTexto = `\n\nCupón especial (solo por correo): ${pct} % de descuento en la primera mensualidad de cualquier plan. Escribí el código ${cp} al pagar.`;
      const propsTexto = tarjetas.length ? "\n\n3 remates con mejor índice PECR esta semana:\n" +
        tarjetas.map((t) => `- ${t.loc || "Costa Rica"} — ${t.fecha ? "remate el " + t.fecha + " — " : ""}${t.enlace}`).join("\n") : "";
      const refTexto = `\n\n2x1: traé un compa y ganan los dos. Invitá a un amigo con tu enlace: él entra con ${pct} % de descuento y vos te ganás un mes gratis cuando pague. ${refLink}`;
      const texto = parrafos.map((p) => p.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")).join("\n\n") + cuponTexto + propsTexto + refTexto + "\n\nVer el mapa: " + enlace;
      return { asunto, texto, html: correoHTMLCampana(asunto, parrafos, extra, "Ver mapa de remates", enlace, env) };
    }
  }
};
async function destinatariosCampana(env, id) {
  await initDB(env);
  const r = await env.DB.prepare(`SELECT id, correo, nombre, cupon, plan, pro_hasta FROM usuarios
    WHERE correo IS NOT NULL AND correo <> '' AND no_correos = 0
      AND (plan = 'free' OR plan IS NULL OR (plan <> 'free' AND (pro_hasta IS NULL OR pro_hasta < ?)))
      AND correo NOT IN (SELECT correo FROM campanas WHERE campana = ?)
    ORDER BY id`).bind(hoy(), id).all();
  return r.results;
}
// Elige las n propiedades con mejor índice PECR entre las que tienen fecha de remate
// futura y ubicación exacta (por plano o finca, no solo el centro del distrito), para
// mostrarlas como gancho en las campañas de correo.
// Clasifica un remate para variar las recomendaciones: costero (cerca del mar), urbano
// (zona homogénea tipo U) o rural (el resto).
function categoriaRemate(r) {
  const e = r.ent || {};
  if (e.costa != null && e.costa <= 3000) return "costero";
  const k = (e.zh && e.zh.k) || "";
  if (k.charAt(0) === "U") return "urbano";
  return "rural";
}
async function mejoresPropiedades(u, env, n) {
  try {
    const r = await env.ASSETS.fetch(new Request(new URL("/data/remates.json", u)));
    const R = await r.json();
    const ahora = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 16);   // hora de Costa Rica
    // st = índice de la próxima fecha vigente (puede ser el 2.º o 3.er remate, no siempre f[0])
    const cand = R.map((x) => Object.assign({}, x, { st: (x.f || []).findIndex((f) => f >= ahora) }))
      .filter((x) => (x.loc === "plano" || x.loc === "finca") && x.pecr != null && x.st >= 0 && x.poly && x.poly.length)
      .sort((a, b) => b.pecr - a.pecr || (a.f[a.st] < b.f[b.st] ? -1 : 1));
    // Una de cada categoría (costera, urbana, rural) para que el correo muestre variedad;
    // si alguna falta, se completa con las de mejor índice que queden.
    const elegidas = [], usados = new Set();
    for (const cat of ["costero", "urbano", "rural"]) {
      const m = cand.find((x) => !usados.has(x.id) && categoriaRemate(x) === cat);
      if (m) { elegidas.push(m); usados.add(m.id); }
    }
    for (const x of cand) { if (elegidas.length >= n) break; if (!usados.has(x.id)) { elegidas.push(x); usados.add(x.id); } }
    return elegidas.slice(0, n);
  } catch (e) { return []; }
}

// ---------- Ingreso sin contraseña: Google y enlace por correo ----------
const metodosIngreso = (env) => ({ google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), correo: !!env.RESEND_API_KEY });
async function cuentaPorCorreo(env, request, correo, extra) {
  let us = await env.DB.prepare("SELECT * FROM usuarios WHERE correo = ?").bind(correo).first();
  if (us) return { us, nuevo: false };
  const ahora = new Date().toISOString(), cp = await cupon(correo), e = extra || {};
  let fuente = String(e.fuente || "").slice(0, 120);
  if (!fuente && env.REGISTROS) { const prev = await env.REGISTROS.getWithMetadata("r:" + correo).catch(() => null); if (prev && prev.metadata) fuente = prev.metadata.fuente || "registro previo"; }
  // ?ref=<cupón de un amigo>: si el código existe y no es el propio, queda registrado para el 40 % del primer mes
  let referidoPor = null;
  const refCode = String(e.ref || "").trim().toUpperCase().slice(0, 20);
  if (refCode && refCode !== cp) {
    const r = await env.DB.prepare("SELECT cupon FROM usuarios WHERE cupon = ? AND correo <> ?").bind(refCode, correo).first();
    if (r) referidoPor = r.cupon;
  }
  const pct = Math.round(CUPON_PCT * 100);
  us = await env.DB.prepare(`INSERT INTO usuarios (correo, nombre, perfil, prov, hash, sal, cupon, fuente, pais, creado, ultimo, google_sub, origen, referido_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
    .bind(correo, String(e.nombre || "").slice(0, 80), PERFILES.has(e.perfil) ? e.perfil : "otro", String(e.prov || "").slice(0, 20), "-", azar(16), cp, fuente, (request.cf && request.cf.country) || "", ahora, ahora, e.sub || null, e.origen || "correo", referidoPor).first();
  await avisar(env, "Nueva cuenta: " + correo, ["Se creó una cuenta en PlanoExactoCR.", "", "Correo: " + correo, "Nombre: " + (us.nombre || "—"), "Entró con: " + (e.origen === "google" ? "Google" : "enlace por correo"),
    "Llegó por: " + (fuente || "directo"), "País: " + (us.pais || "—"), "Cupón: " + cp, referidoPor ? "Referido por: " + referidoPor : "", "", "Panel: https://" + (env.DOMINIO || "planoexactocr.com") + "/admin"].filter(Boolean));
  await enviarCorreo(env, correo, "Bienvenido a PlanoExactoCR: tu cupón " + cp, `Tu cuenta en PlanoExactoCR está lista.\n\nTu cupón especial: ${cp} — ${pct} % de descuento en la primera mensualidad de cualquier plan. Escribí el código al pagar para que se aplique.\n\nEntra al mapa: https://${env.DOMINIO || "planoexactocr.com"}/mapa`,
    correoHTML("Tu cuenta está lista", ["Ya puedes ver la información base de cada remate, guardar listas y generar un expediente PDF completo por semana.", `Tu cupón especial es <b style="font-size:18px;letter-spacing:1px">${cp}</b>: ${pct}&nbsp;% de descuento en la primera mensualidad de cualquier plan. Escribí el código al pagar para aplicarlo.`], "Ir al mapa", `https://${env.DOMINIO || "planoexactocr.com"}/mapa`));
  return { us, nuevo: true };
}
const volverA = (v) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/mapa");
async function ingresoExterno(request, env, u) {
  await initDB(env);
  const p = u.pathname, base = "https://" + (env.DOMINIO && u.hostname === env.DOMINIO ? env.DOMINIO : u.host);
  const redirigir = (dest, cookies) => { const h = new Headers({ "Location": dest, "cache-control": "no-store" }); (cookies || []).forEach((c) => h.append("Set-Cookie", c)); return new Response(null, { status: 302, headers: h }); };
  const fallo = (t) => pagina("No se pudo entrar", `<div class="card">${LOGO}<h1>No se pudo entrar</h1><p>${t}</p><p><a href="/mapa?entrar=1">Intentar de nuevo</a></p></div>`, 400);
  if (p === "/auth/google") {
    if (!metodosIngreso(env).google) return fallo("El ingreso con Google todavía no está configurado.");
    const st = azar(18), vuelta = volverA(u.searchParams.get("v")), utm = (u.searchParams.get("f") || "").slice(0, 120), ref = (u.searchParams.get("ref") || "").slice(0, 20);
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: base + "/auth/google/vuelta", response_type: "code", scope: "openid email profile", state: st, prompt: "select_account" });
    return redirigir("https://accounts.google.com/o/oauth2/v2/auth?" + q, [galleta("pecr_g", encodeURIComponent(JSON.stringify({ st, vuelta, utm, ref })), 600)]);
  }
  if (p === "/auth/google/vuelta") {
    let g = {}; try { g = JSON.parse(decodeURIComponent(leerCookie(request, "pecr_g") || "")); } catch (_) {}
    if (!g.st || g.st !== u.searchParams.get("state")) return fallo("La sesión de ingreso venció. Vuelve a intentarlo.");
    if (u.searchParams.get("error")) return redirigir("/mapa?entrar=1", [galleta("pecr_g", "", 0)]);
    const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: u.searchParams.get("code") || "", client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: base + "/auth/google/vuelta", grant_type: "authorization_code" }) });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.id_token) return fallo("Google no confirmó el ingreso.");
    let id = {}; try { id = JSON.parse(new TextDecoder().decode(b64uDec(tj.id_token.split(".")[1]))); } catch (_) {}
    // El token llega directo de Google por HTTPS (flujo de código del servidor): basta validar destinatario, emisor y vigencia
    if (id.aud !== env.GOOGLE_CLIENT_ID || !/accounts\.google\.com$/.test(id.iss || "") || (id.exp || 0) * 1000 < Date.now() || !id.email || id.email_verified === false) return fallo("No pudimos verificar tu cuenta de Google.");
    const correo = String(id.email).toLowerCase();
    let { us, nuevo } = await cuentaPorCorreo(env, request, correo, { nombre: id.name, sub: id.sub, origen: "google", fuente: g.utm, ref: g.ref });
    await env.DB.prepare("UPDATE usuarios SET ultimo = ?, google_sub = COALESCE(google_sub, ?), nombre = CASE WHEN nombre IS NULL OR nombre = '' THEN ? ELSE nombre END WHERE id = ?").bind(new Date().toISOString(), id.sub, String(id.name || "").slice(0, 80), us.id).run();
    return redirigir(nuevo ? "/mapa?bienvenida=1" : g.vuelta || "/mapa", [await crearSesion(env, us), galleta("pecr_g", "", 0)]);
  }
  if (p === "/auth/correo") {   // enlace recibido por correo
    const t = u.searchParams.get("t") || "";
    const e = await env.DB.prepare("SELECT * FROM enlaces WHERE t = ?").bind(t).first();
    if (!e || e.vence < Date.now()) return fallo("El enlace venció o ya se usó. Pide uno nuevo desde «Entrar».");
    await env.DB.prepare("DELETE FROM enlaces WHERE t = ? OR vence < ?").bind(t, Date.now()).run();
    let d = {}; try { d = JSON.parse(e.datos || "{}"); } catch (_) {}
    const { us, nuevo } = await cuentaPorCorreo(env, request, e.correo, Object.assign({ origen: "correo" }, d));
    await env.DB.prepare("UPDATE usuarios SET ultimo = ? WHERE id = ?").bind(new Date().toISOString(), us.id).run();
    return redirigir(nuevo ? "/mapa?bienvenida=1" : volverA(d.vuelta), [await crearSesion(env, us)]);
  }
  return null;
}

// ---------- /api/cuenta/* ----------
async function cuenta(request, env, u, pw) {
  if (!env.DB) return json({ error: "Las cuentas no están disponibles en este momento." }, 503, 0);
  await initDB(env);
  const ruta = u.pathname.slice("/api/cuenta/".length);
  const ahora = new Date().toISOString();

  if (ruta === "yo") {
    const us = await usuarioActual(request, env);
    let datos = null, user = null;
    if (us && us.datos) try { datos = JSON.parse(us.datos); } catch (_) {}
    if (us) {
      const rf = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE referido_por = ?").bind(us.cupon).first();
      user = Object.assign(publico(us), { referidos: (rf && rf.n) || 0, diasRegalo: us.dias_regalo || 0 });
    }
    return json({ user, datos, admin: await esAdmin(request, pw), ingreso: metodosIngreso(env) }, 200, 0);
  }
  if (ruta === "pagos" && request.method === "GET") {
    const us = await usuarioActual(request, env);
    if (!us) return json({ error: "Tu sesión terminó. Entra de nuevo." }, 401, 0);
    const r = await env.DB.prepare("SELECT id, concepto, cantidad, monto, descuento, ref, estado, nota, creado, resuelto FROM pagos WHERE uid = ? ORDER BY id DESC LIMIT 20").bind(us.id).all();
    return json({ pagos: r.results }, 200, 0);
  }
  if (request.method !== "POST" && request.method !== "PUT") return json({ error: "Método no permitido" }, 405, 0);
  const b = await leerJSON(request);
  if (!b) return json({ error: "Solicitud inválida" }, 400, 0);

  if (ruta === "crear") {
    const mi = metodosIngreso(env);
    if (mi.google || mi.correo) return json({ error: "Ahora las cuentas se crean con Google o con un enlace a tu correo, sin contraseña." }, 410, 0);
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
    await avisar(env, "Nueva cuenta: " + correo, ["Se creó una cuenta en PlanoExactoCR.", "", "Correo: " + correo, "Nombre: " + (r.nombre || "—"), "Perfil: " + r.perfil,
      "Provincia de interés: " + (r.prov || "Todo el país"), "Llegó por: " + (fuente || "directo"), "País: " + (r.pais || "—"), "Cupón: " + cp, "", "Panel: https://" + (env.DOMINIO || u.host) + "/admin"]);
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

  if (ruta === "enlace") {   // enviar enlace de ingreso (también crea la cuenta la primera vez)
    const correo = String(b.correo || "").trim().toLowerCase().slice(0, 120);
    if (!CORREO_OK.test(correo)) return json({ error: "Revisa el correo: parece incompleto." }, 400, 0);
    if (!env.RESEND_API_KEY) return json({ error: "El ingreso por correo todavía no está disponible." }, 503, 0);
    const desde = Date.now() - 15 * 60 * 1000;
    await env.DB.prepare("DELETE FROM intentos WHERE ts < ?").bind(desde).run();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM intentos WHERE correo = ?").bind("enlace:" + correo).first();
    if (n && n.n >= 4) return json({ error: "Ya te enviamos varios enlaces. Revisa tu correo (y la carpeta de spam) o espera unos minutos." }, 429, 0);
    await env.DB.prepare("INSERT INTO intentos (correo, ts) VALUES (?, ?)").bind("enlace:" + correo, Date.now()).run();
    const utm = b.utm || {}, t = azar(24), base = "https://" + (env.DOMINIO || u.host);
    const datos = { vuelta: volverA(b.vuelta), fuente: [utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.ref].filter(Boolean).join("/").slice(0, 120), ref: String(utm.ref || "").slice(0, 20) };
    await env.DB.prepare("INSERT INTO enlaces (t, correo, vence, datos) VALUES (?, ?, ?, ?)").bind(t, correo, Date.now() + 20 * 60 * 1000, JSON.stringify(datos)).run();
    const enlace = base + "/auth/correo?t=" + t;
    const ok = await enviarCorreo(env, correo, "Tu enlace para entrar a PlanoExactoCR", `Para entrar a PlanoExactoCR abre este enlace (vale 20 minutos):\n${enlace}\n\nSi no lo pediste, ignora este correo.`,
      correoHTML("Tu enlace para entrar", ["Haz clic en el botón para entrar a PlanoExactoCR. El enlace vale 20 minutos y sirve una sola vez.", "Si es tu primera vez, con este paso queda creada tu cuenta gratis."], "Entrar a PlanoExactoCR", enlace));
    if (!ok) return json({ error: "No pudimos enviar el correo. Intenta de nuevo en un momento." }, 502, 0);
    return json({ ok: true }, 200, 0);
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
  if (ruta === "cotizar") return json(Object.assign({ sinpe: env.SINPE_NUMERO || "", titular: env.SINPE_NOMBRE || "", referencia: us.cupon || us.correo }, cotizar(us, b.concepto, b.cantidad, b.codigo) || { error: "Concepto inválido" }), 200, 0);
  if (ruta === "pagar") {
    const q = cotizar(us, b.concepto, b.cantidad, b.codigo);
    if (!q) return json({ error: "Elige un plan o una cantidad de expedientes." }, 400, 0);
    const ref = String(b.ref || "").replace(/[^\w-]/g, "").slice(0, 40);
    if (ref.length < 4) return json({ error: "Escribe el número de comprobante del SINPE Móvil." }, 400, 0);
    let img = typeof b.img === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(b.img) ? b.img : null;
    if (img && img.length > 1400000) return json({ error: "La imagen del comprobante es muy pesada. Prueba con una captura de pantalla." }, 413, 0);
    const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM pagos WHERE uid = ? AND estado = 'pendiente'").bind(us.id).first();
    if (pend && pend.n >= 3) return json({ error: "Ya tienes pagos en revisión. Te avisaremos apenas los confirmemos." }, 429, 0);
    const r = await env.DB.prepare("INSERT INTO pagos (uid, correo, concepto, cantidad, monto, descuento, ref, telefono, creado, img) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id")
      .bind(us.id, us.correo, q.concepto, q.cantidad, q.monto, q.descuento, ref, String(b.telefono || "").replace(/[^\d]/g, "").slice(0, 12), ahora, img).first();
    await avisar(env, `Pago SINPE por revisar: ₡${q.monto} · ${us.correo}`, [`${us.nombre || us.correo} reportó un pago por SINPE Móvil.`, "", "Concepto: " + q.txt, "Monto: ₡" + q.monto + (q.descuento ? ` (con cupón, −₡${q.descuento})` : ""),
      "Comprobante: " + ref, "Teléfono desde el que pagó: " + (b.telefono || "—"), img ? "Adjuntó una captura del comprobante." : "Sin captura adjunta.", "", "Revísalo y actívalo en: https://" + (env.DOMINIO || u.host) + "/admin"]);
    return json({ ok: true, id: r.id, monto: q.monto }, 200, 0);
  }
  if (ruta === "pagos") {
    const r = await env.DB.prepare("SELECT id, concepto, cantidad, monto, descuento, ref, estado, nota, creado, resuelto FROM pagos WHERE uid = ? ORDER BY id DESC LIMIT 20").bind(us.id).all();
    return json({ pagos: r.results }, 200, 0);
  }
  if (ruta === "usar-credito") {   // un expediente adicional pagado
    const r = await env.DB.prepare("UPDATE usuarios SET creditos = creditos - 1 WHERE id = ? AND creditos > 0 RETURNING creditos").bind(us.id).first();
    if (!r) return json({ error: "No tienes expedientes adicionales disponibles." }, 400, 0);
    return json({ ok: true, creditos: r.creditos }, 200, 0);
  }
  if (ruta === "solicitar-pro") {
    const quiere = b.plan === "basico" ? "basico" : "pro";   // se guarda «plan fecha»
    await env.DB.prepare("UPDATE usuarios SET solicita_pro = ? WHERE id = ?").bind(quiere + " " + ahora, us.id).run();
    await avisar(env, `Solicitud de plan ${NOMPLAN[quiere]}: ${us.correo}`, [`${us.nombre || us.correo} pidió el plan ${NOMPLAN[quiere]}.`, "", "Correo: " + us.correo, "Plan actual: " + NOMPLAN[planVigente(us)], "Cupón: " + (us.cupon || "—"), "",
      "Para activarlo: https://" + (env.DOMINIO || u.host) + "/admin"]);
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
  if (ruta === "pagos") {
    const r = await env.DB.prepare("SELECT p.id, p.uid, p.correo, p.concepto, p.cantidad, p.monto, p.descuento, p.ref, p.telefono, p.estado, p.nota, p.creado, p.resuelto, (p.img IS NOT NULL) AS conimg, u.nombre, u.plan, u.pro_hasta FROM pagos p LEFT JOIN usuarios u ON u.id = p.uid ORDER BY (p.estado = 'pendiente') DESC, p.id DESC LIMIT 200").all();
    return json({ pagos: r.results }, 200, 0);
  }
  if (ruta === "pago-img") {
    const r = await env.DB.prepare("SELECT img FROM pagos WHERE id = ?").bind(Number(u.searchParams.get("id"))).first();
    if (!r || !r.img) return txt("Sin imagen", 404);
    const [cab, datos] = r.img.split(","), tipo = cab.slice(5, cab.indexOf(";"));
    return new Response(Uint8Array.from(atob(datos), (c) => c.charCodeAt(0)), { headers: { "content-type": tipo, "cache-control": "no-store" } });
  }
  if (ruta === "usuarios") {
    const r = await env.DB.prepare("SELECT id, correo, nombre, perfil, prov, plan, pro_hasta, cupon, fuente, pais, creado, ultimo, solicita_pro, nota, no_correos, referido_por, dias_regalo FROM usuarios ORDER BY id DESC").all();
    return json({ usuarios: r.results, hoy: hoy() }, 200, 0);
  }
  if (ruta === "actividad") {   // qué guardan y siguen los usuarios (agregado de la columna datos)
    const r = await env.DB.prepare("SELECT datos FROM usuarios WHERE datos IS NOT NULL AND datos <> ''").all();
    const sig = {}, fav = {}, busq = {};
    let conGuardado = 0, totSig = 0, totFav = 0, totListas = 0, totBusq = 0;
    for (const row of r.results) {
      let d; try { d = JSON.parse(row.datos); } catch (_) { continue; }
      let algo = false;
      for (const k of (d.sigo || [])) if (typeof k === "string") { sig[k] = (sig[k] || 0) + 1; totSig++; algo = true; }
      for (const l of (d.listas || [])) { totListas++; for (const it of (l.items || [])) { const k = it && it.k; if (typeof k === "string") { fav[k] = (fav[k] || 0) + 1; totFav++; algo = true; } } }
      for (const q of (d.busquedas || [])) { const t = typeof q === "string" ? q : (q && (q.q || q.texto)); if (t) { busq[t] = (busq[t] || 0) + 1; totBusq++; } }
      if (algo) conGuardado++;
    }
    const nombres = {};
    try { const rr = await env.ASSETS.fetch(new Request(new URL("/data/remates.json", u))); const R = await rr.json(); for (const x of R) nombres["r" + x.id] = { nom: x.nom || [x.cn, x.pn].filter(Boolean).join(", "), lugar: [x.cn, x.pn].filter(Boolean).join(", "), id: x.id, pecr: x.pecr }; } catch (_) {}
    const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ key: k, n: c, nom: (nombres[k] && nombres[k].nom) || k, lugar: nombres[k] && nombres[k].lugar, id: nombres[k] && nombres[k].id, pecr: nombres[k] && nombres[k].pecr }));
    return json({ totales: { usuariosConGuardado: conGuardado, seguidos: totSig, favoritos: totFav, listas: totListas, busquedas: totBusq }, topSeguidos: top(sig, 20), topFavoritos: top(fav, 20), topBusquedas: Object.entries(busq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, c]) => ({ t, n: c })) }, 200, 0);
  }
  if (ruta === "campanas") {
    const out = [];
    for (const id in CAMPANAS) {
      const c = CAMPANAS[id];
      const prev = c.construir({ cupon: "EJEMPLO50" }, [], env);
      const enviados = await env.DB.prepare("SELECT COUNT(*) AS n FROM campanas WHERE campana = ?").bind(id).first();
      const faltan = await destinatariosCampana(env, id);
      out.push({ id, nombre: c.nombre, asunto: prev.asunto, parrafos: prev.html, enviados: enviados.n, faltan: faltan.length });
    }
    return json({ campanas: out }, 200, 0);
  }
  if (ruta === "campana-destinatarios") {   // lista de elegibles (correo, nombre) para marcar con cajitas en /admin
    const id = u.searchParams.get("campana");
    if (!CAMPANAS[id]) return json({ error: "Campaña desconocida" }, 400, 0);
    const dest = await destinatariosCampana(env, id);
    return json({ destinatarios: dest.map((d) => ({ correo: d.correo, nombre: d.nombre })) }, 200, 0);
  }
  if (ruta === "campana") {   // probar o disparar una campaña de correo (no requiere b.id)
    if (request.method !== "POST") return json({ error: "Método no permitido" }, 405, 0);
    const b = await leerJSON(request);
    const c = b && CAMPANAS[b.campana];
    if (!c) return json({ error: "Campaña desconocida" }, 400, 0);
    if (b.accion === "prueba") {
      const correo = String(b.correo || "").trim().toLowerCase();
      if (!CORREO_OK.test(correo)) return json({ error: "Correo de prueba inválido" }, 400, 0);
      const props = await mejoresPropiedades(u, env, 3);
      const msg = c.construir({ cupon: "EJEMPLO50" }, props, env);
      const res = await enviarCorreoDbg(env, correo, "[Prueba] " + msg.asunto, msg.texto, msg.html);
      return json(res, res.ok ? 200 : 502, 0);
    }
    if (b.accion === "enviar") {
      const props = await mejoresPropiedades(u, env, 3);
      let dest = await destinatariosCampana(env, b.campana);
      if (Array.isArray(b.correos)) {   // el admin marcó destinatarios específicos con las cajitas
        const marcados = new Set(b.correos.map((x) => String(x).trim().toLowerCase()));
        dest = dest.filter((d) => marcados.has(String(d.correo).trim().toLowerCase()));
      }
      dest = dest.slice(0, 300);
      let enviados = 0, fallidos = 0, ultimoError = "";
      for (const us of dest) {
        const msg = c.construir(us, props, env);
        const res = await enviarCorreoDbg(env, us.correo, msg.asunto, msg.texto, msg.html);
        if (res.ok) { await env.DB.prepare("INSERT OR IGNORE INTO campanas (campana, correo, enviado) VALUES (?,?,?)").bind(b.campana, us.correo, new Date().toISOString()).run(); enviados++; }
        else { fallidos++; ultimoError = res.error || ""; }
      }
      return json({ ok: true, enviados, fallidos, total: dest.length, error: fallidos ? ultimoError : undefined }, 200, 0);
    }
    return json({ error: "Acción desconocida" }, 400, 0);
  }
  // ---------- apoyo legal (CRUD) ----------
  if (ruta === "apoyo-legal") {
    if (request.method === "POST") {
      const b = await leerJSON(request);
      if (!b || !b.accion) return json({ error: "Solicitud inválida" }, 400, 0);
      if (b.accion === "crear") {
        if (!b.nombre || !b.nombre.trim()) return json({ error: "El nombre es obligatorio" }, 400, 0);
        const juz = JSON.stringify(Array.isArray(b.juzgados) ? b.juzgados : []);
        await env.DB.prepare("INSERT INTO apoyo_legal (nombre, telefono, correo, juzgados, zona, especialidad, notas, activo, creado) VALUES (?,?,?,?,?,?,?,1,?)").bind(b.nombre.trim(), b.telefono || null, b.correo || null, juz, b.zona || null, b.especialidad || null, b.notas || null, new Date().toISOString()).run();
        return json({ ok: true }, 200, 0);
      }
      if (b.accion === "editar") {
        if (!b.id) return json({ error: "Falta id" }, 400, 0);
        const juz = JSON.stringify(Array.isArray(b.juzgados) ? b.juzgados : []);
        await env.DB.prepare("UPDATE apoyo_legal SET nombre=?, telefono=?, correo=?, juzgados=?, zona=?, especialidad=?, notas=? WHERE id=?").bind(b.nombre || '', b.telefono || null, b.correo || null, juz, b.zona || null, b.especialidad || null, b.notas || null, b.id).run();
        return json({ ok: true }, 200, 0);
      }
      if (b.accion === "toggle") {
        if (!b.id) return json({ error: "Falta id" }, 400, 0);
        await env.DB.prepare("UPDATE apoyo_legal SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE id = ?").bind(b.id).run();
        return json({ ok: true }, 200, 0);
      }
      if (b.accion === "eliminar") {
        if (!b.id) return json({ error: "Falta id" }, 400, 0);
        await env.DB.prepare("DELETE FROM apoyo_legal WHERE id = ?").bind(b.id).run();
        return json({ ok: true }, 200, 0);
      }
      return json({ error: "Acción desconocida" }, 400, 0);
    }
    // GET: listar todos
    const r = await env.DB.prepare("SELECT id, nombre, telefono, correo, juzgados, zona, especialidad, activo, notas, creado FROM apoyo_legal ORDER BY activo DESC, id DESC").all();
    return json({ abogados: r.results }, 200, 0);
  }

  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405, 0);
  const b = await leerJSON(request);
  if (!b || !b.id) return json({ error: "Solicitud inválida" }, 400, 0);
  if (ruta === "usuario") {
    const plan = PLANES.has(b.plan) ? b.plan : "free", hasta = /^\d{4}-\d{2}-\d{2}$/.test(b.pro_hasta || "") ? b.pro_hasta : null;
    await env.DB.prepare("UPDATE usuarios SET plan = ?, pro_hasta = ?, nota = ?, no_correos = ?, solicita_pro = CASE WHEN ? <> 'free' THEN NULL ELSE solicita_pro END WHERE id = ?")
      .bind(plan, plan !== "free" ? hasta : null, String(b.nota || "").slice(0, 300), b.no_correos ? 1 : 0, plan, b.id).run();
    return json({ ok: true }, 200, 0);
  }
  if (ruta === "pago") {   // aprobar o rechazar un pago reportado
    const pg = await env.DB.prepare("SELECT * FROM pagos WHERE id = ?").bind(b.id).first();
    if (!pg || pg.estado !== "pendiente") return json({ error: "Ese pago ya fue resuelto." }, 400, 0);
    const ahora = new Date().toISOString(), nota = String(b.nota || "").slice(0, 300);
    if (b.accion === "rechazar") { await env.DB.prepare("UPDATE pagos SET estado = 'rechazado', nota = ?, resuelto = ? WHERE id = ?").bind(nota, ahora, pg.id).run(); return json({ ok: true }, 200, 0); }
    const us = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(pg.uid).first();
    if (!us) return json({ error: "La cuenta ya no existe." }, 400, 0);
    const c = CATALOGO[pg.concepto], st = [env.DB.prepare("UPDATE pagos SET estado = 'aprobado', nota = ?, resuelto = ? WHERE id = ?").bind(nota, ahora, pg.id)];
    let hasta = null;
    if (c && c.plan) {
      const vigente = planVigente(us) === c.plan && us.pro_hasta && us.pro_hasta >= hoy() ? us.pro_hasta : hoy();   // renovación: se suma al final
      hasta = sumarMeses(vigente, c.meses);
      const regalo = us.dias_regalo || 0;   // días ganados por referir amigos: se consumen solos en la próxima activación o renovación
      if (regalo > 0) hasta = sumarDias(hasta, regalo);
      st.push(env.DB.prepare("UPDATE usuarios SET plan = ?, pro_hasta = ?, solicita_pro = NULL, cupon_usado = CASE WHEN ? > 0 THEN ? ELSE cupon_usado END, dias_regalo = dias_regalo - ? WHERE id = ?").bind(c.plan, hasta, pg.descuento, ahora, regalo, us.id));
      // Primer plan de pago de alguien que llegó referido: se le abonan 30 días de regalo a quien lo invitó
      if (us.referido_por && !us.referido_premiado) {
        st.push(env.DB.prepare("UPDATE usuarios SET dias_regalo = dias_regalo + 30 WHERE cupon = ?").bind(us.referido_por));
        st.push(env.DB.prepare("UPDATE usuarios SET referido_premiado = 1 WHERE id = ?").bind(us.id));
      }
    } else st.push(env.DB.prepare("UPDATE usuarios SET creditos = creditos + ? WHERE id = ?").bind(pg.cantidad || 1, us.id));
    await env.DB.batch(st);
    return json({ ok: true, hasta }, 200, 0);
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
picture{justify-self:center}.logo{display:block;width:230px;max-width:100%;height:auto}
h1{margin:0;font-size:17px;text-align:center}p{margin:0;color:var(--muted);text-align:center;font-size:13.5px}
label{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
input{width:100%;margin-top:6px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{padding:11px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:600 15px/1 inherit;font-family:inherit;cursor:pointer}
a{color:var(--accent)}.err{color:var(--bad);font-size:13px;text-align:center}`;
const pagina = (titulo, cuerpo, status = 200) => new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PlanoExactoCR · ${titulo}</title><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/assets/img/favicon.png"><style>${ESTILO}</style></head><body>${cuerpo}</body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
const LOGO = '<a href="/" style="justify-self:center"><picture><source srcset="/assets/img/logo-oscuro.webp" media="(prefers-color-scheme: dark)"><img class="logo" src="/assets/img/logo.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="463"></picture></a>';
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

// ---------- Proxy de solo lectura al WMS del ICE/Kolbi (cobertura de telecomunicaciones) ----------
// El GeoServer del ICE no manda cabeceras CORS, así que una página que necesite leer los
// píxeles de sus imágenes (como herramientas/telecom.html) no puede pedirlas directo desde el
// navegador. Este endpoint las pide desde el Worker (sin esa restricción) y las devuelve
// same-origin. Solo reenvía GetMap de las capas públicas que ya mostramos en el mapa.
const ICE_WMS_CAPAS = new Set(["ice:tg", "ice:lte", "ice:ltea", "ice:5g-omv", "ice:internet-shp", "ice:planes-lte"]);
async function proxyIceWms(u) {
  const layer = u.searchParams.get("layer") || "";
  if (!ICE_WMS_CAPAS.has(layer)) return txt("Capa no permitida", 400);
  const bbox = (u.searchParams.get("bbox") || "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) return txt("bbox inválido", 400);
  const w = Math.min(3000, Math.max(1, parseInt(u.searchParams.get("width"), 10) || 0));
  const h = Math.min(3000, Math.max(1, parseInt(u.searchParams.get("height"), 10) || 0));
  if (!w || !h) return txt("width/height inválidos", 400);
  const srs = u.searchParams.get("srs") === "EPSG:3857" ? "EPSG:3857" : "EPSG:4326";
  const q = new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", FORMAT: "image/png", TRANSPARENT: "true", LAYERS: layer, STYLES: "", SRS: srs, WIDTH: String(w), HEIGHT: String(h), BBOX: bbox.join(",") });
  let r;
  try {
    r = await fetch("https://mapas.ice.go.cr/geoserver/ice/wms?" + q, { cf: { cacheTtl: 3600, cacheEverything: true } });
  } catch (_) {
    return txt("No se pudo contactar al servidor del ICE", 502);
  }
  if (!r.ok) return txt("El servidor del ICE respondió " + r.status, 502);
  return new Response(r.body, { status: 200, headers: { "content-type": r.headers.get("content-type") || "image/png", "cache-control": "public, max-age=3600" } });
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
// Capa pública (sin cuenta): solo lo necesario para ver el punto en el mapa y la vista previa de la ficha.
// Sin finca, plano, polígono, Boletín ni datos del entorno; la ubicación va redondeada (~100 m).
const VISIBLES = ["id", "prov", "base", "mon", "f", "area", "tipo", "ll", "loc", "dc", "dn", "cn", "pn", "nom"];
const redondear = (ll) => Array.isArray(ll) ? ll.map((v) => Math.round(v * 1000) / 1000) : ll;
// Archivos que solo se entregan con cuenta (datos de capas y lógica de la guía, el expediente y la lámina)
const SOLO_CUENTA_DATOS = new Set(["/data/planes_reguladores.geojson", "/data/salud.json", "/data/zonasvida.geojson", "/data/infra.geojson", "/data/zmt.geojson"]);
const SOLO_CUENTA_JS = { "/assets/guia.js": "window.PX_GUIA = null;", "/assets/expediente.js": "", "/assets/lamina.js": "" };
let LITE = { etag: null, body: null };
async function rematesLibres(u, env) {
  const r = await env.ASSETS.fetch(new Request(new URL("/data/remates.json", u)));
  const et = r.headers.get("etag") || "";
  if (LITE.body && et && LITE.etag === et) return LITE.body;
  const R = await r.json();
  const body = JSON.stringify(R.map((x) => { const o = { ent: {}, lite: 1 }; for (const k of VISIBLES) if (x[k] !== undefined) o[k] = k === "ll" ? redondear(x[k]) : x[k]; return o; }));
  LITE = { etag: et, body };
  return body;
}

// ---------- Páginas públicas para buscadores: /remates, /remates/<provincia>[/<cantón>], /remate/<id> ----------
// Se generan aquí desde los datos del mapa (solo la información base, la misma que ve un visitante).
const PROVS = ["San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas", "Limón"];
const ETAPA = ["1.er remate", "2.º remate", "3.er remate"], PCT = [1, 0.75, 0.25];
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const slug = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const miles = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const dinero = (v, mon) => v == null ? "—" : (mon === "USD" ? "$" : "₡") + miles(v);
const fechaTxt = (iso) => { const [d, h] = String(iso).split("T"); const [y, m, dd] = d.split("-").map(Number); return `${dd} de ${MES[m - 1]} de ${y}${h ? ", " + h : ""}`; };
let DATOS = { etag: null, R: null, meta: null };
async function datosPublicos(u, env) {
  const body = await rematesLibres(u, env);
  if (DATOS.R && DATOS.etag === LITE.etag) return DATOS;
  const ahora = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 16);   // hora de Costa Rica
  const R = JSON.parse(body).map((r) => { const st = (r.f || []).findIndex((f) => f >= ahora); return Object.assign(r, { st }); }).filter((r) => r.st >= 0 && r.pn && r.cn);
  let meta = {}; try { meta = await (await env.ASSETS.fetch(new Request(new URL("/data/meta.json", u)))).json(); } catch (_) {}
  DATOS = { etag: LITE.etag, R, meta };
  return DATOS;
}
const tipoTxt = (t) => ({ "Con construcción": "Casa o edificación", "Lote": "Lote", "Agrícola": "Finca agrícola", "Filial": "Filial en condominio" }[t] || t || "Propiedad");
function pagSEO(u, titulo, desc, cuerpo, ld) {
  const canon = "https://" + u.host + u.pathname;
  return new Response(`<!doctype html><html lang="es-CR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${canon}">
<meta property="og:type" content="website"><meta property="og:site_name" content="PlanoExactoCR"><meta property="og:title" content="${esc(titulo)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canon}"><meta property="og:image" content="https://${u.host}/assets/img/vista-app.webp"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/img/favicon.png"><script>try{const t=localStorage.getItem('px-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script><script src="/assets/fuentes.js"></script>
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}
<style>
:root{--bg:#F1EEE7;--panel:#FCFBF8;--ink:#15302A;--muted:#4C5953;--line:#DCD8CE;--accent:#1F5A47;--accent-ink:#fff;--soft:#DFEDE6;--terra:#C8553D}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0F1513;--panel:#151C1A;--ink:#E5ECE8;--muted:#A7B4AE;--line:#28332F;--accent:#5FB8AE;--accent-ink:#08201D;--soft:#16302C;--terra:#F08C74}}
:root[data-theme="dark"]{--bg:#0F1513;--panel:#151C1A;--ink:#E5ECE8;--muted:#A7B4AE;--line:#28332F;--accent:#5FB8AE;--accent-ink:#08201D;--soft:#16302C;--terra:#F08C74}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--f-body)}a{color:var(--accent)}
.franja{height:4px;background:linear-gradient(90deg,#15302A 0 46%,#539279 46% 82%,#D9906E 82%)}
.wrap{max-width:960px;margin:0 auto;padding:0 max(16px,env(safe-area-inset-left,0px))}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 0}
.marca{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font:300 19px/1 Montserrat,var(--f-body);letter-spacing:.09em}.marca b{font-weight:700}.marca i{font-style:normal;color:#539279}.marca img{width:50px;height:auto}
.lg-oscuro{display:none}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .lg-claro{display:none}:root:not([data-theme="light"]) .lg-oscuro{display:block}}:root[data-theme="dark"] .lg-claro{display:none}:root[data-theme="dark"] .lg-oscuro{display:block}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-weight:600;text-decoration:none}.btn.pri{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
nav.migas{font-size:13.5px;color:var(--muted);margin:8px 0 4px}nav.migas a{color:var(--muted)}
h1{font:800 clamp(26px,4vw,38px)/1.12 var(--f-display);margin:6px 0 6px;text-wrap:balance}h2{font:700 21px/1.25 var(--f-display);margin:26px 0 10px}
.sub{color:var(--muted);margin:0 0 18px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}
.datos{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}.datos div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.datos b{display:block;font:600 21px/1.2 var(--f-body);font-variant-numeric:tabular-nums}.datos span{font-size:13px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line)}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}td.n{text-align:right;white-space:nowrap}tr.ya td{color:var(--muted);text-decoration:line-through}tr.ahora td{font-weight:700}
.cta{display:grid;gap:10px;background:#0E1412;color:#EEF3F0;border-radius:14px;padding:18px;margin:22px 0}.cta p{margin:0;color:#AEBBB5}.cta .btn.pri{background:#6CC4B8;border-color:#6CC4B8;color:#08201D}.cta .btn{background:transparent;color:#EEF3F0;border-color:#2E3A35}.cta .acts{display:flex;flex-wrap:wrap;gap:8px}
ul.lista{list-style:none;padding:0;margin:0;display:grid;gap:8px}ul.lista a{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:12px;text-decoration:none;color:var(--ink)}ul.lista small{display:block;color:var(--muted)}ul.lista .p{text-align:right;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.chips a{display:inline-block;padding:7px 12px;border-radius:999px;background:var(--soft);color:var(--ink);text-decoration:none;font-weight:600;font-size:14px}
footer{margin:36px 0 30px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
</style></head><body><div class="franja"></div><div class="wrap">
<header><a class="marca" href="/"><img class="lg-claro" src="/assets/img/logo-mark.webp" alt="" width="50" height="34"><img class="lg-oscuro" src="/assets/img/logo-mark-oscuro.webp" alt="" width="50" height="34"><span>PLANO<b>EXACTO</b><i>CR</i></span></a><a class="btn" href="/mapa">Ver el mapa</a></header>
${cuerpo}
<footer>PlanoExactoCR reúne información pública del Boletín Judicial, el Registro Inmobiliario y otras fuentes oficiales con fines orientativos. No es asesoría legal ni un avalúo: verifica siempre en el expediente judicial y el Registro Nacional. · <a href="/privacidad">Privacidad</a></footer>
</div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
const CTA = (r) => `<div class="cta"><b>¿Qué más conviene saber antes de ofertar?</b><p>Con la cuenta gratis abres la ficha de cada remate y generas un expediente PDF completo por semana, con el predio en el catastro, el plan regulador, el valor de Hacienda, el agua potable y el entorno.</p>
<div class="acts"><a class="btn pri" href="/mapa?crear=1${r ? "#r" + r.id : ""}">Crear cuenta gratis</a>${r ? `<a class="btn" href="/mapa#r${r.id}">Ver en el mapa</a>` : `<a class="btn" href="/mapa">Explorar el mapa</a>`}</div></div>`;
const itemLista = (r) => { const bv = r.base * PCT[r.st]; return `<li><a href="/remate/${r.id}"><span><b>${esc(r.nom || tipoTxt(r.tipo))}</b><small>${esc([r.dn, r.cn].filter(Boolean).join(", "))}${r.area ? " · " + miles(r.area) + " m²" : ""} · ${ETAPA[r.st]} el ${fechaTxt(r.f[r.st]).split(",")[0]}</small></span><span class="p">${dinero(bv, r.mon)}</span></a></li>`; };
const migas = (items) => `<nav class="migas" aria-label="Ruta">${items.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : esc(t)).join(" › ")}</nav>`;
const ldMigas = (u, items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([t, h], i) => ({ "@type": "ListItem", position: i + 1, name: t, item: "https://" + u.host + (h || u.pathname) })) });

async function seo(u, env) {
  const p = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
  const { R, meta } = await datosPublicos(u, env);
  const porProv = (i) => R.filter((r) => r.prov === i + 1);
  if (p === "/sitemap.xml") {
    const hoy = (meta.generado || new Date().toISOString().slice(0, 10));
    const urls = ["/", "/mapa", "/remates", "/privacidad"];
    PROVS.forEach((pv, i) => { const L = porProv(i); if (!L.length) return; urls.push("/remates/" + slug(pv)); [...new Set(L.map((r) => r.cn))].forEach((c) => urls.push("/remates/" + slug(pv) + "/" + slug(c))); });
    R.forEach((r) => urls.push("/remate/" + r.id));
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((x) => `<url><loc>https://${u.host}${x}</loc><lastmod>${hoy}</lastmod></url>`).join("\n")}\n</urlset>`,
      { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
  }
  if (p === "/remates") {
    const cuerpo = `${migas([["Inicio", "/"], ["Remates judiciales"]])}<h1>Remates judiciales de propiedades en Costa Rica</h1>
<p class="sub">${R.length} remates vigentes publicados en el Boletín Judicial${meta.ultimoBoletin ? ` (hasta el N.º ${meta.ultimoBoletin})` : ""}, por provincia y cantón. Se actualiza cada día hábil.</p>
${PROVS.map((pv, i) => { const L = porProv(i); if (!L.length) return ""; const cs = {}; L.forEach((r) => cs[r.cn] = (cs[r.cn] || 0) + 1);
  return `<h2><a href="/remates/${slug(pv)}">${pv}</a> <small style="color:var(--muted);font-weight:500">${L.length} remates</small></h2><ul class="chips">${Object.keys(cs).sort((a, b) => a.localeCompare(b, "es")).map((c) => `<li><a href="/remates/${slug(pv)}/${slug(c)}">${esc(c)} (${cs[c]})</a></li>`).join("")}</ul>`; }).join("")}
${CTA()}`;
    return pagSEO(u, "Remates judiciales en Costa Rica por provincia y cantón · PlanoExactoCR", `${R.length} remates judiciales vigentes de casas, lotes y fincas en Costa Rica, ordenados por provincia y cantón, con base, fechas y ubicación en el mapa.`, cuerpo, ldMigas(u, [["Inicio", "/"], ["Remates", "/remates"]]));
  }
  let m = p.match(/^\/remates\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/);
  if (m) {
    const i = PROVS.findIndex((pv) => slug(pv) === m[1]); if (i < 0) return null;
    let L = porProv(i), cn = null;
    if (m[2]) { L = L.filter((r) => slug(r.cn) === m[2]); if (!L.length) return null; cn = L[0].cn; }
    L.sort((a, b) => a.f[a.st].localeCompare(b.f[b.st]));
    const lugar = cn ? `${cn}, ${PROVS[i]}` : PROVS[i];
    const tipos = {}; L.forEach((r) => tipos[tipoTxt(r.tipo)] = (tipos[tipoTxt(r.tipo)] || 0) + 1);
    const cs = {}; if (!cn) L.forEach((r) => cs[r.cn] = (cs[r.cn] || 0) + 1);
    const ruta = [["Inicio", "/"], ["Remates", "/remates"], [PROVS[i], cn ? "/remates/" + m[1] : null]].concat(cn ? [[cn]] : []);
    const cuerpo = `${migas(ruta)}<h1>Remates judiciales en ${esc(lugar)}</h1>
<p class="sub">${L.length} ${L.length === 1 ? "propiedad en remate" : "propiedades en remate"} vigentes: ${Object.entries(tipos).map(([t, n]) => `${n} ${t.toLowerCase()}${n > 1 && !t.endsWith("s") ? (t.endsWith("n") ? "es" : "s") : ""}`).join(", ")}. Ordenadas por la fecha del próximo remate.</p>
${cn ? "" : `<ul class="chips">${Object.keys(cs).sort((a, b) => a.localeCompare(b, "es")).map((c) => `<li><a href="/remates/${m[1]}/${slug(c)}">${esc(c)} (${cs[c]})</a></li>`).join("")}</ul>`}
<ul class="lista" style="margin-top:16px">${L.map(itemLista).join("")}</ul>${CTA()}`;
    return pagSEO(u, `Remates judiciales en ${lugar} · casas, lotes y fincas · PlanoExactoCR`, `${L.length} remates judiciales vigentes en ${lugar}: casas, lotes y fincas con base, fechas de remate y ubicación en el mapa. Actualizado del Boletín Judicial.`, cuerpo, ldMigas(u, ruta.map(([t, h]) => [t, h || u.pathname])));
  }
  m = p.match(/^\/remate\/(\d+)$/);
  if (m) {
    const r = R.find((x) => String(x.id) === m[1]); if (!r) return null;
    const bv = r.base * PCT[r.st], i = r.prov - 1, lugar = [r.dn, r.cn, r.pn].filter(Boolean).join(", ");
    const titulo = `Remate judicial: ${tipoTxt(r.tipo).toLowerCase()} en ${[r.dn, r.cn].filter(Boolean).join(", ")}`;
    const ruta = [["Inicio", "/"], ["Remates", "/remates"], [r.pn, "/remates/" + slug(r.pn)], [r.cn, "/remates/" + slug(r.pn) + "/" + slug(r.cn)], [r.nom || "Remate"]];
    const vecinos = R.filter((x) => x.cn === r.cn && x.id !== r.id).slice(0, 6);
    const cuerpo = `${migas(ruta)}<h1>${esc(titulo.charAt(0).toUpperCase() + titulo.slice(1))}</h1><p class="sub">${esc(lugar)}</p>
<div class="datos"><div><b>${dinero(bv, r.mon)}</b><span>Base del ${ETAPA[r.st]}</span></div><div><b>${fechaTxt(r.f[r.st]).split(",")[0]}</b><span>Próximo remate${r.f[r.st].includes("T") ? " · " + r.f[r.st].split("T")[1] : ""}</span></div><div><b>${r.area ? miles(r.area) + " m²" : "—"}</b><span>Área según el edicto</span></div><div><b>${esc(tipoTxt(r.tipo))}</b><span>Tipo de propiedad</span></div></div>
<h2>Fechas y bases</h2><div class="card" style="padding:4px 14px"><table><thead><tr><th>Remate</th><th>Fecha</th><th style="text-align:right">Base</th></tr></thead><tbody>
${(r.f || []).map((f, k) => `<tr class="${k < r.st ? "ya" : k === r.st ? "ahora" : ""}"><td>${ETAPA[k]}${k ? ` (${PCT[k] * 100} %)` : ""}</td><td>${fechaTxt(f)}</td><td class="n">${dinero(r.base * PCT[k], r.mon)}</td></tr>`).join("")}
</tbody></table></div>
${CTA(r)}
${vecinos.length ? `<h2>Otros remates en ${esc(r.cn)}</h2><ul class="lista">${vecinos.map(itemLista).join("")}</ul><p><a href="/remates/${slug(r.pn)}/${slug(r.cn)}">Ver todos los remates en ${esc(r.cn)}</a></p>` : ""}`;
    const desc = `${tipoTxt(r.tipo)} en remate judicial en ${lugar}${r.area ? `, ${miles(r.area)} m²` : ""}. ${ETAPA[r.st]} el ${fechaTxt(r.f[r.st]).split(",")[0]} con base de ${dinero(bv, r.mon)}. Ubicación, plan regulador y valor de Hacienda en PlanoExactoCR.`;
    return pagSEO(u, `${titulo} · base ${dinero(bv, r.mon)} · PlanoExactoCR`, desc, cuerpo, ldMigas(u, ruta.map(([t, h]) => [t, h || u.pathname])));
  }
  return null;
}

const SOLO_ADMIN = new Set(["/assets/ubicar.js", "/admin", "/admin.html", "/catastro", "/catastro.html", "/data/pendientes.json", "/data/catastro_resultados.json", "/data/estado.json", "/admin/registros.csv", "/admin/usuarios.csv"]);
const INDEXABLES = new Set(["/", "/mapa", "/privacidad", "/robots.txt", "/sitemap.xml"]);
const esIndexable = (p) => INDEXABLES.has(p) || p === "/remates" || p.startsWith("/remates/") || p.startsWith("/remate/");

// Red de seguridad: cualquier excepción no prevista en el manejo de la petición responde rápido
// con un error claro, en vez de dejar al navegador esperando. Antes, una falla sin capturar en
// cualquier punto de la ruta (por ejemplo una migración de la base de datos) podía dejar colgada
// la petición de la que depende todo lo demás (/api/cuenta/yo bloquea la carga del mapa entero).
export default {
  async fetch(request, env) {
    try {
      return await manejarPeticion(request, env);
    } catch (e) {
      return json({ error: "Error del servidor. Intenta de nuevo en un momento." }, 500, 0);
    }
  }
};
async function manejarPeticion(request, env) {
    const pw = env.SITE_PASSWORD;
    if (!pw) return txt("Sitio en configuración.", 503);
    const u = new URL(request.url);
    const p = u.pathname;

    // Dominio propio: todo lo demás redirige (salvo el botón del catastro, que ya guardó la dirección anterior)
    if (env.DOMINIO && u.hostname !== env.DOMINIO && !p.startsWith("/api/catastro/") && u.hostname !== "localhost")
      return Response.redirect(`https://${env.DOMINIO}${p}${u.search}`, 301);

    if (p === "/api/ice-wms") return proxyIceWms(u);
    if (p === "/api/plano-correo") return planoCorreo(request, env, u);
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
    if (p.startsWith("/auth/")) { if (!env.DB) return txt("Las cuentas no están disponibles.", 503); const r = await ingresoExterno(request, env, u); if (r) return r; }

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
    if (!dentro && SOLO_CUENTA_DATOS.has(p)) return json({ error: "Entra con tu cuenta para ver esta información." }, 401, 0);
    if (!dentro && p in SOLO_CUENTA_JS) return new Response(`/* PlanoExactoCR: contenido para cuentas */\n${SOLO_CUENTA_JS[p]}\n`, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store", "vary": "Cookie", "X-Robots-Tag": "noindex" } });
    if (p === "/api/apoyo-legal") {
      if (!dentro) return json({ error: "Entra con tu cuenta." }, 401, 0);
      await initDB(env);
      const usr = await usuarioActual(request, env);
      if (!usr || !["pro", "admin"].includes(planVigente(usr))) return json({ error: "Disponible con el plan PRO." }, 403, 0);
      const juz = u.searchParams.get("juz") || "";
      if (!juz) return json({ error: "Falta el parámetro juz." }, 400, 0);
      const rows = (await env.DB.prepare("SELECT nombre, telefono, correo, juzgados, zona, especialidad, notas FROM apoyo_legal WHERE activo = 1").all()).results || [];
      const filtrados = rows.filter(r => { try { return JSON.parse(r.juzgados || "[]").some(j => juz.includes(j) || j.includes(juz)); } catch { return false; } });
      return json(filtrados.length ? filtrados : rows, 200, 300);
    }
    if ((p === "/api/plano" || p === "/api/finca") && !dentro) return json({ error: "Entra con tu cuenta para buscar planos y fincas." }, 401, 0);

    let res;
    if (p === "/sitemap.xml" || p === "/remates" || p.startsWith("/remates/") || p.startsWith("/remate/")) {
      res = await seo(u, env).catch(() => null);
      if (!res) res = new Response("No encontramos esa página. Puede ser un remate que ya pasó.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    } else if (p === "/data/remates.json" && !dentro) res = new Response(await rematesLibres(u, env), { headers: { "content-type": "application/json; charset=utf-8" } });
    else if (p.startsWith("/api/")) res = await api(u);
    else {
      // Los archivos estáticos se sirven sin «.html» (/inicio, /admin…) y index.html en «/»
      const archivo = p === "/" ? "/inicio" : p === "/mapa" ? "/" : null;
      res = await env.ASSETS.fetch(archivo ? new Request(new URL(archivo, u), request) : request);
    }
    // Versión en las direcciones de scripts y estilos: cada publicación los renueva sin esperar cachés
    if (env.VER && (res.headers.get("content-type") || "").includes("text/html")) {
      const v = (env.VER.id || "").slice(0, 8), conV = (el, at) => { const x = el.getAttribute(at); if (x && /^\/?assets\/[^?]+\.(js|css)$/.test(x)) el.setAttribute(at, x + "?v=" + v); };
      res = new HTMLRewriter().on("script[src]", { element: (el) => conV(el, "src") }).on("link[href]", { element: (el) => conV(el, "href") }).transform(res);
    }
    const out = new Response(res.body, res);
    if (!(env.DOMINIO && u.hostname === env.DOMINIO && esIndexable(p))) out.headers.set("X-Robots-Tag", "noindex, nofollow");
    out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    out.headers.set("X-Content-Type-Options", "nosniff");
    if (p.startsWith("/data/")) out.headers.set("Cache-Control", dentro && p === "/data/remates.json" ? "private, max-age=0, must-revalidate" : "public, max-age=0, must-revalidate");
    if (p === "/data/remates.json") out.headers.set("Vary", "Cookie");
    if (SOLO_CUENTA_DATOS.has(p) || p in SOLO_CUENTA_JS) { out.headers.set("Cache-Control", "private, max-age=0, must-revalidate"); out.headers.set("Vary", "Cookie"); }
    if (p === "/" || p === "/mapa" || p.endsWith(".html")) out.headers.set("Cache-Control", "no-cache");
    return out;
}
