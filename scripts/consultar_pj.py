"""Consulta diaria del estado real de los remates en el Poder Judicial (Gestión en Línea).

Para cada remate de data/remates.json cuya última fecha de subasta ya pasó, consulta la
Consulta Pública de Gestión en Línea (pjenlinea.poder-judicial.go.cr) sin necesidad de
usuario/clave, y revisa las resoluciones nuevas del expediente buscando palabras clave de
remate:

  - "declara desierto" / "declaratoria de desierto"  -> estado = desierto
  - "aprueba el remate" / "se adjudica" / "remate aprobado" -> estado = adjudicado
  - "suspende el remate" / "suspensión del remate"   -> estado = suspendido

Solo se auto-marca con palabras clave de ALTA confianza. Cualquier resolución que mencione
"remate" sin encajar en esas frases exactas se guarda en data/candidatos_revision.json para
que una persona la revise a mano (no se adivina el resultado).

El sistema del PJ tarda varios días en reflejar el resultado real de un remate (el juzgado
primero redacta y sube el acta), así que no es raro que un remate de ayer todavía no muestre
nada nuevo aquí — eso no es un error del script.

Uso:  python3 scripts/consultar_pj.py              (en GitHub Actions)
      python3 scripts/consultar_pj.py --sin-red    (no hace red; solo valida el código)
"""
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata

import requests

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DATA = os.path.join(RAIZ, 'data')

BASE = 'https://pjenlinea.poder-judicial.go.cr/GestionEnLinea'
UA = {'User-Agent': 'PlanoExactoCR/1.0 (consulta publica de expedientes)'}
PAUSA = 1.2            # segundos entre expedientes, para no saturar el servicio público
VENTANA_DIAS = 90      # no seguir consultando remates con más de N días de vencidos

KW_DESIERTO = ['declara desierto', 'declaratoria de desierto', 'remate desierto']
KW_ADJUDICADO = ['aprueba el remate', 'se adjudica el bien', 'remate aprobado', 'se aprueba el remate']
KW_SUSPENDIDO = ['suspende el remate', 'suspension del remate', 'suspension de remate']


def leer(nombre, defecto=None):
    p = os.path.join(DATA, nombre)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else defecto


def escribir(nombre, obj):
    json.dump(obj, open(os.path.join(DATA, nombre), 'w', encoding='utf-8'), ensure_ascii=False, indent=2 if nombre != 'remates.json' else None)


