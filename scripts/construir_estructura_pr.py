"""Construye data/estructura_pr.json — la estructura del Plan Regulador compartida.

POR QUÉ ESTE ARCHIVO

El atlas (atlas.planoexactocr.com) y el calibrador (calibrador.planoexactocr.com) resuelven
partes distintas del MISMO proceso. Si cada uno guarda su propia lista de etapas y de mapas,
se desincronizan: el atlas numera un mapa 1.2 y el calibrador lo cita como M1.1.02, y el
expediente que llega al INVU no cuadra consigo mismo.

Así que la estructura vive una sola vez, acá, y se publica en
https://planoexactocr.com/data/estructura_pr.json. Los dos sitios la leen. El atlas la usa
para rotular y ordenar sus láminas; el calibrador la usa para llevar las etapas y los
entregables. Cambiar una etapa o un código es cambiar este archivo.

DE DÓNDE SALE

Del documento "Desglose de entregables y productos del Plan Regulador" (guía interna,
noviembre 2026), que a su vez se apoya en:
  - Ley de Planificación Urbana N.º 4240 (arts. 15, 16, 17, 19, 40)
  - MAPRIOT 2025 (INVU, sesión JDINVU-028-2025) y sus guías 2026
  - DE 44710-MINAE (RIVAIOT), vigente desde el 18 de agosto de 2025

Los puntos que el documento marca "(verificar)" viajan en el campo `verificar` de cada
elemento y en la lista `verificar` del final, para que nadie los dé por cerrados.

CÓMO SE CORRE

    python3 -I scripts/construir_estructura_pr.py

Escribe data/estructura_pr.json. No toca nada más.
"""

from __future__ import annotations

import json
import pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "data" / "estructura_pr.json"

FUENTE = "Desglose de entregables y productos del Plan Regulador (guía interna, nov 2026)"

# --------------------------------------------------------------------------------------
# Las cinco clases del IFA
# --------------------------------------------------------------------------------------
# Zona I = la MENOS frágil = se fomenta el desarrollo; Zona V = la MÁS frágil = conservación.
# Esta dirección viene de la Matriz B del desglose y la confirman sus Matrices C y D, que
# tratan III-V y IV-V como el extremo restrictivo. Es la que citan los reglamentos.
#
# OJO, dos numeraciones distintas que no hay que confundir:
#   - el numeral romano de acá (I..V), que es el oficial y el que va en el texto normativo;
#   - el código interno del ráster del atlas (scripts/integracion_ifa.py), donde 1 es la
#     fragilidad más alta, porque sigue la escala de puntos de la Tabla Nº 3 del 32967.
# Corren en direcciones opuestas a propósito. Lo que une a los dos, y lo único que sale
# impreso, es el par nombre + color: "Muy alta" siempre es rojo en los dos lados.
#
# `orden` es el rango por fragilidad (1 = menos frágil), para poder ordenar y pintar la
# rampa. No es el valor del ráster.
CLASES_IFA = [
    (1, "I", "Muy baja", "#3d983a",
     "Terreno estable, sin amenazas relevantes ni valores ecológicos críticos",
     "Desarrollo urbano de mayor intensidad", "Fomentar",
     "Zonas de consolidación, densificación y usos mixtos"),
    (2, "II", "Baja", "#94d180",
     "Limitaciones menores y manejables",
     "Desarrollo urbano con medidas estándar", "Controlar",
     "Residencial media y alta, comercio, servicios"),
    (3, "III", "Moderada", "#ffff33",
     "Limitaciones que exigen estudios o diseño específico",
     "Desarrollo de baja o media intensidad con condiciones", "Condicionar",
     "Residencial de baja densidad, agroturismo, usos condicionales con estudio geotécnico "
     "o hidrogeológico"),
    (4, "IV", "Alta", "#ff7f00",
     "Limitaciones severas o valores ambientales altos",
     "Usos de muy baja intensidad, agropecuario y forestal", "Restringir",
     "Zonas rurales, agroforestales, de amortiguamiento; cobertura y lote mínimo restrictivos"),
    (5, "V", "Muy alta", "#e41a1c",
     "Amenaza alta, protección legal o ecosistema crítico",
     "Conservación, sin urbanización", "Prohibir",
     "Zonas de protección, conservación y riesgo; parques lineales en riberas"),
]

# --------------------------------------------------------------------------------------
# Las nueve etapas del MAPRIOT 2025, más el seguimiento
# --------------------------------------------------------------------------------------
# (numero, nombre, bloque, lidera, revisa, entregable_de_cierre)
ETAPAS = [
    (1, "Preparación preliminar", "Elaboración", "Municipalidad", "Concejo Municipal",
     "Comisión del PR, Términos de Referencia y Equipo Planificador contratado"),
    (2, "Elaboración del Mapa Base", "Elaboración", "Equipo Planificador",
     "Municipalidad (y revisión por etapa del INVU)",
     "Mapa Base y geodatabase del Área de Planificación"),
    (3, "Evaluación ambiental (variable ambiental)", "Elaboración",
     "Proponente (Municipalidad) + equipo ambiental", "SETENA (viabilidad ambiental)",
     "EsIVA con IFA integrado y condicionantes ambientales"),
    (4, "Diagnóstico territorial", "Elaboración", "Equipo Planificador",
     "Comisión del PR / INVU por etapa",
     "Documento de Diagnóstico, Atlas y Mapa Unificado del Diagnóstico"),
    (5, "Pronóstico territorial", "Elaboración", "Equipo Planificador", "Comisión del PR",
     "Escenarios (tendencial, deseable, posible) y modelo territorial elegido"),
    (6, "Propuesta", "Elaboración", "Equipo Planificador",
     "Comisión del PR, SETENA (análisis de alcance y reglamento ambiental)",
     "Política de Desarrollo Urbano + 5 Reglamentos + Atlas de la Propuesta"),
    (7, "Audiencia Pública", "Trámite", "Municipalidad", "Art. 17 Ley 4240",
     "Acta, registro de observaciones y matriz de respuestas"),
    (8, "Revisión por parte del INVU", "Trámite", "INVU (Ventanilla Única)",
     "INVU, matriz de criterios mínimos cumple / no cumple (art. 16)",
     "Oficio de aprobación INVU"),
    (9, "Adopción y publicación", "Adopción", "Municipalidad", "Concejo Municipal",
     "Acuerdo de adopción y publicación en La Gaceta"),
    (10, "Seguimiento y evaluación", "Gestión", "Municipalidad", "Municipalidad / INVU",
     "Matriz de seguimiento e informes periódicos (revisión recomendada cada 5 años)"),
]

