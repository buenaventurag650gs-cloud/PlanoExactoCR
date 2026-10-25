// Protección con contraseña para la etapa de prueba.
// La contraseña vive en la variable de entorno SITE_PASSWORD de Netlify (nunca en el código).
// Si la variable no existe, el sitio queda cerrado (falla de forma segura).
export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const pw = Netlify.env.get("SITE_PASSWORD");
  if (!pw) {
    return new Response("Sitio en configuración.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const h = request.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), (c) => c.charCodeAt(0)));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (pass === pw) return context.next();
    } catch (_) { /* cabecera inválida */ }
  }
  return new Response("Acceso restringido. Escribe cualquier usuario y la contraseña de prueba.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Remates en el Catastro", charset="UTF-8"', "content-type": "text/plain; charset=utf-8" },
  });
};

export const config = { path: "/*" };
