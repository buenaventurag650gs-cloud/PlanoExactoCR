/* PlanoExactoCR — guía completa, metodología, términos y «quiénes somos».
   El servidor entrega este archivo solo a quien entra con su cuenta; los visitantes reciben una versión corta. */
(function () {
  'use strict';
  const { esc } = PX;
  function guideHTML() {
    const I = PX.ICON, cupo = PX.PRECIOS.semanalEsencial, P_ = PX.PRO;
    // Bloques didácticos: tarjeta con «para qué sirve», pasos numerados y un ejemplo
    const steps = arr => `<ol class="gsteps">${arr.map(t => `<li><span>${t}</span></li>`).join('')}</ol>`;
    const card = (ic, t, pro, para, pasos, ej) => `<div class="gcard"><h4><span class="gi">${ic || ''}</span>${t}${pro ? ' ' + P_ : ''}</h4>
      <p class="gpara"><b>¿Para qué sirve?</b> ${para}</p>${pasos ? `<div class="glbl">Cómo se usa</div>${steps(pasos)}` : ''}${ej ? `<p class="gej"><b>Ejemplo:</b> ${ej}</p>` : ''}</div>`;
    const tip = t => `<p class="gtip"><b>Consejo</b> ${t}</p>`;
    const sec = (id, t, intro, body) => `<section class="gsec" id="g-${id}"><h3>${t}</h3>${intro ? `<p class="gintro">${intro}</p>` : ''}${body}</section>`;
    const toc = [['inicio', 'En 5 pasos'], ['mapa', 'El mapa'], ['buscar', 'Buscar y filtrar'], ['ficha', 'La ficha'], ['herr', 'Herramientas PRO'], ['exp', 'Expediente'], ['met', 'Índices y metodología'], ['fuentes', 'Origen de los datos'], ['gloss', 'Palabras clave']];
    const flow = [[I.pin, 'Mira el mapa', 'Cada cruz es una propiedad en remate.'], [I.list, 'Filtra', 'Elige zona, precio, tamaño o tipo.'], [I.Lote, 'Abre la ficha', 'Haz clic en una cruz o en la lista.'], [I.valor, 'Analiza', 'Usa las herramientas PRO.'], [I.gavel, 'Decide', 'Descarga el expediente y verifica.']];
    return `<div class="about guide">
      <nav class="gtoc" aria-label="Contenido">${toc.map(([k, t]) => `<button class="chip" data-gto="${k}">${t}</button>`).join('')}</nav>

      ${sec('inicio', 'PlanoExactoCR en 5 pasos', 'PlanoExactoCR te muestra en un mapa las propiedades que salen a remate judicial en Costa Rica y te ayuda a entender cada una antes de ofertar.',
        `<div class="gflow">${flow.map(([ic, t, d], i) => `<div class="gstep"><span class="gn">${i + 1}</span><span class="gi">${ic}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
        ${tip('¿Prefieres ver los montos en dólares? Cambia la moneda arriba a la derecha (₡ / $). Siempre verás también el equivalente en la otra moneda.')}`)}

      ${sec('mapa', 'Cómo leer el mapa', '',
        `<div class="ggrid">
          <div class="gcard"><h4>Las cruces y sus colores</h4><p class="gpara">El color dice en qué remate va la propiedad. Mientras más avanza, más baja el precio mínimo (la <b>base</b>).</p>
            <ul class="gkey"><li>${PX.stageBadge(0, true)} <span><b>Primer remate</b>: precio completo</span></li><li>${PX.stageBadge(1, true)} <span><b>Segundo remate</b>: 75 % del precio</span></li><li>${PX.stageBadge(2, true)} <span><b>Tercer remate</b>: 25 % del precio</span></li><li><i class="gfav"></i> <span>Punto rojizo al centro: <b>tu favorito</b></span></li></ul></div>
          <div class="gcard"><h4>Moverte por el mapa</h4><ul class="gkey">
            <li><span class="gk">+ / −</span><span>Acerca o aleja. El número indica el nivel: <b>8</b> ves el país, <b>17</b> ves la calle.</span></li>
            <li><span class="gk">Mouse</span><span>Al pasarlo te dice en qué distrito y cantón estás.</span></li>
            <li><span class="gk">Clic</span><span>En el mapa: te muestra los datos de las capas que tengas encendidas en ese punto.</span></li></ul></div>
        </div>
        ${card(I.entorno, 'Capas: información sobre el mapa', false, 'Encender información extra encima del mapa, como el valor del terreno, el agua potable o los ríos.',
          ['Pulsa <b>Capas</b> (arriba a la izquierda).', 'Abre un grupo, por ejemplo <b>Valor y mercado</b>.', 'Marca la capa que quieras ver. Para quitarla, desmárcala.'],
          'enciende <b>Zonas homogéneas de Hacienda</b> y acércate a una ciudad: verás cuánto vale el m² de terreno en cada zona, en colones y dólares.')}
        <p class="gmini">Gratis: mapas base, límites, catastro, nombres de ríos y estado del plan regulador. ${P_}: valor del terreno, precios por m², agua potable, vías, puertos y aeropuertos, salud, zonas de vida, uso del suelo, curvas de nivel, áreas protegidas y zona marítimo terrestre.</p>`)}

      ${sec('buscar', 'Buscar y filtrar', 'Hay más de 800 remates. Los filtros te ayudan a quedarte solo con los que te interesan.',
        `${card(I.list, 'Filtros', false, 'Reducir la lista a lo que buscas.',
          ['En <b>Ubicación</b> escribe un lugar o elige provincia y cantón.', 'En <b>Remate</b> elige la etapa, las fechas y cuánto quieres pagar como máximo.', 'En <b>Características</b> elige el tipo (lote, casa, finca agrícola…) y el tamaño en m².'],
          'lotes en Guanacaste, de 500 a 2&nbsp;000&nbsp;m², con base menor a ₡20&nbsp;millones.')}
        <div class="ggrid">
          <div class="gcard"><h4>Botones útiles</h4><ul class="gkey">
            <li><span class="gk">Restablecer</span><span>Borra todos los filtros y vuelve el mapa a la vista inicial.</span></li>
            <li><span class="gk">Favoritos</span><span>Muestra solo los que marcaste con ♥.</span></li>
            <li><span class="gk">Calendario</span><span>Ve los remates día por día. Los de <b>mañana</b> salen resaltados.</span></li>
            <li><span class="gk">Guardar búsqueda</span><span>Guarda tus filtros para usarlos otra vez.</span></li></ul></div>
          ${card(I.registro, 'Buscar un plano', false, 'Consultar cualquier terreno del país, esté o no en remate.', ['Abre la pestaña <b>Buscar plano</b>.', 'Escribe el número de plano (por ejemplo P-1311611-2008) o el de finca.', 'Pulsa <b>Buscar en el catastro</b> y luego <b>Ver en el mapa</b>.'], '')}
        </div>
        ${tip(`Con ${P_} tienes filtros extra por <b>atributos del lote</b>: terreno plano, con construcción, frente a calle pública, zona urbana y más.`)}`)}

      ${sec('ficha', 'La ficha de cada propiedad', 'Al abrir una propiedad ves su ficha a la derecha. Está ordenada como una historia: primero cuánto y cuándo, después cómo es el terreno y al final los datos legales.',
        `<div class="gtable">
          <div><b>Remate</b><span>Precio mínimo (base) y las fechas de los tres remates.</span></div>
          <div><b>Valor y mercado</b> ${P_}<span>Cuánto vale la propiedad según Hacienda, el <b>Índice Puja/Hacienda</b> y la <b>escala PECR</b> (del 1 al 10).</span></div>
          <div><b>Terreno</b><span>Tamaño, forma aproximada, si es plano o quebrado, y uso actual del suelo.</span></div>
          <div><b>Servicios y entorno</b><span>Agua potable, calle, salud, escuela, ríos y costa cercanos.</span></div>
          <div><b>Normativa</b><span>Qué plan regulador aplica (o las normas nacionales si el cantón no tiene).</span></div>
          <div><b>Registro y ubicación</b><span>Número de finca y plano, y qué tan exacta es la ubicación en el mapa.</span></div>
        </div>
        ${tip('Usa ♥ <b>Favorito</b> para marcarla, <b>Seguir</b> para recibir avisos y <b>Comparar</b> para ponerla junto a otras.')}`)}

      ${sec('herr', `Herramientas ${P_}`, `Responden las preguntas que todo comprador se hace. Se abren desde la ficha (recuadro dorado) o desde la pestaña ${P_} de la izquierda. Todos los números se pueden cambiar y el resultado se actualiza solo.`,
        `<div class="ggrid">
        ${card(I.valor, '¿Cuánto vale realmente?', true, '<b>Valor de referencia.</b> Estima el valor de la propiedad para saber si la base es buena oportunidad.',
          ['Revisa el área del terreno y el valor de Hacienda (ya vienen llenos).', 'Si tiene casa, ajusta el área construida, el tipo de construcción, la edad y el estado.', 'Mira el resultado: <b>Base frente a referencia</b>.'],
          'si dice <b>60 %</b>, la base es un 40 % menor que el valor de referencia.')}
        ${card(I.Lote, '¿Cuánto puedo construir?', true, '<b>Potencial constructivo.</b> Calcula cuántos m² y cuántas casas o apartamentos caben en el lote.',
          ['Revisa cobertura (qué porcentaje del lote se puede techar) y número de pisos.', 'Indica el tamaño de cada unidad (por ejemplo 80 m²).', 'Lee cuántas unidades caben y cuántos lotes saldrían si se divide.'], '')}
        ${card(I.valor, '¿Es buen negocio?', true, '<b>Prefactibilidad financiera.</b> Calcula cuánto invertirías, cuánto podrías ganar y en cuánto tiempo.',
          ['Elige: <b>comprar y revender</b> el terreno o <b>construir y vender</b>.', 'Escribe tu oferta y revisa los gastos (traspaso, abogado, timbres).', 'Mira la <b>utilidad</b> y el <b>retorno</b>. En verde, gana; en rojo, pierde.'],
          'el <b>punto de equilibrio</b> te dice el precio mínimo al que tendrías que vender para no perder.')}
        ${card(I.norma, '¿Qué puede salir mal?', true, '<b>Riesgos del proceso.</b> Lista los problemas posibles de esa propiedad y qué revisar antes de ofertar.', '', 'hipotecas que siguen vigentes, servidumbres, gente viviendo en la casa o restricciones ambientales.')}
        </div>
        <div class="gtable">
          <div><b>Alertas</b><span>Te avisa por correo o WhatsApp si un remate que sigues cambia de fecha o etapa, o si sale uno nuevo que cumple tu búsqueda guardada.</span></div>
          <div><b>Mapa de precios</b><span>Pinta cada cantón según el precio típico por m² de los remates.</span></div>
          <div><b>Top 10 del mes</b><span>Los remates mejor calificados de cada provincia.</span></div>
          <div><b>Comparar</b><span>Gratis comparas 2 propiedades; con ${P_}, hasta 4, y decides qué pesa más para ti (precio, servicios, entorno…).</span></div>
        </div>`)}

      ${sec('exp', 'El expediente en PDF', 'Un informe de 4 hojas con todo lo importante de una propiedad, listo para imprimir, guardar o compartir con tu abogado.',
        `<div class="gflow g4">${[['Mapa', 'El lote, su entorno y una vista satelital.'], ['Ficha', 'Fechas, registro, valor y análisis.'], ['Normativa y riesgos', 'Lo que se puede hacer y lo que hay que revisar.'], ['Edicto', 'El texto oficial del remate.']].map(([t, d], i) => `<div class="gstep"><span class="gn">${i + 1}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
        <p class="gmini">Se genera con el botón <b>Generar expediente</b> de la ficha. Se compra por propiedad o viene incluido en ${P_} (sin límite; en Esencial, ${cupo} por semana).</p>`)}

      ${sec('met', 'Índices y metodología', 'Cómo se calcula cada número que ves en la ficha y en el expediente. Son referencias para comparar, no avalúos.',
        `${card(I.valor, 'Índice Puja/Hacienda (IPH)', false, 'Saber en un solo número si el precio con que arranca la puja es bajo o alto frente al valor que Hacienda le da a la propiedad.',
          ['Se toma la <b>base vigente</b>: el precio con que arranca la puja en el remate que sigue.', 'Se calcula el <b>valor según Hacienda</b>: área × valor de la zona homogénea; si hay casa, se suma la construcción estimada con el manual de tipologías de la ONT.', '<b>IPH = base vigente ÷ valor según Hacienda × 100.</b>'],
          'IPH <b>45</b> quiere decir que la puja arranca en el 45 % del valor de Hacienda. Si el remate pasa a la siguiente etapa, el índice baja: la ficha muestra el IPH del 1.º, 2.º y 3.º remate.')}
        <div class="gtable">${PX.IPH.map((b, i) => `<div><b><span class="iphdot" style="--c:${b[2]}"></span>${i ? 'de ' + PX.IPH[i - 1][0] + ' ' : 'menos de '}${b[0] === Infinity ? 'o más' : (i ? 'a ' : '') + b[0]}</b><span><b>${b[1]}.</b> ${b[3]}</span></div>`).join('')}</div>
        <p class="gmini">${PX.iphBar(45)}</p>
        ${tip('Hacienda suele valorar por debajo del mercado, así que un IPH bajo es una señal fuerte. Un IPH muy bajo (menos de 10) también puede indicar que se remata solo una parte de la finca (derechos) o que el área del edicto no coincide: la ficha lo advierte.')}

        ${card(I.entorno, 'Escala PECR, PlanoExactoCR (niveles 1 a 10)', false, 'Ubicar el lote en una escala de valor según su acceso, servicios y entorno, con un rango orientativo de precio por m².', '', '')}
        <div class="gtable pecrtab">${PX.PECR.map(x => `<div><b><span class="pn">${x[0]}</span><span class="pico">${PX.PECR_ICON[x[0] - 1]}</span>${PX.pecrRango(x)}</b><span>${esc(x[1])}</span></div>`).join('')}</div>
        <p class="gmini"><b>Cómo se calibra:</b> los rangos son contiguos y no se traslapan: cada nivel empieza donde termina el anterior, desde $0 hasta el nivel 10, que no tiene tope. Se ajustaron con el valor de zona homogénea de Hacienda de los 801 remates (en dólares). El nivel de cada lote es el rango donde cae su valor de Hacienda; las reglas del sitio (frente a vía pública, agua, distancia a salud y escuela, zona urbana o rural) lo suben o bajan un nivel solo cuando apuntan claramente a otro (diferencia de 3 niveles o más). Así, en casi 8 de cada 10 lotes (77 %) el valor de Hacienda cae dentro del rango de su nivel.</p>

        <div class="gcard"><h4><span class="gi">${I.gavel}</span>Índice PlanoExacto (0 a 100)</h4><p class="gpara"><b>¿Para qué sirve?</b> Comparar remates entre sí con una nota general. Suma cuatro dimensiones con estos pesos:</p>
          <ul class="gkey">${PX.DIMS.map(d => `<li><span class="gk">${PX.W0[d.k]} %</span><span><b>${esc(d.n)}:</b> ${esc(d.d)}.</span></li>`).join('')}</ul><p class="gmini">Con ${P_} puedes cambiar los pesos al comparar.</p></div>
        <div class="gtable">
          <div><b>Valor de referencia</b><span>Terreno = área × valor de la zona homogénea. Construcción = m² × valor de la tipología ONT 2023 (Alcance 187, La Gaceta 178), con depreciación por edad (método de Ross) y estado de conservación (Heidecke). Por defecto se suponen 20 años y estado intermedio.</span></div>
          <div><b>Topografía</b><span>Pendiente media calculada con las curvas de nivel del IGN: <b>plana</b> menos de 5 %, <b>ondulada</b> 5 a 15 %, <b>quebrada</b> 15 a 30 %, <b>muy quebrada</b> más de 30 %.</span></div>
          <div><b>Precio por m²</b><span>Base vigente ÷ área (del catastro si existe, si no del edicto). La mediana por cantón usa al menos 3 remates.</span></div>
          <div><b>Ubicación exacta o aproximada</b><span><b>Exacta</b>: el plano o la finca se encontró en el catastro del Registro Inmobiliario. <b>Aproximada</b>: no se encontró y la cruz va al distrito o poblado del edicto.</span></div>
          <div><b>Zona marítimo terrestre</b><span>Franjas de 50 y 200 m trazadas desde la línea de costa del IGN. Es un cálculo propio, no el amojonamiento oficial.</span></div>
          <div><b>Tipo de cambio</b><span>Tipo de cambio de referencia de venta del BCCR del día de la actualización.</span></div>
        </div>`)}

      ${sec('fuentes', 'Origen de los datos', 'Toda la información viene de fuentes públicas. PlanoExactoCR la reúne, la cruza y le da estilo propio.',
        `<div class="gtable srctab">
          <div><b>Remates</b><span>Edictos del <b>Boletín Judicial</b> (Imprenta Nacional): fechas, bases, gravámenes y expediente. Se omiten nombres y cédulas.</span></div>
          <div><b>Catastro y planos</b><span><b>Registro Inmobiliario</b>, servicios del SNIT: predios, planos catastrados y vías públicas.</span></div>
          <div><b>Límites, ríos, curvas e infraestructura</b><span><b>Instituto Geográfico Nacional (IGN)</b>, SNIT: cantones y distritos, hidrografía y nombres de ríos, curvas de nivel, línea de costa, aeropuertos, aeródromos y muelles (escalas 1:5 000 a 1:200 000).</span></div>
          <div><b>Valor del terreno</b><span><b>Ministerio de Hacienda, Órgano de Normalización Técnica (ONT)</b>: zonas homogéneas y manual de tipologías constructivas 2023.</span></div>
          <div><b>Agua potable</b><span><b>AyA</b>: áreas de cobertura del AyA, la ESPH, las ASADAS y los acueductos municipales.</span></div>
          <div><b>Planes reguladores</b><span><b>INVU</b>: estado y año de publicación de cada plan regulador.</span></div>
          <div><b>Ambiente</b><span><b>MINAE</b>: mapa agropecuario y forestal 2020 y zonas de vida (CENIGA). <b>FONAFIFO</b>: pago por servicios ambientales 2025. Franjas de protección de ríos: PNUD-TEVU (referencia no oficial).</span></div>
          <div><b>Salud y educación</b><span><b>CCSS</b>: EBAIS, áreas de salud y hospitales. Escuelas y colegios: puntos de interés del <b>IGN</b>.</span></div>
          <div><b>Tipo de cambio</b><span><b>Banco Central de Costa Rica (BCCR)</b>.</span></div>
          <div><b>Mapas base</b><span>Esri (claro, calles, relieve, oscuro y ortofoto de Maxar y Earthstar Geographics), OpenStreetMap y OpenTopoMap.</span></div>
        </div>
        <p class="gmini">Cada fuente tiene su propia escala y fecha de actualización. Puede haber diferencias entre capas; ante cualquier duda, la fuente oficial manda.</p>`)}

      ${sec('gloss', 'Palabras clave', '',
        `<div class="gtable">
          <div><b>Base</b><span>Precio mínimo para ofertar. Baja en cada remate: 100 %, 75 % y 25 %.</span></div>
          <div><b>Zona homogénea</b><span>Zona donde Hacienda fija un mismo valor del terreno por m².</span></div>
          <div><b>Escala PECR (PlanoExactoCR)</b><span>Nota del 1 al 10: 1 es campo aislado sin servicios y 10 es una centralidad urbana de alto valor. Cada nivel trae un rango de precio por m².</span></div>
          <div><b>Índice PlanoExacto</b><span>Nota de 0 a 100 que resume precio, situación legal, servicios y entorno.</span></div>
          <div><b>IPH</b><span>Índice Puja/Hacienda: en qué porcentaje del valor de Hacienda arranca la puja. 50 = a la mitad.</span></div>
          <div><b>Ubicación aproximada</b><span>Cuando no encontramos el plano exacto, la cruz va al centro del distrito o poblado. La ficha lo indica.</span></div>
          <div><b>ZMT</b><span>Zona marítimo terrestre: los 200 m desde la playa. Los primeros 50 m son públicos.</span></div>
        </div>
        <p class="muted">Recuerda: todo es información orientativa. Antes de ofertar, revisa el expediente judicial y consulta con un abogado. Ver <button class="linkbtn" data-about="terms">Términos y descargo</button>.</p>`)}
    </div>`;
  }
  function about() {
    const us = `<div class="about">
      <img class="lg-claro" src="assets/img/logo.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="463" style="width:220px;height:auto"><img class="lg-oscuro" src="assets/img/logo-oscuro.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="463" style="width:220px;height:auto">
      <p><b>PlanoExactoCR</b> reúne en un solo mapa los remates judiciales de propiedades de Costa Rica y los cruza con la información pública que normalmente está dispersa: catastro, planes reguladores, zonas homogéneas de Hacienda, agua potable, ríos, relieve, cobertura del suelo, salud, escuelas y normativa.</p>
      <h3>Quiénes somos</h3>
      <p>Somos un equipo de profesionales en urbanismo, arquitectura y planificación territorial con experiencia en planes reguladores, sistemas de información geográfica y gestión municipal en distintos cantones del país. Creamos PlanoExactoCR para que cualquier persona pueda <b>ubicar</b> un lote con precisión, <b>comprender</b> su contexto territorial y legal, y <b>decidir</b> con más información antes de participar en un remate.</p>
      <h3>Qué hacemos</h3>
      <ul><li>Leemos el Boletín Judicial y ubicamos cada propiedad por su plano o su finca en el catastro.</li><li>Calculamos un índice orientativo con sanidad jurídica, precio por m², servicios y restricciones.</li><li>Preparamos expedientes por lote con mapa, variables del sitio, potencialidades y riesgos.</li></ul>
      <h3>Lo que viene</h3>
      <ul><li>Propiedades curadas en venta, revisadas por nuestro equipo.</li><li>Amenazas naturales, historia del sitio con ortofotos del IGN y normativa por zona de cada plan regulador.</li><li>Cobertura en Panamá y otros países de Latinoamérica.</li></ul>
      <p class="muted">Contacto: <i>por definir</i>.</p></div>`;
    const terms = `<div class="about">
      <h3>Términos de uso y descargo de responsabilidad</h3>
      <p>Al usar PlanoExactoCR usted acepta lo siguiente:</p>
      <ul>
        <li><b>Naturaleza de la información.</b> Todo el contenido (mapas, fichas, índices, escalas de valor, expedientes y herramientas) es un <b>compendio de información pública</b> y un <b>análisis orientativo</b> generado en buena parte de forma automática. No es un certificado de uso de suelo, una certificación registral o catastral, un avalúo, un estudio de título, un dictamen técnico ni asesoría legal, financiera o de inversión.</li>
        <li><b>Fuentes de terceros.</b> Los datos provienen del Boletín Judicial, el Registro Inmobiliario, el IGN, el INVU, el Ministerio de Hacienda, el AyA, el MINAE, la CCSS, el BCCR y otros servicios públicos. Pueden contener errores, omisiones, desactualizaciones o diferencias de escala que no dependen de PlanoExactoCR. La ubicación de un predio puede ser aproximada.</li>
        <li><b>Verificación obligatoria.</b> Antes de ofertar, comprar o tomar cualquier decisión, usted debe verificar por su cuenta la información en el expediente judicial, el Registro Nacional, la municipalidad y con profesionales habilitados (abogado, topógrafo, perito valuador).</li>
        <li><b>Limitación de responsabilidad.</b> PlanoExactoCR, sus creadores, colaboradores y proveedores no asumen responsabilidad alguna por daños, pérdidas, costos o perjuicios directos o indirectos derivados del uso o la imposibilidad de uso del sitio, ni de decisiones tomadas con base en su contenido. El uso es bajo su propio riesgo.</li>
        <li><b>Sin relación con el proceso judicial.</b> PlanoExactoCR no participa en los remates, no representa a ninguna parte, juzgado, banco ni acreedor, y no garantiza fechas, bases, condiciones ni el resultado de ningún proceso.</li>
        <li><b>Datos personales.</b> Se omiten los nombres de personas deudoras y los números de cédula de los edictos. No se debe usar el sitio para identificar o contactar a personas.</li>
        <li><b>Valores de referencia.</b> Las zonas homogéneas, tipologías constructivas, escalas PECR, medianas y prefactibilidades son referencias estadísticas y supuestos editables, no valores de mercado ni avalúos.</li>
        <li><b>Cambios.</b> El contenido, los precios y estos términos pueden cambiar sin previo aviso. En la etapa de prueba, las cuentas y los pagos funcionan en modo demostración.</li>
      </ul>
      <p class="muted">Última actualización: ${PX.fdate(PX.now)}. Este texto debe ser revisado por un abogado antes del lanzamiento comercial.</p></div>`;
    return { us, terms };
  }
  window.PX_GUIA = { guia: guideHTML, us: () => about().us, terms: () => about().terms };
})();
