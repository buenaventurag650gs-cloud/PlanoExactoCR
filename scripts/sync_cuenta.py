"""Sincronizar la copia propia de las capas que exigen cuenta.

Qué problema resuelve: 5 capas del sitio público (zmt, planes_reguladores,
zonasvida, infra, salud) solo se ven con una cuenta gratis iniciada. En vez
de que el atlas municipal dependa de esa cuenta/cookie en el navegador de
cada quien (lo que obligaría a compartir sesión entre los dos sitios), este
script baja esas 5 capas UNA VEZ, con una cookie que usted pega a mano, y
las guarda como archivos propios dentro de muni/data/. El visor del atlas
las lee de ahí, como cualquier otro archivo — sin cuentas, sin cookies, sin
depender del sitio público en el momento de verlas.

Cuándo correrlo: cuando quiera refrescar esos datos (p. ej. una vez al mes,
o después de que el sitio público actualice su información). No hace falta
correrlo seguido — no son datos que cambien a diario.

Uso:
    python3 scripts/sync_cuenta.py --cookie "pecr_u=<valor copiado del navegador>"

Cómo conseguir la cookie: entre a planoexactocr.com en el navegador con
cualquier cuenta gratis, abra las herramientas de desarrollador →
Application (o Storage) → Cookies → copie el valor de "pecr_u".
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
from datetime import date

import requests

MUNI_DIR = pathlib.Path(__file__).resolve().parent.parent / "muni"
CAPAS_JSON = MUNI_DIR / "capas.json"
DATA_DIR = MUNI_DIR / "data"

# nombre de la capa en capas.json -> archivo de origen en el sitio público
ARCHIVOS_CUENTA = {
    "Zona marítimo terrestre": "zmt.geojson",
    "Estado del plan regulador por cantón": "planes_reguladores.geojson",
    "Zonas de vida": "zonasvida.geojson",
    "Infraestructura general": "infra.geojson",
    "Sedes de salud": "salud.json",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cookie", default=os.environ.get("PX_COOKIE"), required=False,
                         help='Cookie de sesión, p. ej. "pecr_u=...". También se puede dar con PX_COOKIE.')
    args = parser.parse_args()
    if not args.cookie:
        raise SystemExit("Falta la cookie de sesión. Vea el encabezado de este archivo para cómo conseguirla.")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    catalogo = json.loads(CAPAS_JSON.read_text(encoding="utf-8"))
    hoy = date.today().isoformat()

    for grupo in catalogo["grupos"]:
        for capa in grupo["capas"]:
            archivo_origen = ARCHIVOS_CUENTA.get(capa["nombre"])
            if not archivo_origen:
                continue
            url = f"https://planoexactocr.com/data/{archivo_origen}"
            print(f"- {capa['nombre']} ({url})", end=" ")
            resp = requests.get(url, headers={"Cookie": args.cookie}, timeout=30)
            if resp.status_code != 200:
                print(f"ERROR {resp.status_code} — revise que la cookie siga vigente")
                continue
            (DATA_DIR / archivo_origen).write_bytes(resp.content)
            print(f"→ guardado en muni/data/{archivo_origen}")

            capa["archivo"] = f"data/{archivo_origen}"
            capa["copia_local"] = hoy
            capa.pop("requiere_cuenta", None)

    CAPAS_JSON.write_text(json.dumps(catalogo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nListo. capas.json actualizado con fecha de copia: {hoy}")
    print("Revise los cambios con git status / git diff antes de hacer commit — muni/data/ no se")
    print("sube a git por defecto en este script (ver nota de tamaño en el README antes de forzarlo).")


if __name__ == "__main__":
    main()