def sin_tildes(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def normaliza(s):
    return sin_tildes((s or '').lower())


class ClientePJ:
    """Sesión contra la Consulta Pública de Gestión en Línea. Sin usuario ni clave:
    el token se obtiene de un endpoint público y vence en ~10 minutos."""

    def __init__(self):
        self.token = None
        self.token_ts = 0

    def _headers(self):
        self._asegurar_token()
        return {**UA, 'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*'}

    def _asegurar_token(self):
        if self.token and (time.time() - self.token_ts) < 480:  # renovar antes de los 600s reales
            return
        r = requests.post(BASE + '/api/AutenticacionIdentityServerController/AccesarPublico',
                           headers={**UA, 'Content-Type': 'application/json'}, json={}, timeout=20)
        r.raise_for_status()
        self.token = r.json()['tpublico']
        self.token_ts = time.time()

    def consultar_expediente(self, numero_sin_formato):
        """numero_sin_formato: los 4 campos pegados, ej '250033171200CJ'."""
        body = {'contexto': {'consultaPublicaCiudadano': True, 'consultaPrivadaCiudadano': False},
                'numero': numero_sin_formato}
        r = requests.post(BASE + '/api/Expediente/ConsultarExpediente', headers=self._headers(), json=body, timeout=20)
        r.raise_for_status()
        j = r.json()
        datos = j.get('valorDevuelto') or []
        return datos[0] if datos else None

    def consultar_datos_generales(self, exp_detalle):
        r = requests.post(BASE + '/api/Expediente/ConsultarDatosGeneralesExpediente', headers=self._headers(),
                           json=exp_detalle, timeout=20)
        r.raise_for_status()
        return r.json().get('valorDevuelto')

    def consultar_resoluciones(self, numero_sin_formato, carpeta, codigo_oficina):
        ctx = {'codigo': codigo_oficina, 'provieneSIAGPJ': False,
               'consultaPublicaCiudadano': True, 'consultaPrivadaCiudadano': False}
        body = {'expediente': {'numero': numero_sin_formato, 'carpeta': carpeta, 'contexto': ctx}, 'contexto': ctx}
        r = requests.post(BASE + '/api/DocumentoController/ConsultarResoluciones', headers=self._headers(),
                           json=body, timeout=20)
        r.raise_for_status()
        j = r.json()
        return j.get('valorDevuelto') or []


def numero_sin_guiones(exp_con_formato):
    """'25-003317-1200-CJ' -> '250033171200CJ'"""
    return exp_con_formato.replace('-', '')


def clasificar(descripcion):
    """Devuelve ('adjudicado'|'desierto'|'suspendido'|None, palabra_encontrada|None)."""
    d = normaliza(descripcion)
    for kw in KW_DESIERTO:
        if kw in d:
            return 'desierto', kw
    for kw in KW_ADJUDICADO:
        if kw in d:
            return 'adjudicado', kw
    for kw in KW_SUSPENDIDO:
        if kw in d:
            return 'suspendido', kw
    return None, None


def candidatos(remates, estados_actuales):
    """Remates con última fecha ya pasada, sin estado manual ya fijado, dentro de la ventana."""
    ahora = dt.datetime.now()
    refs_con_estado_manual = {e['ref'] for e in estados_actuales
                               if 'ref' in e and e.get('fuente') != 'auto-pj'}
    out = []
    for r in remates:
        ref = str(r.get('ref', ''))
        if not ref or ref in refs_con_estado_manual:
            continue
        fechas = r.get('f') or []
        if not fechas:
            continue
        ultima = dt.datetime.fromisoformat(fechas[-1])
        dias = (ahora - ultima).days
        if 0 <= dias <= VENTANA_DIAS:
            out.append(r)
    return out


def main(sin_red=False):
    remates = leer('remates.json', [])
    estados = leer('estados.json', [])
    estados = [e for e in estados if '_comentario' not in e and '_ejemplo' not in e]
    revision = leer('candidatos_revision.json', [])
    revision_por_ref = {str(c['ref']): c for c in revision}

    objetivos = candidatos(remates, estados)
    print(f'  Remates a revisar (fecha vencida, sin estado manual): {len(objetivos)}')

    if sin_red:
        print('  --sin-red: no se hacen consultas. Fin.')
        return

    if not objetivos:
        print('  Nada que consultar. Fin.')
        return

    cliente = ClientePJ()
    nuevos_estados = 0
    nuevos_candidatos = 0

    for r in objetivos:
        ref = str(r['ref'])
        exp = r.get('exp')
        if not exp:
            continue
        numero = numero_sin_guiones(exp)
        try:
            detalle = cliente.consultar_expediente(numero)
            if not detalle:
                print(f'  {exp}: no encontrado en el PJ')
                continue
            generales = cliente.consultar_datos_generales(detalle)
            carpeta = (generales or detalle).get('carpeta')
            codigo_oficina = (detalle.get('contexto') or {}).get('codigo', '')
            resoluciones = cliente.consultar_resoluciones(numero, carpeta, codigo_oficina) if carpeta else []
        except requests.RequestException as e:
            print(f'  {exp}: error de red ({e})')
            time.sleep(PAUSA)
            continue

        match_fuerte = None
        for doc in resoluciones:
            desc = doc.get('descripcion', '')
            estado_resultado, kw = clasificar(desc)
            if estado_resultado:
                match_fuerte = (estado_resultado, kw, desc, doc.get('fechaResolucion'))
                break
            elif 'remate' in normaliza(desc):
                # Mención de "remate" sin frase concluyente: para revisión humana, no auto-marcar.
                revision_por_ref[ref] = {
                    'ref': ref, 'exp': exp, 'nom': r.get('nom', ''),
                    'descripcion': desc, 'fecha': doc.get('fechaResolucion'),
                    'detectado': dt.date.today().isoformat(),
                }
                nuevos_candidatos += 1

        if match_fuerte:
            estado_resultado, kw, desc, fecha_res = match_fuerte
            fecha = (fecha_res or '')[:10] or dt.date.today().isoformat()
            estados = [e for e in estados if str(e.get('ref')) != ref]
            estados.append({
                'ref': ref, 'estado': estado_resultado, 'fecha': fecha,
                'nota': f'Detectado automáticamente ("{kw}") en: "{desc}". Verificar por teléfono.',
                'fuente': 'auto-pj',
            })
            nuevos_estados += 1
            print(f'  ✓ {exp} -> {estado_resultado} (palabra clave: "{kw}")')
            revision_por_ref.pop(ref, None)
        else:
            estado_general = (generales or {}).get('estado', {}).get('descripcion', '')
            print(f'  {exp}: sin resolución concluyente (estado expediente: "{estado_general}")')

        time.sleep(PAUSA)

    if nuevos_estados:
        escribir('estados.json', estados)
        print(f'\n  {nuevos_estados} estado(s) nuevo(s) escrito(s) en estados.json')
    if nuevos_candidatos:
        escribir('candidatos_revision.json', list(revision_por_ref.values()))
        print(f'  {nuevos_candidatos} candidato(s) para revisión humana en candidatos_revision.json')
    if not nuevos_estados and not nuevos_candidatos:
        print('\n  Sin novedades hoy.')


if __name__ == '__main__':
    main(sin_red='--sin-red' in sys.argv)