# --------------------------------------------------------------------------------------
# Productos por etapa
# --------------------------------------------------------------------------------------
# (codigo, etapa, actividad_o_producto, entregable, contenido_minimo, responsable, resuelve)
# `resuelve`: atlas | calibrador | equipo  — quién de nuestras herramientas lo produce.
PRODUCTOS = [
    # Etapa 1 — preparación preliminar
    ("E1.1", 1, "Designar la Comisión del Plan Regulador",
     "Acuerdo del Concejo que designa la Comisión",
     "Integrantes (Concejo, Alcaldía, técnicos municipales, representación comunal), "
     "funciones, periodicidad de sesiones", "Concejo Municipal", "equipo"),
    ("E1.2", 1, "Delimitar preliminarmente el Área de Planificación",
     "Descripción textual y croquis del Área de Planificación preliminar",
     "Límites cantonales y distritales, exclusiones (ZMT con PRC propio, ASP, territorios "
     "indígenas), justificación", "Municipalidad", "atlas"),
    ("E1.3", 1, "Estimar el presupuesto global", "Documento Presupuesto Global",
     "Costos por etapa, estudios especializados, cartografía, participación, publicaciones "
     "en La Gaceta", "Municipalidad", "equipo"),
    ("E1.4", 1, "Asegurar financiamiento", "Fuente de financiamiento asegurada",
     "Presupuesto municipal, IFAM, MIDEPLAN (fondo de preinversión), convenios "
     "interinstitucionales", "Municipalidad", "equipo"),
    ("E1.5", 1, "Elaborar Términos de Referencia", "TdR de la contratación",
     "Alcance por etapa, productos mínimos MAPRIOT 2025, metodología ambiental elegida "
     "(Anexo 1 IFA o Anexo 2 RIVAIOT), perfil del equipo, cronograma, forma de pago por "
     "entregable", "Municipalidad", "equipo"),
    ("E1.6", 1, "Seleccionar al Equipo Planificador", "Equipo Planificador contratado",
     "Coordinación, urbanismo, SIG, ambiente (geólogo, hidrogeólogo, biólogo, edafólogo), "
     "social, económico, jurídico; inscripción ante SETENA cuando aplique",
     "Municipalidad", "equipo"),

    # Etapa 2 — mapa base
    ("E2.1", 2, "Geodatabase del Mapa Base", "Geodatabase",
     "Provincias, cantones, distritos y localidades. Shapefile en CRTM-05 con "
     "funcionalidad SIG", "Equipo Planificador", "atlas"),
    ("E2.2", 2, "Topografía", "DEM y curvas de nivel",
     "Modelo digital de elevación y curvas, preferiblemente 1:5.000. Ráster + vector",
     "Equipo Planificador", "atlas"),
    ("E2.3", 2, "Hidrografía", "Capa de hidrografía",
     "Ríos, quebradas, cuerpos de agua, nacientes. Vector", "Equipo Planificador", "atlas"),
    ("E2.4", 2, "Infraestructura vial", "Capa de red vial",
     "Red nacional y cantonal, vías férreas, puentes. Vector", "Equipo Planificador", "atlas"),
    ("E2.5", 2, "Usos actuales y áreas urbanas", "Capa de usos",
     "Huella urbana, usos predominantes. Vector", "Equipo Planificador", "atlas"),
    ("E2.6", 2, "Cobertura vegetal", "Capa de cobertura",
     "Bosque, charral, pastos, cultivos, manglar, humedal. Vector", "Equipo Planificador",
     "atlas"),
    ("E2.7", 2, "Áreas de riesgo", "Capa de amenazas",
     "Amenazas reconocidas por la CNE y estudios previos. Vector", "Equipo Planificador",
     "atlas"),
    ("E2.8", 2, "Áreas Bajo Régimen Especial (ABRE)", "Capa de ABRE",
     "ASP, ZMT, territorios indígenas, patrimonio, conos de aproximación de aeropuertos. "
     "Vector", "Equipo Planificador", "atlas"),
    ("E2.9", 2, "Mosaico catastral", "Capa catastral",
     "Base para zonificación y Mapa Oficial. Vector", "Equipo Planificador", "equipo"),
    ("E2.10", 2, "Ortofoto o imagen reciente", "Ráster de ortofoto",
     "Insumo de fotointerpretación; vuelo dron en zonas urbanas o costeras de detalle",
     "Equipo Planificador", "equipo"),
    ("E2.11", 2, "Mapa Base impreso + memoria", "PDF tabloide + memoria técnica",
     "Fuentes, fecha, proyección, autor, limitaciones. PDF tabloide (432 × 279 mm), "
     "plantilla INVU", "Equipo Planificador", "atlas"),

    # Etapa 3 — EsIVA, ruta procedimental
    ("A1", 3, "Elegir la metodología y fijarla en los TdR",
     "Acuerdo municipal o nota del proponente",
     "Anexo 1 (IFA) o Anexo 2 (RIVAIOT) del DE 44710", "Municipalidad (proponente)",
     "equipo"),
    ("A2", 3, "Abrir el expediente en la plataforma digital de SETENA",
     "Formulario de inicio",
     "Declaración jurada, equipo consultor inscrito", "Proponente + equipo ambiental",
     "equipo"),
    ("A3", 3, "Fase I: IFA por componentes e IFA integrado",
     "Informe IFA + atlas IFA + capas digitales",
     "Los mapas M1.1.01 a M1.9.02 con sus fichas técnicas", "Equipo ambiental", "atlas"),
    ("A4", 3, "Fase II: AAA, una vez existe el borrador de zonificación",
     "Informe AAA + matriz de compatibilidad + capacidad de carga",
     "Matriz C y los mapas M1.9.03 y M1.9.04", "Equipo ambiental + urbanismo", "calibrador"),
    ("A5", 3, "Fase III: RDS, integrado en el Reglamento de Zonificación",
     "RDS (articulado) + matriz de condicionantes",
     "Matriz D: de la condicionante a la norma", "Equipo ambiental + jurídico", "calibrador"),
    ("A6", 3, "Presentar el EsIVA completo", "Expediente digital firmado",
     "Informe, atlas, geodatabase, matrices A-D, declaración jurada", "Proponente", "equipo"),
    ("A7", 3, "Atender observaciones de SETENA", "Informe de respuestas",
     "Respuesta punto por punto con la corrección aplicada", "Equipo ambiental", "equipo"),
    ("A8", 3, "Obtener la viabilidad ambiental", "Resolución de VA",
     "Plazo de revisión de 60 días", "SETENA", "equipo"),
    ("A9", 3, "Incorporar la VA y sus condicionantes en la Propuesta final",
     "Matriz de trazabilidad VA → reglamentos",
     "Cada condicionante de la VA ligada al artículo que la gestiona",
     "Equipo Planificador", "calibrador"),

    # Etapa 5 — pronóstico
    ("E5.1", 5, "Análisis de tendencias", "Documento de tendencias",
     "Crecimiento de la huella urbana, demanda de vivienda y suelo al horizonte, presión "
     "sobre zonas IFA IV-V", "Equipo Planificador", "equipo"),
    ("E5.2", 5, "Escenario tendencial", "Mapa y memoria del escenario",
     "Qué pasa si no hay plan: dónde crece, qué riesgos y conflictos aparecen",
     "Equipo Planificador", "calibrador"),
    ("E5.3", 5, "Escenario deseable", "Mapa y memoria del escenario",
     "Imagen objetivo construida con actores", "Equipo Planificador", "calibrador"),
    ("E5.4", 5, "Escenario posible o concertado", "Mapa y memoria del escenario",
     "Lo alcanzable según capacidad de carga, finanzas municipales y condicionantes "
     "ambientales", "Equipo Planificador", "calibrador"),
    ("E5.5", 5, "Cálculo de demanda de suelo", "Cuadro de demanda",
     "Hectáreas necesarias por uso y densidad para la población proyectada",
     "Equipo Planificador", "calibrador"),
    ("E5.6", 5, "Modelo territorial elegido", "Esquema de estructura territorial",
     "Centralidades, ejes, cuadrantes urbanos, áreas de protección, rural",
     "Equipo Planificador", "calibrador"),
    ("E5.7", 5, "Mapas de escenarios", "Un mapa por escenario + modelo territorial",
     "Atlas del Pronóstico", "Equipo Planificador", "calibrador"),

    # Etapa 7 — audiencia pública
    ("E7.1", 7, "Acuerdo del Concejo que convoca", "Acuerdo del Concejo",
     "Fecha, hora, lugar y modalidad", "Concejo Municipal", "equipo"),
    ("E7.2", 7, "Aviso en La Gaceta + divulgación adicional", "Publicación oficial",
     "Local, fecha y hora; publicado con la antelación legal (15 días hábiles, verificar "
     "contra el texto vigente del art. 17)", "Municipalidad", "equipo"),
    ("E7.3", 7, "Expediente disponible para consulta", "Expediente público",
     "PDU, reglamentos, atlas y EsIVA accesibles en físico y en línea", "Municipalidad",
     "calibrador"),
    ("E7.4", 7, "Material de comunicación", "Presentación y resúmenes",
     "Presentación, resúmenes, mapas impresos (Guía de comunicación INVU)",
     "Equipo Planificador", "atlas"),
    ("E7.5", 7, "Acta de la audiencia", "Acta",
     "Asistencia, desarrollo, observaciones verbales", "Municipalidad", "equipo"),
    ("E7.6", 7, "Registro de observaciones escritas", "Registro",
     "Recibidas en el plazo fijado", "Municipalidad", "equipo"),
    ("E7.7", 7, "Matriz de observaciones y respuestas", "Matriz de respuestas",
     "Cada observación con decisión: acoge, acoge parcialmente o rechaza, y su "
     "justificación técnica", "Equipo Planificador", "equipo"),
    ("E7.8", 7, "Informe de ajustes a la Propuesta", "Informe de ajustes",
     "Cambios introducidos tras la audiencia; si tocan la zonificación, revisar coherencia "
     "con la VA", "Equipo Planificador", "calibrador"),

    # Etapa 8 — revisión INVU
    ("E8.1", 8, "Nota municipal de solicitud de revisión", "Nota de solicitud",
     "Firmada por la Alcaldía, con acuerdo del Concejo", "Municipalidad", "equipo"),
    ("E8.2", 8, "Expediente completo por Ventanilla Única de Inversión",
     "Expediente digital",
     "Todos los productos mínimos requeridos de las etapas 1-7", "Municipalidad", "equipo"),
    ("E8.3", 8, "Resolución de viabilidad ambiental de SETENA", "Resolución de VA",
     "Requisito previo de la revisión", "SETENA", "equipo"),
    ("E8.4", 8, "Cartografía conforme al Instrumento de Verificación", "Cartografía conforme",
     "Carpetas, PDF, shapefiles CRTM-05, RGB", "Equipo Planificador", "atlas"),
    ("E8.5", 8, "Autoevaluación contra la matriz de criterios mínimos", "Autoevaluación",
     "Cada criterio del art. 16 marcado cumple / no cumple con referencia a página o mapa",
     "Equipo Planificador", "calibrador"),
    ("E8.6", 8, "Respuesta a observaciones del INVU", "Informe de subsanación",
     "Informe de subsanación y versión corregida", "Equipo Planificador", "equipo"),
    ("E8.7", 8, "Oficio de aprobación del INVU", "Oficio de aprobación",
     "Emitido por el INVU; cierra la etapa", "INVU", "equipo"),

    # Etapa 9 — adopción
    ("E9.1", 9, "Acuerdo de adopción del Concejo Municipal", "Acuerdo de adopción",
     "Adopta el PR aprobado por el INVU, sin cambios sustanciales", "Concejo Municipal",
     "equipo"),
    ("E9.2", 9, "Publicación en La Gaceta", "Publicación oficial",
     "Aviso de adopción con la fecha desde la cual rigen las regulaciones; texto de los "
     "reglamentos según el formato de la Imprenta Nacional", "Municipalidad", "equipo"),
    ("E9.3", 9, "Versión oficial digital", "PDF y capas oficiales",
     "Publicados en el sitio municipal; carga al SNIT recomendada", "Municipalidad", "atlas"),
    ("E9.4", 9, "Transitorios operativos", "Transitorios",
     "Trámites en curso, certificados de uso de suelo vigentes", "Municipalidad",
     "calibrador"),

    # Seguimiento
    ("E10.1", 10, "Matriz de seguimiento del PR", "Matriz de seguimiento",
     "Indicador, línea base, meta, responsable y frecuencia", "Municipalidad", "calibrador"),
    ("E10.2", 10, "Informe periódico de avance", "Informe de avance",
     "A la Comisión y al Concejo", "Municipalidad", "equipo"),
    ("E10.3", 10, "Registro de certificados de uso de suelo y permisos", "Registro",
     "Certificados, permisos y usos no conformes para medir cumplimiento",
     "Municipalidad", "equipo"),
    # Etapa 4 — Diagnóstico territorial. El desglose la organiza por ejes, no por pasos:
    # cada eje produce sus análisis y sus mapas, y todos confluyen en el Mapa Unificado.
    ("E4.1", 4, "Eje social", "Síntesis social del Diagnóstico",
     "Población y proyecciones, estructura etárea, hogares, pobreza y vulnerabilidad, "
     "vivienda (déficit cuantitativo y cualitativo), asentamientos informales, servicios "
     "comunales", "Equipo consultor", "equipo"),
    ("E4.2", 4, "Eje físico-espacial", "Síntesis físico-espacial del Diagnóstico",
     "Uso actual del suelo, estructura urbana, tejido y morfología, espacio público, "
     "vialidad y movilidad, transporte público, servicios públicos, patrimonio",
     "Equipo consultor", "atlas"),
    ("E4.3", 4, "Eje económico", "Síntesis económica del Diagnóstico",
     "Estructura productiva, empleo, actividades por sector, turismo, mercado de suelo y "
     "valores, finanzas municipales", "Equipo consultor", "equipo"),
    ("E4.4", 4, "Eje político-institucional", "Síntesis político-institucional",
     "Capacidad municipal (planificación, control urbano, catastro), actores, instancias "
     "de coordinación, instrumentos vigentes", "Equipo consultor", "equipo"),
    ("E4.5", 4, "Eje jurídico", "Matriz normativa e inventario de restricciones",
     "Normativa nacional y local aplicable, regímenes especiales (ZMT, ASP, territorios "
     "indígenas, patrimonio), PR vigente, jurisprudencia de la Sala Constitucional",
     "Equipo consultor", "equipo"),
    ("E4.6", 4, "Eje ambiental", "Condicionantes ambientales y su superficie",
     "No se duplica: importa del EsIVA el IFA integrado, las amenazas, la recarga y "
     "vulnerabilidad y las áreas de protección", "Equipo ambiental", "calibrador"),
    ("E4.7", 4, "Talleres de diagnóstico participativo",
     "Memoria de participación (anexo del Diagnóstico)",
     "Talleres por distrito o sector y talleres con poblaciones en condición de "
     "vulnerabilidad; resultados sistematizados", "Municipalidad", "equipo"),
    ("E4.8", 4, "Unificar el Diagnóstico", "Mapa Unificado del Diagnóstico Territorial",
     "Síntesis por eje (potencialidades, limitantes, problemas), geodatabase y matriz de "
     "problemas y causas, que es la base del Pronóstico", "Equipo consultor", "calibrador"),
    # Etapa 6 — Propuesta. Son tres piezas que se entregan juntas: la PDU, los cinco
    # reglamentos obligatorios y el Atlas de la Propuesta.
    ("E6.1", 6, "Redactar la Política de Desarrollo Urbano", "Documento PDU",
     "Síntesis del Diagnóstico y modelo elegido, principios, visión, objetivos, ejes "
     "estratégicos, acciones e instrumentos de gestión del suelo, programa de "
     "implementación e indicadores de seguimiento", "Equipo consultor", "equipo"),
    ("E6.2", 6, "Reglamento de Zonificación", "Articulado del Reglamento de Zonificación",
     "Zonas, usos permitidos y condicionados, parámetros por zona; acá se integra el RDS "
     "del EsIVA", "Equipo consultor", "calibrador"),
    ("E6.3", 6, "Reglamento de Fraccionamientos y Urbanizaciones",
     "Articulado del Reglamento de Fraccionamientos y Urbanizaciones",
     "Lote mínimo, frentes, cesiones, vialidad interna, áreas públicas",
     "Equipo consultor", "calibrador"),
    ("E6.4", 6, "Reglamento de Mapa Oficial", "Articulado del Reglamento de Mapa Oficial",
     "Vías y áreas de uso público, coincidencia con catastro", "Equipo consultor", "atlas"),
    ("E6.5", 6, "Reglamento de Renovación Urbana",
     "Articulado del Reglamento de Renovación Urbana",
     "Áreas de Renovación Urbana (ARU) como capa superpuesta, no como uso de suelo",
     "Equipo consultor", "calibrador"),
    ("E6.6", 6, "Reglamento de Construcciones", "Articulado del Reglamento de Construcciones",
     "Alturas, retiros, cobertura y demás parámetros constructivos",
     "Equipo consultor", "calibrador"),
    ("E6.7", 6, "Armar el Atlas de la Propuesta", "Atlas de la Propuesta en PDF y shapefile",
     "Zonificación, Vialidad, Mapa Oficial, Renovación Urbana y Condicionantes "
     "ambientales; colores en los códigos RGB de la Tabla 3 de la Guía",
     "Equipo consultor", "calibrador"),
    ("E6.8", 6, "Fichas normativas por zona y cuadro de áreas",
     "Fichas por zona con parámetros y cuadro de áreas",
     "Una ficha por zona con sus parámetros; el cuadro de áreas cierra con la superficie "
     "del Área de Planificación", "Equipo consultor", "calibrador"),
    ("E6.9", 6, "Matriz de trazabilidad", "Matriz Diagnóstico → PDU → Reglamentos",
     "Cada norma debe poder rastrearse hasta un problema del Diagnóstico y hasta la "
     "política que la ordena", "Equipo consultor", "equipo"),
    ("E10.4", 10, "Revisión integral", "Revisión del PR",
     "Recomendada cada cinco años (recomendación del Manual, no plazo legal)",
     "Municipalidad", "equipo"),
]

