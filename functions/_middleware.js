// Cloudflare Pages: protección con contraseña para la etapa de prueba.
// La contraseña vive en la variable de entorno SITE_PASSWORD del proyecto en Cloudflare (nunca en el código).
// Si la variable no existe, el sitio queda cerrado (falla de forma segura).
const PRIVADO = /^\/(scripts|netlify|functions)\/|^\/(README\.md|netlify\.toml|wrangler\.toml|package\.json)$/;

export async function onRequest(context) {
  const { request, env, next } = context;
  const pw = env.SITE_PASSWORD;
  if (!pw) return new Response("Sitio en configuración.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  const url = new URL(request.url);
  if (PRIVADO.test(url.pathname)) return new Response("No encontrado.", { status: 404 });
  const h = request.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), (c) => c.charCodeAt(0)));
      if (decoded.slice(decoded.indexOf(":") + 1) === pw) return next();
    } catch (_) { /* cabecera inválida */ }
  }
  return new Response("Acceso restringido. Escribe cualquier usuario y la contraseña de prueba.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PlanoExactoCR", charset="UTF-8"', "content-type": "text/plain; charset=utf-8" },
  });
}
