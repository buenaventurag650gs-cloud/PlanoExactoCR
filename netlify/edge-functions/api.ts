// Puente hacia servicios públicos del SNIT y del MINAE (solo destinos permitidos).
// /api/plano?v=613116112008         -> predio por número de plano (catastro, Registro Inmobiliario)
// /api/finca?v=0169321&p=6          -> predio por finca y provincia
// /api/cobertura?lon=-84.1&lat=9.9  -> categoría de cobertura 2020 (MAF, MINAE) en un punto
const json = (o: unknown, status = 200, cache = 3600) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${cache}` } });

async function get(url: string, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, headers: { "user-agent": "PlanoExactoCR/1.0" } }); }
  finally { clearTimeout(t); }
}

export default async (request: Request) => {
  const u = new URL(request.url);
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
};