# --------------------------------------------------------------------------------------
# Hitos de pago del cronograma de 18 meses
# --------------------------------------------------------------------------------------
# Un hito puede cubrir VARIOS entregables: el P5 cubre el 5 y el 6, el P6 el 7 y el 8, y el
# P7 el 9, el 10 y el 11. Antes el hito se guardaba dentro de un solo entregable, así que
# los demás salían sin pago y la numeración no cuadraba al leerla de corrido. Ahora la
# tabla manda y cada entregable que cubre un hito lo muestra, diciendo con cuáles lo comparte.
# (hito, mes, porcentaje, [entregables que cubre], condición de pago)
HITOS = [
    ("P1", 1, 10, [1], "Aprobación de la Comisión"),
    ("P2", 3, 10, [2], "Aprobación de la Comisión; revisión por etapa del INVU solicitada"),
    ("P3", 7, 15, [3], "Informe y atlas M1.1 a M1.9.02 aprobados por la Comisión"),
    ("P4", 8, 15, [4], "Documento, atlas M2 y memoria de talleres aprobados"),
    ("P5", 11, 10, [5, 6], "Modelo territorial y PDU validados por la Comisión"),
    ("P6", 13, 10, [7, 8], "EsIVA completo presentado en la plataforma de SETENA"),
    ("P7", 15, 15, [9, 10, 11],
     "Entrega de reglamentos y atlas, y respuestas a SETENA presentadas"),
    ("P8", 16, 5, [12], "Acta y matriz de respuestas entregadas"),
    ("P9", 18, 10, [13],
     "Expediente presentado; conviene retener una parte hasta atender las observaciones del INVU"),
]

