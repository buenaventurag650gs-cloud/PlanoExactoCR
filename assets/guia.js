/* PlanoExactoCR — guía completa, metodología, términos y «quiénes somos».
   El servidor entrega este archivo solo a quien entra con su cuenta; los visitantes reciben una versión corta. */
(function () {
  'use strict';
  const { esc, fnum } = PX;
  function guideHTML() {
    const I = PX.ICON, cupo = PX.PRECIOS.semanalEsencial, P_ = PX.PRO, E_ = PX.ESE;
    const vivos = (PX.R || []).filter(r => r.st >= 0).length;
    // Bloques didácticos: tarjeta con «para qué sirve», pasos numerados y un ejemplo
    const steps = arr => `<ol class="gsteps">${arr.map(t => `<li><span>${t}</span></li>`).join('')}</ol>`;
    const card = (ic, t, plan, para, pasos, ej) => `<div class="gcard"><h4><span class="gi">${ic || ''}</span>${t}${plan ? ' ' + plan : ''}</h4>
      <p class="gpara">${para}</p>${pasos ? `<div class="glbl">Cómo se usa</div>${steps(pasos)}` : ''}${ej ? `<p class="gej"><b>Ejemplo:</b> ${ej}</p>` : ''}</div>`;
    const tip = t => `<p class="gtip"><b>Consejo</b> ${t}</p>`;
    const sec = (id, t, intro, body) => `<section class="gsec" id="g-${id}"><h3>${t}</h3>${intro ? `<p class="gintro">${intro}</p>` : ''}${body}</section>`;
    const toc = [['inicio', 'En 5 pasos'], ['mapa', 'El mapa'], ['buscar', 'Buscar y filtrar'], ['ficha', 'La ficha'], ['herr', 'Herramientas'], ['exp', 'Expediente'], ['met', 'Índices y metodología'], ['fuentes', 'Fuentes'], ['gloss', 'Glosario']];
    const flow = [[I.pin, 'Ubica', 'Cada punto del mapa es una propiedad en remate.'], [I.list, 'Filtra', 'Por zona, base, tamaño o tipo.'], [I.Lote, 'Abre la ficha', 'Con un clic en el punto o en la lista.'], [I.valor, 'Analiza', 'Valor, potencial, números y riesgos.'], [I.gavel, 'Verifica', 'Genera el expediente y revísalo con tu abogado.']];
    return `<div class="about guide">
      <nav class="gtoc" aria-label="Contenido">${toc.map(([k, t]) => `<button class="chip" data-gto="${k}">${t}</button>`).join('')}</nav>

      ${sec('inicio', 'PlanoExactoCR en 5 pasos', 'PlanoExactoCR ubica en un mapa las propiedades que salen a remate judicial en Costa Rica y reúne lo que conviene saber de cada una antes de ofertar.',
        `<div class="gflow">${flow.map(([ic, t, d], i) => `<div class="gstep"><span class="gn">${i + 1}</span><span class="gi">${ic}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
        ${tip('Los montos salen en colones o en dólares según el botón ₡ / $ de arriba a la derecha. Debajo siempre aparece el equivalente en la otra moneda.')}`)}

      ${sec('mapa', 'Cómo leer el mapa', '',
        `<div class="ggrid">
          <div class="gcard"><h4>Puntos y colores</h4><p class="gpara">El color indica en qué remate va la propiedad. En cada etapa baja la <b>base</b>, el precio mínimo para ofertar.</p>
            <ul class="gkey"><li>${PX.stageBadge(0, true)} <span><b>Primer remate</b>: base completa</span></li><li>${PX.stageBadge(1, true)} <span><b>Segundo remate</b>: 75 % de la base</span></li><li>${PX.stageBadge(2, true)} <span><b>Tercer remate</b>: 25 % de la base</span></li></ul>
            <p class="gpara">De lejos, los remates cercanos se agrupan en un círculo con el número de propiedades; al acercarte se separan. El punto con borde punteado indica una ubicación aproximada. Desde el nivel 15 se dibuja el predio según el catastro.</p></div>
          <div class="gcard"><h4>Moverte por el mapa</h4><ul class="gkey">
            <li><span class="gk">+ / −</span><span>Acerca o aleja. El número es el nivel de zoom: en <b>8</b> ves el país; desde <b>17</b>, el lote y la calle.</span></li>
            <li><span class="gk">Mouse</span><span>Al pasarlo, indica en qué distrito y cantón estás.</span></li>
            <li><span class="gk">Clic</span><span>Sobre el mapa, muestra los datos de las capas encendidas en ese punto. Doble clic sobre una propiedad acerca hasta su predio.</span></li></ul></div>
        </div>
        ${card(I.entorno, 'Capas', '', 'Las capas agregan información encima del mapa: valor del terreno, agua potable, ríos, relieve y más.',
          ['Pulsa <b>Capas</b>, arriba a la izquierda.', 'Abre un grupo, por ejemplo <b>Valor y mercado</b>.', 'Marca la capa que quieras ver; desmárcala para quitarla.'],
          'enciende <b>Zonas homogéneas de Hacienda</b> y acércate a una ciudad: verás el valor del m² de terreno en cada zona, en colones y dólares.')}
        <p class="gmini">Con la cuenta gratis: mapas base, límites, catastro, nombres de ríos y estado del plan regulador. Con ${P_}: además, valor del terreno, precios por m², agua potable, vías, puertos y aeropuertos, salud, zonas de vida, uso del suelo, curvas de nivel, áreas protegidas y zona marítimo terrestre.</p>`)}

      ${sec('buscar', 'Buscar y filtrar', `Hoy hay ${vivos ? fnum(vivos) : 'cientos de'} remates vigentes. Con los filtros te quedas solo con los que te sirven.`,
        `${card(I.list, 'Filtros', '', 'Están en la columna de la izquierda y se combinan entre sí.',
          ['En <b>Ubicación</b>, escribe un lugar o elige provincia y cantón.', 'En <b>Remate</b>, elige la etapa, las fechas y la base máxima que estás dispuesto a pagar.', 'En <b>Características</b>, elige el tipo (lote, con construcción, agrícola o filial) y el tamaño en m².'],
          'lotes en Guanacaste de 500 a 2.000 m² con base menor a ₡20 millones.')}
        <div class="ggrid">
          <div class="gcard"><h4>Botones útiles</h4><ul class="gkey">
            <li><span class="gk">Restablecer</span><span>Quita todos los filtros y devuelve el mapa a la vista inicial.</span></li>
            <li><span class="gk">Favoritos</span><span>Muestra solo los que marcaste con ♥.</span></li>
            <li><span class="gk">Calendario</span><span>Ordena los remates por día; los de <b>mañana</b> salen resaltados.</span></li>
            <li><span class="gk">Guardar búsqueda</span><span>Guarda la combinación de filtros para usarla otra vez.</span></li></ul></div>
          ${card(I.registro, 'Buscar un plano', '', 'Sirve para consultar cualquier terreno del país, esté o no en remate.', ['Abre la pestaña <b>Buscar plano</b>.', 'Escribe el número de plano (por ejemplo, P-1311611-2008) o el de finca.', 'Pulsa <b>Buscar en el catastro</b> y luego <b>Ver en el mapa</b>.'], '')}
        </div>
        ${tip(`Con ${P_} hay filtros por <b>atributos del lote</b>: terreno plano, con construcción, frente a calle pública, zona urbana y otros.`)}`)}

      ${sec('ficha', 'La ficha de cada propiedad', 'La ficha se abre a la derecha y va de lo básico a lo detallado: primero cuánto cuesta y cuándo se remata, después el terreno y su entorno, y al final el expediente.',
        `<div class="gtable">
          <div><b>Remate</b><span>Base vigente y fechas de los tres remates.</span></div>
          <div><b>Terreno</b><span>Área, forma del predio, topografía y uso actual del suelo.</span></div>
          <div><b>Normativa</b><span>Qué plan regulador aplica o, si el cantón no tiene, las normas nacionales del INVU.</span></div>
          <div><b>Registro y ubicación</b> ${E_}<span>Número de finca y plano, servidumbres citadas y qué tan exacta es la ubicación.</span></div>
          <div><b>Servicios y entorno</b> ${E_}<span>Agua potable, calle, salud, escuela, ríos y costa.</span></div>
          <div><b>Valor y mercado</b> ${P_}<span>Valor según Hacienda, <b>Índice Puja/Hacienda</b>, <b>escala PECR</b>, <b>Índice PlanoExacto</b> y atributos del lote.</span></div>
        </div>
        ${tip('<b>Favorito</b> marca la propiedad, <b>Seguir</b> te avisa de cambios, <b>Comparar</b> la pone junto a otras y <b>Compartir</b> copia el enlace.')}`)}

      ${sec('herr', 'Herramientas', 'Responden las preguntas que se hace cualquier comprador. Se abren desde el recuadro <b>Herramientas</b> de la ficha. Todos los supuestos se pueden cambiar y el resultado se recalcula al escribir.',
        `<div class="ggrid">
        ${card(I.valor, '¿Cuánto vale?', P_, '<b>Valor de referencia.</b> Estima el valor del terreno y la construcción para comparar la base contra algo concreto.',
          ['Revisa el área y el valor de zona homogénea, que ya vienen llenos.', 'Si hay casa, ajusta el área construida, la tipología, la edad y el estado.', 'Lee el resultado <b>Base frente a referencia</b>.'],
          'un <b>60 %</b> significa que la base es un 40 % menor que el valor de referencia.')}
        ${card(I.Lote, '¿Cuánto puedo construir?', P_, '<b>Potencial constructivo.</b> Calcula los m² construibles y cuántas unidades o lotes cabrían.',
          ['Ajusta la cobertura (qué parte del lote puede ocupar el edificio) y el número de pisos.', 'Indica el tamaño de cada unidad, por ejemplo 80 m².', 'Lee cuántas unidades caben y cuántos lotes saldrían si se segrega.'], '')}
        ${card(I.valor, '¿Es buen negocio?', P_, '<b>Prefactibilidad financiera.</b> Suma lo que invertirías, resta lo que recibirías al vender y muestra la ganancia o la pérdida, paso por paso.',
          ['Elige <b>comprar y revender</b> el terreno o <b>construir y vender</b>.', 'Escribe tu oferta y revisa los gastos de traspaso, timbres y honorarios.', 'Lee el resultado y la tabla <b>Cómo se calcula</b>.'],
          'si la herramienta dice que para no perder tendrías que vender en ₡16 millones o más, ese es tu <b>punto de equilibrio</b>.')}
        ${card(I.norma, '¿Qué puede salir mal?', E_, '<b>Riesgos del proceso.</b> Lista los problemas posibles de la propiedad y lo que conviene revisar antes de ofertar.', '', 'hipotecas que siguen vigentes, servidumbres, ocupantes en la casa o restricciones ambientales.')}
        </div>
        <div class="gtable">
          <div><b>Alertas</b> ${E_}<span>Avisos por correo o WhatsApp cuando un remate que sigues cambia de fecha o etapa, o cuando sale uno nuevo que cumple una búsqueda guardada. El envío se activa en la siguiente fase.</span></div>
          <div><b>Mapa de precios</b> ${P_}<span>Pinta cada cantón según la mediana del precio por m² de sus remates.</span></div>
          <div><b>Top 10 del mes</b> ${P_}<span>Los remates mejor calificados de cada provincia.</span></div>
          <div><b>Comparar</b><span>Con la cuenta gratis comparas 2 propiedades; con ${P_}, hasta 4, y decides cuánto pesa cada criterio.</span></div>
        </div>`)}

      ${sec('exp', 'El expediente en PDF', 'Un informe de cuatro hojas sobre una propiedad, para imprimir, guardar o llevarle a tu abogado.',
        `<div class="gflow g4">${[['Mapa', 'El lote, su entorno y la vista satelital.'], ['Ficha', 'Fechas, registro, valor y análisis.'], ['Normativa y riesgos', 'Qué se puede hacer y qué hay que revisar.'], ['Edicto', 'El texto oficial del remate.']].map(([t, d], i) => `<div class="gstep"><span class="gn">${i + 1}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
        <p class="gmini">Se genera con el botón <b>Generar expediente</b> de la ficha. La cuenta gratis incluye ${PX.PRECIOS.semanal} por semana; Esencial, ${cupo}; ${P_}, sin límite. Fuera de eso, cada expediente adicional cuesta ${PX.mt(PX.PRECIOS.expediente, 'CRC')}.</p>`)}

      ${sec('met', 'Índices y metodología', 'Así se calcula cada número de la ficha y del expediente. Sirven para comparar propiedades entre sí; ninguno es un avalúo.',
        `${card(I.valor, 'Índice Puja/Hacienda (IPH)', '', 'Dice en un número si la base con que arranca la puja es baja o alta frente al valor que Hacienda le asigna a la propiedad.',
          ['Se toma la <b>base vigente</b>: el precio con que arranca la puja en el próximo remate.', 'Se calcula el <b>valor según Hacienda</b>: área × valor de la zona homogénea. Si hay casa, se suma la construcción estimada con el manual de tipologías de la ONT.', '<b>IPH = base vigente ÷ valor según Hacienda × 100.</b>'],
          'un IPH de <b>45</b> significa que la puja arranca en el 45 % del valor de Hacienda. En cada etapa del remate la base baja y el índice también; la ficha muestra el IPH de los tres remates.')}
        <div class="gtable">${PX.IPH.map((b, i) => `<div><b><span class="iphdot" style="--c:${b[2]}"></span>${i ? 'de ' + PX.IPH[i - 1][0] + ' ' : 'menos de '}${b[0] === Infinity ? 'o más' : (i ? 'a ' : '') + b[0]}</b><span><b>${b[1]}.</b> ${b[3]}</span></div>`).join('')}</div>
        <p class="gmini">${PX.iphBar(45)}</p>
        ${tip('Los valores de Hacienda suelen quedar por debajo del mercado, así que un IPH bajo es una buena señal. Pero un IPH muy bajo, de menos de 10, también puede indicar que se remata solo una parte de la finca (derechos) o que el área del edicto no coincide con la del catastro. La ficha lo advierte cuando lo detecta.')}

        ${card(I.entorno, 'Escala PECR (niveles 1 a 10)', '', 'Ubica el lote en una escala de valor según su acceso, servicios y entorno. Cada nivel trae un rango orientativo de precio por m².', '', '')}
        <div class="gtable pecrtab">${PX.PECR.map(x => `<div><b><span class="pn">${x[0]}</span><span class="pico">${PX.PECR_ICON[x[0] - 1]}</span>${PX.pecrRango(x)}</b><span>${esc(x[1])}</span></div>`).join('')}</div>
        <p class="gmini"><b>Cómo se calibra.</b> El nivel de cada lote es el rango en que cae su valor de zona homogénea de Hacienda, convertido a dólares. Los rangos van seguidos, sin huecos ni traslapes: cada nivel empieza donde termina el anterior, desde $0, y el nivel 10 no tiene tope. Después se revisan las condiciones del sitio (frente a vía pública, agua, distancia a salud y escuela, zona urbana o rural). Si apuntan claramente a otro nivel, a 3 niveles o más de distancia, el lote sube o baja un nivel; si no, se queda donde está. Los rangos se ajustaron con los 801 remates que había al calibrar la escala, y con ellos el valor de Hacienda cae dentro del rango de su nivel en casi 8 de cada 10 lotes (77 %).</p>

        <div class="gcard"><h4><span class="gi">${I.gavel}</span>Índice PlanoExacto (0 a 100)</h4><p class="gpara">Una nota general para comparar remates. Combina cuatro dimensiones con estos pesos:</p>
          <ul class="gkey">${PX.DIMS.map(d => `<li><span class="gk">${PX.W0[d.k]} %</span><span><b>${esc(d.n)}:</b> ${esc(d.d)}.</span></li>`).join('')}</ul><p class="gmini">Con ${P_} puedes cambiar los pesos al comparar.</p></div>
        <div class="gtable">
          <div><b>Valor de referencia</b><span>Terreno: área × valor de la zona homogénea. Construcción: m² × valor de la tipología ONT 2023 (Alcance 187, La Gaceta 178), depreciada por edad (método de Ross) y por estado de conservación (Heidecke). Si no se indica otra cosa, se suponen 20 años y estado intermedio.</span></div>
          <div><b>Topografía</b><span>Pendiente media calculada con las curvas de nivel del IGN: <b>plana</b>, menos de 5 %; <b>ondulada</b>, de 5 a 15 %; <b>quebrada</b>, de 15 a 30 %; <b>muy quebrada</b>, más de 30 %.</span></div>
          <div><b>Precio por m²</b><span>Base vigente ÷ área, tomada del catastro si existe y, si no, del edicto. La mediana de un cantón solo se calcula con 3 remates o más.</span></div>
          <div><b>Ubicación exacta o aproximada</b><span><b>Exacta</b>: el plano o la finca aparece en el catastro del Registro Inmobiliario. <b>Aproximada</b>: no aparece, y el punto se coloca en el distrito o poblado que cita el edicto.</span></div>
          <div><b>Zona marítimo terrestre</b><span>Franjas de 50 y 200 m trazadas desde la línea de costa del IGN. Es un cálculo propio, no el amojonamiento oficial.</span></div>
          <div><b>Tipo de cambio</b><span>Tipo de cambio de referencia de venta del BCCR el día de la actualización.</span></div>
        </div>`)}

      ${sec('fuentes', 'De dónde salen los datos', 'Todo viene de fuentes públicas. PlanoExactoCR las reúne, las cruza y las presenta en un mismo lugar.',
        `<div class="gtable srctab">
          <div><b>Remates</b><span>Edictos del <b>Boletín Judicial</b> (Imprenta Nacional): fechas, bases, gravámenes y expediente. Se omiten nombres y cédulas.</span></div>
          <div><b>Catastro y planos</b><span><b>Registro Inmobiliario</b>, servicios del SNIT: predios, planos catastrados y vías públicas.</span></div>
          <div><b>Límites, ríos, curvas e infraestructura</b><span><b>Instituto Geográfico Nacional (IGN)</b>, SNIT: cantones y distritos, ríos y sus nombres, curvas de nivel, línea de costa, aeropuertos, aeródromos y muelles (escalas de 1:5.000 a 1:200.000).</span></div>
          <div><b>Valor del terreno</b><span><b>Ministerio de Hacienda, Órgano de Normalización Técnica (ONT)</b>: zonas homogéneas y manual de tipologías constructivas 2023.</span></div>
          <div><b>Agua potable</b><span><b>AyA</b>: áreas de cobertura del AyA, la ESPH, las ASADAS y los acueductos municipales.</span></div>
          <div><b>Planes reguladores</b><span><b>INVU</b>: estado y año de publicación de cada plan regulador.</span></div>
          <div><b>Ambiente</b><span><b>MINAE</b>: mapa agropecuario y forestal 2020 y zonas de vida (CENIGA). <b>FONAFIFO</b>: pago por servicios ambientales 2025. Franjas de protección de ríos: PNUD-TEVU, como referencia no oficial.</span></div>
          <div><b>Salud y educación</b><span><b>CCSS</b>: EBAIS, áreas de salud y hospitales. Escuelas y colegios: puntos de interés del <b>IGN</b>.</span></div>
          <div><b>Tipo de cambio</b><span><b>Banco Central de Costa Rica (BCCR)</b>.</span></div>
          <div><b>Mapas base</b><span>Esri (claro, calles, relieve, oscuro y ortofoto de Maxar y Earthstar Geographics), OpenStreetMap y OpenTopoMap.</span></div>
        </div>
        <p class="gmini">Cada fuente tiene su escala y su fecha de actualización, así que dos capas pueden no coincidir del todo. Ante la duda, manda la fuente oficial.</p>`)}

      ${sec('gloss', 'Glosario', '',
        `<div class="gtable">
          <div><b>Base</b><span>Precio mínimo para ofertar. Es el 100 % en el primer remate, el 75 % en el segundo y el 25 % en el tercero.</span></div>
          <div><b>Zona homogénea</b><span>Zona a la que Hacienda le asigna un mismo valor de terreno por m².</span></div>
          <div><b>Escala PECR</b><span>Nivel del 1 al 10: el 1 es campo aislado sin servicios y el 10, una centralidad urbana de alto valor. Cada nivel tiene un rango de precio por m².</span></div>
          <div><b>Índice PlanoExacto</b><span>Nota de 0 a 100 que resume situación legal, precio, servicios y restricciones.</span></div>
          <div><b>IPH</b><span>Índice Puja/Hacienda: el porcentaje del valor de Hacienda en que arranca la puja. Un 50 es la mitad.</span></div>
          <div><b>Ubicación aproximada</b><span>Cuando el plano o la finca no aparecen en el catastro, el punto va al centro del distrito o poblado. La ficha lo indica.</span></div>
          <div><b>ZMT</b><span>Zona marítimo terrestre: franja de 200 m medida desde la pleamar ordinaria. Los primeros 50 m son zona pública.</span></div>
        </div>
        <p class="muted">Todo lo que ves aquí es orientativo. Antes de ofertar, revisa el expediente judicial y consulta con un abogado. Más detalle en <button class="linkbtn" data-about="terms">Términos y descargo</button>.</p>`)}
    </div>`;
  }
  function about() {
    const us = `<div class="about">
      <img class="lg-claro" src="assets/img/logo.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="463" style="width:220px;height:auto"><img class="lg-oscuro" src="assets/img/logo-oscuro.webp" alt="PlanoExactoCR · Ubica, comprende, decide" width="900" height="463" style="width:220px;height:auto">
      <p><b>PlanoExactoCR</b> ubica en un mapa los remates judiciales de propiedades de Costa Rica y los cruza con información pública que normalmente hay que buscar en muchos sitios distintos: catastro, planes reguladores, zonas homogéneas de Hacienda, agua potable, ríos, relieve, cobertura del suelo, salud, escuelas y normativa.</p>
      <h3>Quiénes somos</h3>
      <p>Somos profesionales en urbanismo, arquitectura y planificación territorial. Trabajamos en planes reguladores, sistemas de información geográfica y gestión municipal en distintos cantones del país. Hicimos PlanoExactoCR para que cualquier persona pueda <b>ubicar</b> un lote con precisión, <b>comprender</b> su contexto territorial y legal, y <b>decidir</b> con mejor información antes de participar en un remate.</p>
      <h3>Qué hacemos</h3>
      <ul><li>Leemos el Boletín Judicial y ubicamos cada propiedad en el catastro por su plano o su finca.</li><li>Calculamos índices orientativos de situación legal, precio por m², servicios y restricciones.</li><li>Preparamos un expediente por lote con mapa, condiciones del sitio, potencial y riesgos.</li></ul>
      <h3>En qué estamos trabajando</h3>
      <ul><li>Propiedades en venta revisadas por nuestro equipo.</li><li>Amenazas naturales, historia del sitio con ortofotos del IGN y normativa por zona de cada plan regulador.</li><li>Cobertura en Panamá y otros países de Latinoamérica.</li></ul>
      <p class="muted">Contacto: <a href="mailto:hola@planoexactocr.com">hola@planoexactocr.com</a></p></div>`;
    const terms = `<div class="about">
      <h3>Términos de uso y descargo de responsabilidad</h3>
      <p>Al usar PlanoExactoCR aceptas estas condiciones:</p>
      <ul>
        <li><b>Qué es la información.</b> Todo el contenido (mapas, fichas, índices, escalas de valor, expedientes y herramientas) es un <b>compendio de información pública</b> con un <b>análisis orientativo</b>, generado en buena parte de forma automática. No es un certificado de uso de suelo, una certificación registral o catastral, un avalúo, un estudio de título, un dictamen técnico ni asesoría legal, financiera o de inversión.</li>
        <li><b>Fuentes de terceros.</b> Los datos vienen del Boletín Judicial, el Registro Inmobiliario, el IGN, el INVU, el Ministerio de Hacienda, el AyA, el MINAE, la CCSS, el BCCR y otros servicios públicos. Pueden tener errores, omisiones, desactualizaciones o diferencias de escala que no dependen de PlanoExactoCR. La ubicación de un predio puede ser aproximada.</li>
        <li><b>Verificación.</b> Antes de ofertar, comprar o tomar cualquier decisión, verifica la información en el expediente judicial, el Registro Nacional y la municipalidad, y con profesionales habilitados: abogado, topógrafo o perito valuador.</li>
        <li><b>Responsabilidad.</b> PlanoExactoCR, sus creadores, colaboradores y proveedores no responden por daños, pérdidas, costos o perjuicios, directos o indirectos, derivados del uso del sitio o de no poder usarlo, ni por decisiones tomadas con base en su contenido. Usas el sitio bajo tu propio riesgo.</li>
        <li><b>Relación con los remates.</b> PlanoExactoCR no participa en los remates ni representa a ninguna parte, juzgado, banco o acreedor, y no garantiza fechas, bases, condiciones ni el resultado de ningún proceso.</li>
        <li><b>Datos personales.</b> Se omiten los nombres de las personas deudoras y los números de cédula de los edictos. El sitio no debe usarse para identificar ni contactar a personas.</li>
        <li><b>Valores de referencia.</b> Las zonas homogéneas, las tipologías constructivas, la escala PECR, las medianas y las prefactibilidades son referencias estadísticas y supuestos editables, no valores de mercado ni avalúos.</li>
        <li><b>Cambios.</b> El contenido, los precios y estos términos pueden cambiar sin previo aviso.</li>
      </ul>
      <p class="muted">Última actualización: ${PX.fdate(PX.now)}. Este texto será revisado por un abogado antes del lanzamiento comercial.</p></div>`;
    return { us, terms };
  }
  window.PX_GUIA = { guia: guideHTML, us: () => about().us, terms: () => about().terms };
})();