# --------------------------------------------------------------------------------------
# Los 15 entregables formales (hitos de pago)
# --------------------------------------------------------------------------------------
# (numero, etapa, nombre, componentes, norma, revisa, depende, hito, mes, porcentaje, condicion)
ENTREGABLES = [
    (0, 1, "Expediente de inicio", "Comisión, área preliminar, presupuesto, TdR, contrato",
     "MAPRIOT 2025", "Concejo", [], None, None, None, None),
    (1, 2, "Plan de trabajo",
     "Marco metodológico, cronograma, plan de participación y comunicación, mapeo de actores",
     "MAPRIOT 2025", "Comisión", [0], "P1", 1, 10, "Aprobación de la Comisión"),
    (2, 2, "Mapa Base", "Geodatabase, Mapa Base, memoria", "Guía de Cartografía 2026",
     "Comisión / INVU por etapa", [1], "P2", 3, 10,
     "Aprobación de la Comisión; revisión por etapa del INVU solicitada"),
    (3, 3, "EsIVA Fase I — IFA", "Informe IFA, Atlas IFA, Matriz A, Mapa IFA Integrado",
     "DE 44710 Anexo 1", "Comisión (SETENA al final)", [2], "P3", 7, 15,
     "Informe y atlas M1.1 a M1.9.02 aprobados por la Comisión"),
    (4, 4, "Diagnóstico Territorial",
     "Documento por ejes, Atlas, Mapa Unificado, memoria de participación",
     "Ley 4240 art. 16; MAPRIOT 2025", "Comisión / INVU por etapa", [2, 3], "P4", 8, 15,
     "Documento, atlas M2 y memoria de talleres aprobados"),
    (5, 5, "Pronóstico Territorial",
     "Tendencias, escenarios, demanda de suelo, modelo territorial", "MAPRIOT 2025",
     "Comisión", [4], None, None, None, None),
    (6, 6, "Política de Desarrollo Urbano",
     "Principios, visión, objetivos, ejes, acciones, implementación, indicadores",
     "Ley 4240 art. 16.a; Guía PDU 2026", "Comisión", [5], "P5", 11, 10,
     "Modelo territorial y PDU validados por la Comisión"),
    (7, 6, "Borrador de zonificación", "Mapa y fichas por zona con parámetros",
     "Guía de Reglamentos 2026", "Comisión", [6, 3], None, None, None, None),
    (8, 3, "EsIVA Fases II y III — AAA y RDS",
     "Matrices B, C y D, capacidad de carga, cuadro de áreas, RDS", "DE 44710 Anexo 1",
     "Comisión", [7], "P6", 13, 10,
     "EsIVA completo presentado en la plataforma de SETENA"),
    (9, 3, "Presentación del EsIVA y viabilidad ambiental",
     "Expediente digital, declaración jurada, respuestas, resolución de VA", "DE 44710",
     "SETENA", [8], None, None, None, None),
    (10, 6, "Reglamentos de Desarrollo Urbano",
     "Zonificación, Fraccionamiento y Urbanizaciones, Mapa Oficial, Renovación Urbana, "
     "Construcciones (+ conexos)", "Ley 4240 art. 19 y ss.; Guía de Reglamentos 2026",
     "Comisión", [7, 8], "P7", 15, 15,
     "Entrega de reglamentos y atlas, y respuestas a SETENA presentadas"),
    (11, 6, "Atlas de la Propuesta",
     "Zonificación, Vialidad, Mapa Oficial, ARU, condicionantes; PDF + shapefile",
     "Guía de Cartografía 2026", "Comisión", [10], None, None, None, None),
    (12, 7, "Audiencia Pública",
     "Aviso en La Gaceta, expediente público, acta, matriz de respuestas, informe de ajustes",
     "Ley 4240 art. 17.1", "Concejo", [9, 10, 11], "P8", 16, 5,
     "Acta y matriz de respuestas entregadas"),
    (13, 8, "Expediente de revisión INVU y aprobación",
     "Solicitud, expediente digital, autoevaluación de criterios mínimos, subsanaciones, "
     "oficio de aprobación", "Ley 4240 art. 17.2; MAPRIOT 2025", "INVU", [12], "P9", 18, 10,
     "Expediente presentado; conviene retener una parte hasta atender las observaciones "
     "del INVU"),
    (14, 9, "Adopción, publicación y seguimiento",
     "Acuerdo del Concejo, publicación en La Gaceta, versión oficial digital, matriz de "
     "seguimiento", "Ley 4240 art. 17.3-4", "Concejo", [13], None, None, None, None),
]

# --------------------------------------------------------------------------------------
# Bloques y componentes cartográficos
# --------------------------------------------------------------------------------------
BLOQUES = [
    ("0", "Mapa Base", 2, "🗺", "La capa sobre la que se montan el EsIVA, el Diagnóstico y "
     "la Propuesta."),
    ("1", "Variable ambiental (EsIVA)", 3, "🌱", "Los cuatro componentes del IFA, su "
     "integración y las condicionantes ambientales."),
    ("2", "Diagnóstico", 4, "🔍", "Seis ejes de lectura del territorio; el ambiental no se "
     "duplica, importa el IFA."),
    ("3", "Pronóstico", 5, "🔮", "Escenarios y modelo territorial elegido."),
    ("4", "Propuesta", 6, "📐", "Zonificación, vialidad, mapa oficial y condicionantes "
     "normativas."),
    ("5", "Seguimiento", 10, "📊", "Reservado para los mapas de seguimiento del plan "
     "adoptado."),
]

COMPONENTES = [
    ("0.0", "0", "Mapa Base"),
    ("0.9", "0", "Síntesis del Mapa Base"),
    ("1.1", "1", "Geoaptitud"),
    ("1.2", "1", "Bioaptitud"),
    ("1.3", "1", "Edafoaptitud"),
    ("1.4", "1", "Antropoaptitud"),
    ("1.5", "1", "Cambio climático"),
    ("1.9", "1", "Síntesis ambiental"),
    ("2.1", "2", "Eje social"),
    ("2.2", "2", "Eje físico-espacial"),
    ("2.3", "2", "Eje económico"),
    ("2.4", "2", "Eje político-institucional"),
    ("2.5", "2", "Eje jurídico"),
    ("2.9", "2", "Síntesis del Diagnóstico"),
    ("3.1", "3", "Tendencias"),
    ("3.2", "3", "Escenarios"),
    ("3.3", "3", "Demanda de suelo"),
    ("3.9", "3", "Modelo territorial"),
    ("4.1", "4", "Zonificación"),
    ("4.2", "4", "Vialidad"),
    ("4.3", "4", "Mapa Oficial"),
    ("4.4", "4", "Renovación Urbana"),
    ("4.5", "4", "Condicionantes normativas"),
    ("4.9", "4", "Síntesis de la Propuesta"),
]

# --------------------------------------------------------------------------------------
# Índice maestro de mapas
# --------------------------------------------------------------------------------------
# (codigo, nombre, etapa, resuelve, atlas_id, guia_invu, condicion, observacion)
#
# `resuelve`  : atlas | calibrador | equipo
# `atlas_id`  : el id con el que el atlas ya produce ese mapa, o None si todavía no.
#               Varios códigos pueden apuntar al mismo id: el atlas resuelve con un solo
#               mapa lo que el índice separa (p. ej. amenaza sísmica e inundación).
# `guia_invu` : es uno de los mapas mínimos de la Guía de Cartografía 2026.
# `condicion` : "si aplica" cuando depende del cantón.
MAPAS = [
    # ---- Bloque 0 · Mapa Base
    ("M0.0.01", "Localización y Área de Planificación", 2, "atlas", "base_cartografica",
     False, None, ""),
    ("M0.0.02", "División político-administrativa y localidades", 2, "atlas",
     "base_cartografica", True, None, ""),
    ("M0.0.03", "Topografía: DEM y curvas de nivel", 2, "atlas", "base_cartografica", True,
     None, "El atlas dibuja las curvas; el DEM hay que conseguirlo aparte"),
    ("M0.0.04", "Hidrografía y cuerpos de agua", 2, "atlas", "base_cartografica", True,
     None, ""),
    ("M0.0.05", "Infraestructura vial, vías férreas y puentes", 2, "atlas", "vialidad",
     True, None, ""),
    ("M0.0.06", "Usos actuales y áreas urbanas (base)", 2, "atlas", "uso_actual_suelo",
     True, None, ""),
    ("M0.0.07", "Cobertura vegetal (base)", 2, "atlas", "uso_actual_suelo", True, None, ""),
    ("M0.0.08", "Áreas de riesgo conocidas", 2, "atlas", "amenazas_condicionantes", True,
     None, ""),
    ("M0.0.09", "Áreas Bajo Régimen Especial (ABRE)", 2, "atlas",
     "amenazas_condicionantes", True, None, ""),
    ("M0.0.10", "Mosaico catastral", 2, "equipo", None, False, None,
     "Base para zonificación y Mapa Oficial; no es capa pública"),
    ("M0.0.11", "Ortofoto u ortomosaico de dron", 2, "equipo", None, False, None,
     "Vuelo propio en zonas urbanas o costeras de detalle"),
    ("M0.9.01", "Mapa Base integrado", 2, "atlas", "base_cartografica", False, None,
     "Síntesis del bloque"),

    # ---- Bloque 1 · Geoaptitud
    ("M1.1.01", "Geológico (litopetrofísica)", 3, "atlas", "geo_litopetrofisico", False,
     None, "Falta la geología de la DGM"),
    ("M1.1.02", "Geomorfológico", 3, "atlas", "geo_geodinamica", False, None, ""),
    ("M1.1.03", "Pendientes", 3, "atlas", None, False, None,
     "El atlas lo calcula cuando se le entrega un DEM"),
    ("M1.1.04", "Susceptibilidad a deslizamientos", 3, "atlas", "geo_estabilidad", False,
     None, "Mora-Vahrson; requiere DEM y lluvia"),
    ("M1.1.05", "Hidrogeológico y vulnerabilidad de acuíferos", 3, "atlas",
     "geo_hidrogeologico", False, None, "Método GOD; requiere criterio SENARA"),
    ("M1.1.06", "Recarga potencial", 3, "equipo", None, False, None,
     "El Anexo 1 exige el método de Schosinsky (2006), con pruebas de infiltración"),
    ("M1.1.07", "Amenaza sísmica y fallas", 3, "atlas", "geo_amenazas", False, None,
     "El atlas lo resuelve junto con las demás amenazas"),
    ("M1.1.08", "Amenaza por inundación", 3, "atlas", "geo_amenazas", False, None,
     "El atlas lo resuelve junto con las demás amenazas"),
    ("M1.1.09", "Amenaza volcánica", 3, "atlas", "geo_amenazas", False, "si aplica", ""),
    ("M1.1.10", "Amenaza costera: tsunami, marejada y erosión", 3, "equipo", None, False,
     "si aplica", "Requiere línea de costa multitemporal y cotas SINAMOT"),
    ("M1.1.90", "IFA Geoaptitud", 3, "atlas", "geo_integrado", False, None,
     "Síntesis del componente"),

    # ---- Bloque 1 · Bioaptitud
    ("M1.2.01", "Cobertura de la tierra", 3, "atlas", "bio_cobertura_vegetal", False, None,
     ""),
    ("M1.2.02", "Áreas de protección legal y ecosistemas frágiles", 3, "atlas",
     "bio_biotopos", False, None, "Art. 33 Ley Forestal; actúa como veto en clase V"),
    ("M1.2.03", "ASP, corredores y conectividad", 3, "atlas", "bio_categorias_manejo",
     False, None, ""),
    ("M1.2.04", "Hábitat de especies amenazadas o endémicas", 3, "equipo", None, False,
     None, "Requiere registros GBIF depurados y muestreo dirigido"),
    ("M1.2.90", "IFA Bioaptitud", 3, "atlas", "ifa_bioaptitud", False, None,
     "Síntesis del componente"),

    # ---- Bloque 1 · Edafoaptitud
    ("M1.3.01", "Unidades de suelo", 3, "atlas", "eda_tipo_suelo", False, None,
     "Insumo; no se clasifica en IFA"),
    ("M1.3.02", "Capacidad de uso de las tierras", 3, "atlas", "eda_capacidad_uso", False,
     None, "DE 23214-MAG-MIRENEM; el INTA puede no cubrir todo el cantón"),
    ("M1.3.03", "Limitantes edáficas", 3, "atlas", "eda_fertilidad", False, None,
     "Erosión, drenaje, profundidad, pedregosidad"),
    ("M1.3.90", "IFA Edafoaptitud", 3, "atlas", "eda_integrado", False, None,
     "Síntesis del componente"),

    # ---- Bloque 1 · Antropoaptitud
    ("M1.4.01", "Uso antrópico actual", 3, "atlas", "ant_uso_antropico", False, None, ""),
    ("M1.4.02", "Patrimonio arqueológico e histórico", 3, "equipo", None, False, None,
     "El atlas ya dibuja los sitios registrados como capa; falta el registro del Museo "
     "Nacional completo"),
    ("M1.4.03", "Infraestructura y servicios", 3, "atlas", "ant_vialidad", False, None,
     "El atlas calcula cobertura por distancia a la red"),
    ("M1.4.04", "Paisaje y presión de ocupación", 3, "atlas", "ant_paisajismo", False,
     None, "Requiere cuencas visuales desde miradores"),
    ("M1.4.90", "IFA Antropoaptitud", 3, "atlas", "ant_integrado", False, None,
     "Síntesis del componente"),

    # ---- Bloque 1 · Cambio climático y síntesis
    ("M1.5.01", "Exposición climática", 3, "equipo", None, False, None,
     "Escenarios del IMN regionalizados al Área de Planificación"),
    ("M1.9.01", "IFA Integrado", 3, "atlas", "ifa_integrado", False, None,
     "Síntesis del bloque; se reutiliza en los bloques 2 y 4 con este mismo código"),
    ("M1.9.02", "Condicionantes ambientales", 3, "atlas", "amenazas_condicionantes", False,
     None, "Se reutiliza en los bloques 2 y 4"),
    ("M1.9.03", "Compatibilidad zonificación × IFA (AAA)", 6, "calibrador", None, False,
     None, "Matriz C; requiere el borrador de zonificación M4.1.01"),
    ("M1.9.04", "Capacidad de carga por sector", 6, "calibrador", None, False, None,
     "AAA; el calibrador ya calcula agua, saneamiento y densidad por zona"),

    # ---- Bloque 2 · Eje social
    ("M2.1.01", "Densidad de población", 4, "equipo", None, False, None, "Requiere INEC"),
    ("M2.1.02", "Crecimiento y proyección de población por distrito", 4, "equipo", None,
     False, None, "Requiere INEC 2011 y el censo más reciente"),
    ("M2.1.03", "Pobreza y vulnerabilidad social", 4, "equipo", None, False, None,
     "Requiere INEC"),
    ("M2.1.04", "Asentamientos informales e irregulares", 4, "equipo", None, True, None,
     ""),
    ("M2.1.05", "Servicios comunales", 4, "atlas", "soc_poblacion", True, None, ""),
    ("M2.1.06", "Déficit de vivienda", 4, "equipo", None, False, None, "Requiere INEC"),
    ("M2.1.90", "Resultados del eje social", 4, "equipo", None, False, None,
     "Síntesis del componente"),

    # ---- Bloque 2 · Eje físico-espacial
    ("M2.2.01", "Uso actual del suelo (detalle)", 4, "atlas", "uso_actual_suelo", True,
     None, ""),
    ("M2.2.02", "Huella y crecimiento urbano multitemporal", 4, "equipo", None, False,
     None, "Requiere series históricas de cobertura"),
    ("M2.2.03", "Estructura y morfología urbana", 4, "calibrador", None, False, None,
     "El transecto T0-T6 del calibrador es justamente esta lectura"),
    ("M2.2.04", "Espacio público y áreas verdes", 4, "equipo", None, False, None, ""),
    ("M2.2.05", "Espacios públicos para comercio al aire libre", 4, "equipo", None, True,
     None, ""),
    ("M2.2.06", "Circulación y transporte", 4, "equipo", None, True, None,
     "Falta la capa de transporte público"),
    ("M2.2.07", "Jerarquía vial", 4, "atlas", "vialidad", False, None, ""),
    ("M2.2.08", "Servicios públicos: agua potable", 4, "atlas", "servicios", True, None,
     "ASADAS, concesiones y tomas registradas"),
    ("M2.2.09", "Servicios públicos: saneamiento y pluvial", 4, "equipo", None, True, None,
     ""),
    ("M2.2.10", "Servicios públicos: energía y telecomunicaciones", 4, "atlas",
     "servicios", True, None, "Cobertura del tendido eléctrico derivada de ARESEP"),
    ("M2.2.11", "Patrimonio urbano", 4, "equipo", None, False, None, ""),
    ("M2.2.12", "Áreas con potencial de renovación urbana", 4, "calibrador", None, True,
     None, "Alimenta el Reglamento de Renovación Urbana"),
    ("M2.2.90", "Resultados del eje físico-espacial", 4, "equipo", None, False, None,
     "Síntesis del componente"),

    # ---- Bloque 2 · Eje económico
    ("M2.3.01", "Actividades económicas", 4, "atlas", "eco_actividades", False, None,
     "Requiere el directorio de empresas"),
    ("M2.3.02", "Turismo", 4, "equipo", None, False, "si aplica", ""),
    ("M2.3.03", "Valores de suelo", 4, "atlas", None, False, None,
     "PlanoExactoCR ya tiene avalúos de remates: insumo directo"),
    ("M2.3.90", "Resultados del eje económico", 4, "equipo", None, False, None,
     "Síntesis del componente"),

    # ---- Bloque 2 · Eje político-institucional
    # El eje solo traía "Actores e instituciones"; se amplía con el resto de apartados
    # habituales de un diagnóstico político-institucional (capacidad de gestión,
    # instrumentos vigentes, articulación interinstitucional). Es un borrador propio del
    # equipo, no una transcripción del MAPRIOT: ver el punto correspondiente en
    # `verificar` más abajo.
    ("M2.4.01", "Actores e instituciones", 4, "equipo", None, False, "opcional", ""),
    ("M2.4.02", "Capacidad de gestión municipal", 4, "equipo", None, False, None,
     "Personal técnico y presupuesto de la unidad de planificación, nivel de "
     "digitalización del catastro y los trámites"),
    ("M2.4.03", "Instrumentos de planificación vigentes", 4, "equipo", None, False, None,
     "Plan regulador anterior y reglamentos conexos que siguen rigiendo mientras se "
     "publica el nuevo, plan de desarrollo cantonal, convenios de delegación de "
     "competencias"),
    ("M2.4.04", "Articulación interinstitucional", 4, "equipo", None, False, None,
     "Competencias concurrentes con SETENA, INVU, AyA, ICE, MOPT, CNE y demás "
     "instituciones con presencia en el territorio, y los mecanismos de coordinación "
     "que ya existen"),
    ("M2.4.90", "Resultados del eje político-institucional", 4, "equipo", None, False,
     None, "Síntesis del componente"),

    # ---- Bloque 2 · Eje jurídico
    ("M2.5.01", "Restricciones legales y ABRE (detalle)", 4, "atlas",
     "amenazas_condicionantes", False, None, ""),
    ("M2.5.02", "Normativa y zonificación vigentes", 4, "atlas", None, False, None,
     "El atlas ya tiene la capa de planes reguladores vigentes"),
    ("M2.5.90", "Resultados del eje jurídico", 4, "equipo", None, False, None,
     "Síntesis del componente"),

    # ---- Bloque 2 · Síntesis
    ("M2.9.01", "Mapa Unificado del Diagnóstico", 4, "equipo", None, False, None,
     "Síntesis del bloque"),
    ("M2.9.02", "Potencialidades y limitantes", 4, "equipo", None, False, None, ""),

    # ---- Bloque 3 · Pronóstico
    ("M3.1.01", "Tendencias de crecimiento", 5, "equipo", None, False, None, ""),
    ("M3.2.01", "Escenario tendencial", 5, "calibrador", None, False, None, ""),
    ("M3.2.02", "Escenario deseable", 5, "calibrador", None, False, None,
     "Se construye en taller de visión"),
    ("M3.2.03", "Escenario posible o concertado", 5, "calibrador", None, False, None,
     "Limitado por capacidad de carga y finanzas municipales"),
    ("M3.3.01", "Demanda de suelo", 5, "calibrador", None, False, None,
     "El calibrador ya calcula hectáreas por uso y densidad"),
    ("M3.9.01", "Modelo territorial", 5, "calibrador", None, False, None,
     "Síntesis del bloque"),

    # ---- Bloque 4 · Propuesta
    ("M4.1.01", "Zonificación", 6, "calibrador", None, True, None,
     "Colores en códigos RGB de la Tabla 3 de la Guía de Cartografía"),
    ("M4.1.02", "Cuadrantes urbanos y de ciudad", 6, "calibrador", None, False, None,
     "Art. 40 Ley 4240; base de la cesión de áreas"),
    ("M4.1.03", "Densidades", 6, "calibrador", None, False, None, ""),
    ("M4.2.01", "Vialidad", 6, "calibrador", None, True, None,
     "Jerarquía nacional y cantonal, vías propuestas"),
    ("M4.3.01", "Mapa Oficial", 6, "calibrador", None, True, None,
     "Debe coincidir con el catastro"),
    ("M4.4.01", "Áreas de Renovación Urbana", 6, "calibrador", None, False, None,
     "No es un uso de suelo, es una capa superpuesta"),
    ("M4.5.01", "Condicionantes normativas ambientales (RDS)", 6, "calibrador", None,
     False, None, "Deriva de M1.9.02 y de la viabilidad ambiental"),
    ("M4.9.01", "Plano síntesis del Plan Regulador", 6, "equipo", None, False, None,
     "Síntesis del bloque"),
]

# --------------------------------------------------------------------------------------
# Matriz C — compatibilidad de la zona propuesta con la clase IFA
# --------------------------------------------------------------------------------------
# P compatible · C condicionado a estudio o medidas · R restringido a baja intensidad ·
# X incompatible. Las columnas van de la clase I (menos frágil) a la V (más frágil).
MATRIZ_C = [
    ("Centro urbano / mixta de alta densidad", ["P", "P", "C", "X", "X"]),
    ("Residencial de densidad media", ["P", "P", "C", "X", "X"]),
    ("Residencial de baja densidad", ["P", "P", "C", "R", "X"]),
    ("Comercial y de servicios", ["P", "P", "C", "X", "X"]),
    ("Industrial y logística", ["P", "C", "C", "X", "X"]),
    ("Turística", ["P", "P", "C", "R", "X"]),
    ("Agropecuaria", ["P", "P", "P", "C", "X"]),
    ("Agroforestal / rural de amortiguamiento", ["P", "P", "P", "P", "R"]),
    ("Protección y conservación", ["P", "P", "P", "P", "P"]),
    ("Equipamiento e infraestructura pública", ["P", "P", "C", "C", "X"]),
]

# --------------------------------------------------------------------------------------
# Matriz D — de la condicionante ambiental a la norma
# --------------------------------------------------------------------------------------
# (condicionante, ambito, norma, reglamento, instrumento_de_control)
MATRIZ_D = [
    ("Susceptibilidad a deslizamientos", "IFA III-V geoaptitud",
     "Estudio geotécnico previo; cobertura y movimientos de tierra limitados",
     "Zonificación y Construcciones", "Certificado de uso de suelo + permiso de construcción"),
    ("Inundación", "Planicies y zonas CNE",
     "Prohibición de vivienda; usos recreativos o agrícolas; nivel mínimo de piso",
     "Zonificación", "Certificado de uso de suelo"),
    ("Vulnerabilidad alta de acuíferos", "IFA-hidro IV-V",
     "Restricción de usos contaminantes y densidad según criterio SENARA; tratamiento de "
     "aguas obligatorio", "Zonificación y Fraccionamiento",
     "Visado y aprobación de urbanizaciones"),
    ("Zonas de recarga", "Recarga alta",
     "Cobertura y índice de permeabilidad mínimos", "Zonificación", "Revisión de planos"),
    ("Nacientes y riberas", "Ley Forestal art. 33",
     "Retiros de protección; cesión como parque lineal",
     "Fraccionamiento y Mapa Oficial", "Plano catastrado y visado"),
    ("Fallas activas", "Protocolo de fallas", "Franja de retiro sin edificación",
     "Zonificación y Construcciones", "Permiso de construcción"),
    ("Ecosistemas frágiles y corredores", "Bioaptitud IV-V",
     "Zona de protección; lote mínimo amplio en amortiguamiento", "Zonificación",
     "Certificado de uso de suelo"),
    ("Suelos de alta capacidad agrícola", "Edafoaptitud",
     "Freno a la urbanización fuera de cuadrantes", "Zonificación y Fraccionamiento",
     "Fraccionamiento con fines urbanísticos"),
    ("Patrimonio arqueológico", "Antropoaptitud", "Evaluación arqueológica previa",
     "Construcciones", "Requisito del permiso"),
    ("Exposición costera y climática", "Costa y zonas expuestas",
     "Retiros, cotas mínimas, soluciones basadas en naturaleza",
     "Zonificación y Renovación Urbana", "Certificado de uso de suelo"),
]

# --------------------------------------------------------------------------------------
# Los cinco reglamentos obligatorios
# --------------------------------------------------------------------------------------
REGLAMENTOS = [
    ("Zonificación",
     "Zonas de uso y su función; ubicación; área y frente mínimo de lote; altura, área de "
     "piso, retiros y cobertura por zona; densidad; usos conformes, condicionales, no "
     "conformes y prohibidos; zonas especiales; publicidad; certificado de uso de suelo; "
     "cuadrantes de ciudad y urbanos para la cesión (art. 40)",
     "Núcleo del RDS: Matrices B, C y D; condiciones por clase IFA en cada ficha de zona"),
    ("Fraccionamientos y Urbanizaciones",
     "Acceso a vía pública, lotificación, servicios, derechos de vía; fraccionamiento "
     "simple, con fines urbanísticos y excepcional; cesión de área pública entre 5 % y "
     "20 %; tope de 45 % para calles, juegos, parques y facilidades; visados y "
     "aprobaciones; garantía de cumplimiento a 5 años",
     "Riberas y nacientes como cesión o retiro; restricción en zonas de recarga y "
     "vulnerabilidad"),
    ("Mapa Oficial",
     "Áreas para vías, parques, plazas y edificios comunales, existentes y previstas; "
     "reservas y adquisición; base catastral y datos por predio",
     "Parques lineales y áreas de protección públicas"),
    ("Renovación Urbana",
     "Normas para conservar, rehabilitar, remodelar o regenerar; Áreas de Renovación "
     "Urbana como capa superpuesta; restricciones por 5 años; apertura o rectificación de "
     "calles; reajuste de terrenos e instrumentos de gestión del suelo",
     "Reubicación desde zonas de amenaza; soluciones basadas en naturaleza"),
    ("Construcciones",
     "Requisitos mínimos de edificación e infraestructura; permiso de construcción; "
     "remisión a la normativa nacional",
     "Estudios geotécnicos, arqueológicos e hidrológicos como requisito según clase IFA"),
]

# --------------------------------------------------------------------------------------
# Procesos transversales y puntos a verificar
# --------------------------------------------------------------------------------------
TRANSVERSALES = [
    ("Participación ciudadana",
     "Talleres por etapa; el MAPRIOT 2025 la trata como proceso continuo, no solo como la "
     "audiencia final"),
    ("Consulta indígena",
     "Obligatoria cuando el Área de Planificación toca territorios indígenas"),
    ("Comunicación y coordinación interinstitucional",
     "Guía de comunicación INVU; SETENA, SENARA, ICT si hay ZMT, CNE, MOPT, AyA, Museo "
     "Nacional"),
    ("Revisión por etapas del INVU",
     "Servicio de acompañamiento que adelanta observaciones antes del trámite formal"),
]

VERIFICAR = [
    "Texto íntegro del Anexo 1 (IFA) del DE 44710: factores, ponderaciones, escalas "
    "(se admite 1:50.000), uso obligatorio de Schosinsky y tratamiento del cambio "
    "climático.",
    "Anexo 4 (guía del cliente) y Anexo 5 (guía de revisión de SETENA): formatos de capas, "
    "formularios y lista de verificación.",
    "Acción de inconstitucionalidad contra el art. 31 del DE 44710 "
    "(exp. 25-035276-0007-CO, Boletín Judicial N.º 225 del 28-nov-2025).",
    "Transitorios del DE 44710: cómo siguen los estudios iniciados bajo el DE 32967.",
    "Texto completo del MAPRIOT 2025: tabla de Productos Mínimos Requeridos por etapa y "
    "matriz de criterios mínimos de revisión.",
    "Guía de la Política de Desarrollo Urbano 2026: cruzar el contenido mínimo de la PDU.",
    "Casos especiales del cantón: criterio de SENARA sobre acuíferos, consulta indígena y, "
    "si hay ZMT, el PRC costero con su propio manual del ICT.",
    "Dirección del numeral de las clases IFA: acá I es la menos frágil y V la más frágil, "
    "siguiendo la Matriz B de la guía. La Tabla Nº 3 del derogado 32967 puntúa al revés "
    "porque puntúa aptitud; confirmar contra el Anexo 1 del 44710 antes de cerrar los TdR.",
    "Apartados del eje político-institucional (M2.4.02 a M2.4.04): se redactaron con el "
    "criterio del equipo, a falta del texto completo del MAPRIOT 2025 citado arriba. "
    "Cruzarlos contra la tabla de Productos Mínimos Requeridos antes de darlos por cerrados.",
]

NORMAS = [
    ("Ley de Planificación Urbana N.º 4240",
     "Competencia municipal (art. 15), contenido mínimo del PR (art. 16), requisitos de "
     "adopción (art. 17) y los cinco reglamentos de desarrollo urbano (art. 19 y ss.)",
     "Vigente"),
    ("MAPRIOT 2025 (INVU) + guías 2026",
     "Etapas, productos mínimos requeridos, trámite de revisión por etapas, adopción y "
     "seguimiento",
     "Aprobado en sesión JDINVU-028-2025 (6-nov-2025); guías en el Alcance 29 a La Gaceta "
     "53 (18-mar-2026)"),
    ("DE 44710-MINAE (RIVAIOT)",
     "EsIVA y su viabilidad ambiental ante SETENA; dos metodologías: Anexo 1 IFA y "
     "Anexo 2 RIVAIOT",
     "Publicado el 17-feb-2025; vigente desde el 18-ago-2025; deroga el DE 32967-MINAE"),
    ("Complementarios",
     "Guía INVU de Gestión del Riesgo y Acción Climática; Guía de comunicación; Cuadrantes "
     "Urbanos; criterio SENARA sobre acuíferos; consulta indígena donde aplique",
     "Vigentes; aplicar según el cantón"),
]


def construir() -> dict:
    """Arma el diccionario completo que se publica como JSON."""
    clases = [
        {
            "orden": v, "numeral": n, "fragilidad": f, "color": c,
            "lectura": lec, "uso": uso, "estrategia": est, "zonificacion": zon,
        }
        for v, n, f, c, lec, uso, est, zon in CLASES_IFA
    ]

    etapas = [
        {
            "numero": num, "nombre": nom, "bloque": blo, "lidera": lid, "revisa": rev,
            "cierra": cie,
        }
        for num, nom, blo, lid, rev, cie in ETAPAS
    ]

    productos = [
        {
            "codigo": cod, "etapa": et, "actividad": act, "entregable": ent,
            "contenido": con, "responsable": res, "resuelve": resu,
        }
        for cod, et, act, ent, con, res, resu in PRODUCTOS
    ]

    # El hito de pago lo manda la tabla HITOS, no el entregable: así un hito que cubre
    # varios entregables aparece en todos ellos y ninguno queda sin pago.
    por_entregable = {}
    for hito, mes, pct, cubre, cond in HITOS:
        for n in cubre:
            por_entregable[n] = {"hito": hito, "mes": mes, "porcentaje": pct,
                                 "condicion_de_pago": cond,
                                 "hito_cubre": [c for c in cubre]}
    entregables = [
        {
            "numero": num, "etapa": et, "nombre": nom, "componentes": comp, "norma": nor,
            "revisa": rev, "depende": dep,
            "hito": por_entregable.get(num, {}).get("hito"),
            "mes": por_entregable.get(num, {}).get("mes"),
            "porcentaje": por_entregable.get(num, {}).get("porcentaje"),
            "condicion_de_pago": por_entregable.get(num, {}).get("condicion_de_pago"),
            "hito_cubre": por_entregable.get(num, {}).get("hito_cubre", []),
        }
        for num, et, nom, comp, nor, rev, dep, _h, _m, _p, _c in ENTREGABLES
    ]
    suma = sum(pct for _h, _m, pct, _cu, _co in HITOS)
    if suma != 100:
        raise SystemExit(f"Los hitos de pago suman {suma} %, no 100 %.")

    bloques = [
        {"codigo": cod, "nombre": nom, "etapa": et, "icono": ico, "descripcion": desc}
        for cod, nom, et, ico, desc in BLOQUES
    ]

    componentes = [
        {"codigo": cod, "bloque": blo, "nombre": nom}
        for cod, blo, nom in COMPONENTES
    ]

    mapas = []
    for cod, nom, et, resu, aid, guia, condi, obs in MAPAS:
        partes = cod.lstrip("M").split(".")
        mapas.append({
            "codigo": cod,
            "nombre": nom,
            "bloque": partes[0],
            "componente": f"{partes[0]}.{partes[1]}",
            "correlativo": partes[2],
            "etapa": et,
            "resuelve": resu,
            "atlas": aid,
            "guia_invu": guia,
            "condicion": condi,
            "observacion": obs,
            "sintesis": partes[2] == "90" or partes[1] == "9",
        })

    matriz_c = {
        "leyenda": {
            "P": "compatible",
            "C": "condicionado a estudio o medidas",
            "R": "restringido a baja intensidad",
            "X": "incompatible",
        },
        "columnas": [n for _, n, *_ in CLASES_IFA],
        "filas": [{"zona": z, "clases": v} for z, v in MATRIZ_C],
        "nota": "Toda celda C o R debe tener su condición escrita en el RDS. Toda celda X "
                "que la propuesta ocupe debe corregirse en la zonificación o justificarse "
                "con estudio de detalle.",
    }

    matriz_d = [
        {
            "condicionante": c, "ambito": a, "norma": n, "reglamento": r,
            "control": ctrl,
        }
        for c, a, n, r, ctrl in MATRIZ_D
    ]

    reglamentos = [
        {"nombre": n, "contenido": c, "variable_ambiental": v}
        for n, c, v in REGLAMENTOS
    ]

    return {
        "version": "1.0",
        "generado": "2026-11-18",
        "fuente": FUENTE,
        "nota": "Estructura del Plan Regulador compartida por atlas.planoexactocr.com y "
                "calibrador.planoexactocr.com. Un solo archivo para que los códigos de "
                "mapa, las etapas y los entregables sean los mismos en los dos sitios y "
                "en el expediente que llega al INVU.",
        "proyeccion": "CRTM05 (EPSG:5367)",
        "codificacion": {
            "patron": "M[bloque].[componente].[correlativo]",
            "ejemplo": "M1.1.04 = bloque 1 (variable ambiental), componente 1 "
                       "(geoaptitud), mapa 04 (susceptibilidad a deslizamientos)",
            "reglas": [
                "El código es permanente. Un mapa que se reutiliza en otro producto "
                "conserva su código de origen.",
                "Un código no se recicla. Si un mapa se elimina, su código se retira.",
                "Mapas de varias hojas: sufijo -h1, -h2.",
                "Versiones: sufijo _v01, _v02 en el archivo; versión y fecha en el cajetín.",
                "Nombre de PDF: M1.1.04_SusceptibilidadDeslizamientos_v01.pdf; de capa: "
                "m1_1_04_susc_desliz.shp (minúsculas, guión bajo, sin tildes ni espacios).",
                "Correlativo 90 reservado para el mapa que integra el componente.",
                "Carpetas: PR_[código]_[NC] con una subcarpeta por bloque (0_MapaBase, "
                "1_Ambiental, 2_Diagnostico, 3_Pronostico, 4_Propuesta).",
                "Ficha técnica por mapa: código, título, objetivo, insumos y fechas, "
                "método, escala, unidad mínima cartografiable, responsable, validación y "
                "limitaciones.",
            ],
        },
        "escalas": {
            "trabajo": "1:10.000 base cantonal; 1:5.000 en áreas urbanas y costeras",
            "lienzo_horizontal": ["1:5.000", "1:10.000", "1:25.000"],
            "lienzo_vertical": ["1:50.000", "1:100.000"],
            "nota": "El Anexo 1 del DE 44710 admite 1:50.000; usarla solo en sectores "
                    "rurales extensos y justificarlo.",
        },
        "normas": [{"instrumento": i, "fija": f, "estado": e} for i, f, e in NORMAS],
        "clases_ifa": clases,
        "clases_ifa_nota": "El numeral romano es el oficial y el que citan los reglamentos: "
                           "Zona I es la MENOS frágil y Zona V la más frágil. `orden` es el "
                           "rango por fragilidad, no el valor del ráster: el ráster del "
                           "atlas numera al revés (1 = más frágil), porque sigue la escala "
                           "de puntos de la Tabla Nº 3 del 32967. Lo que coincide en los dos "
                           "lados, y lo único que sale impreso, es el par nombre + color.",
        "etapas": etapas,
        "productos": productos,
        "entregables": entregables,
        "bloques": bloques,
        "componentes": componentes,
        "mapas": mapas,
        "matriz_compatibilidad": matriz_c,
        "condicionantes": matriz_d,
        "reglamentos": reglamentos,
        "transversales": [{"proceso": p, "descripcion": d} for p, d in TRANSVERSALES],
        "verificar": VERIFICAR,
    }


def main() -> None:
    datos = construir()
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(
        json.dumps(datos, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    mapas = datos["mapas"]
    por_quien: dict[str, int] = {}
    for m in mapas:
        por_quien[m["resuelve"]] = por_quien.get(m["resuelve"], 0) + 1
    con_atlas = sum(1 for m in mapas if m["atlas"])

    print(f"Escrito {SALIDA.relative_to(RAIZ)}")
    print(f"  {len(datos['etapas'])} etapas, {len(datos['productos'])} productos, "
          f"{len(datos['entregables'])} entregables formales")
    print(f"  {len(mapas)} mapas en el índice maestro")
    for quien in ("atlas", "calibrador", "equipo"):
        print(f"    {quien:<11} {por_quien.get(quien, 0)}")
    print(f"  {con_atlas} ya tienen lámina en el atlas")


if __name__ == "__main__":
    main()
