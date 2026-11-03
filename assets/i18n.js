/* PlanoExactoCR — Internacionalización ES/EN
 *
 * Estrategia: un walker recorre todos los text-nodes del DOM y, cuando el idioma
 * activo es EN, los sustituye por su traducción si existe en el diccionario.
 * Un MutationObserver atrapa cualquier contenido que las páginas (en especial
 * app.js) agreguen después del render inicial, de modo que no hay que envolver
 * las ~300 strings de la app en una función t() — basta con poblar el DICT.
 *
 * Al cambiar de idioma se recarga la página: evita problemas de estado y de
 * strings dinámicas que ya se renderizaron.
 *
 * Para strings con partes variables (fechas, cantidades, nombres propios) la
 * traducción es parcial — si no hay match exacto, el texto queda igual. Esos
 * casos se agregan uno a uno al diccionario cuando valga la pena.
 *
 * Qué NO se traduce (decisión de producto):
 *   - Nombres de instituciones: AyA, ARESEP, MINAE, SNIT, IGN, Hacienda, INEC…
 *   - Lugares (provincias, cantones, distritos) — son nombres propios
 *   - Moneda y formato numérico (siempre CRC/USD con separador europeo)
 *   - Términos legales del Poder Judicial de CR: remate, apremio, mejor postor…
 */
(() => {
  'use strict';
  const W = window; W.PX = W.PX || {};
  // Store propio para no depender de core.js (inicio.html no lo carga)
  const S = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  PX.lang = (S.get('px-lang') === 'en') ? 'en' : 'es';
  PX.DICT = PX.DICT || {}; // ES → EN. Poblado al final de este archivo.

  // Devuelve la traducción de s si existe; permite reemplazar {x} con params[x]
  PX.t = (s, params) => {
    if (s == null) return s;
    const key = (typeof s === 'string') ? s.trim() : s;
    let out = (PX.lang === 'en' && PX.DICT[key]) ? PX.DICT[key] : s;
    if (params && typeof out === 'string') {
      for (const k in params) out = out.split('{' + k + '}').join(params[k]);
    }
    return out;
  };

  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, TEMPLATE: 1 };
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];

  function translateTextNode(n) {
    const raw = n.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const tr = PX.DICT[trimmed];
    if (tr) n.nodeValue = raw.replace(trimmed, tr);
  }

  function translateAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      const tr = PX.DICT[trimmed];
      if (tr) el.setAttribute(a, v.replace(trimmed, tr));
    }
  }

  function walk(root) {
    if (!root || PX.lang === 'es') return;
    if (root.nodeType === 3 /* text */) {
      const p = root.parentNode;
      if (p && SKIP_TAGS[p.tagName]) return;
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 /* element */) return;
    if (SKIP_TAGS[root.tagName]) return;
    // Elementos con data-i18n-skip no se traducen (ej. códigos, cupones)
    if (root.hasAttribute('data-i18n-skip')) return;
    translateAttrs(root);
    for (let i = 0; i < root.childNodes.length; i++) walk(root.childNodes[i]);
  }

  PX.applyLang = () => {
    document.documentElement.lang = PX.lang;
    if (document.body) walk(document.body);
    // También el <title> y <meta description/og:*> si tienen traducción
    if (document.title && PX.DICT[document.title.trim()]) {
      document.title = PX.DICT[document.title.trim()];
    }
    document.querySelectorAll('meta[name="description"], meta[property^="og:"]').forEach(m => {
      const c = m.getAttribute('content'); if (!c) return;
      const tr = PX.DICT[c.trim()]; if (tr) m.setAttribute('content', tr);
    });
  };

  PX.setLang = (l) => {
    const nl = (l === 'en') ? 'en' : 'es';
    if (nl === PX.lang) return;
    S.set('px-lang', nl);
    // Recarga la página: evita re-renderizar manualmente todo el estado dinámico
    location.reload();
  };

  function startObserver() {
    if (!W.MutationObserver || !document.body) return;
    const obs = new MutationObserver(muts => {
      if (PX.lang === 'es') return;
      for (const m of muts) {
        if (m.type === 'childList') {
          for (let i = 0; i < m.addedNodes.length; i++) walk(m.addedNodes[i]);
        } else if (m.type === 'characterData') {
          translateTextNode(m.target);
        } else if (m.type === 'attributes') {
          if (m.target && m.target.nodeType === 1) translateAttrs(m.target);
        }
      }
    });
    obs.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
    PX._i18nObs = obs;
  }

  // Si core.js definió los arrays de meses/días en español, los sustituyo
  // antes de que app.js empiece a formatear fechas. En inicio.html estos
  // arrays no existen (core.js no se carga allí) y este bloque es nop.
  if (PX.lang === 'en') {
    if (PX.MES) PX.MES.splice(0, 12, 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec');
    if (PX.MESL) PX.MESL.splice(0, 12, 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December');
    if (PX.DIA) PX.DIA.splice(0, 7, 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat');
  }

  function init() { PX.applyLang(); startObserver(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ==========================================================================
  // DICCIONARIO
  // Formato: 'texto en español exacto (ya recortado)': 'english translation'
  // No incluir aquí nombres de instituciones, lugares, ni términos legales
  // específicos del Poder Judicial de CR (ver cabecera).
  // ==========================================================================
  Object.assign(PX.DICT, {
    // ---- META / cabecera comunes ----
    'PlanoExactoCR · Remates judiciales en el mapa': 'PlanoExactoCR · Judicial auctions on the map',
    'Los remates judiciales de propiedades de Costa Rica, ubicados en el mapa y cruzados con catastro, plan regulador, valor de Hacienda, agua y entorno.': 'Costa Rica’s judicial property auctions, placed on the map and cross-referenced with the cadastre, zoning plan, Hacienda land value, water coverage and surroundings.',
    'Cada día hábil leemos el Boletín Judicial, ubicamos cada propiedad en el catastro y reunimos lo que conviene saber antes de ofertar.': 'Every business day we read the Judicial Gazette, locate each property on the cadastre and gather what’s worth knowing before bidding.',
    'Ubica · Comprende · Decide': 'Locate · Understand · Decide',
    'Mapa de remates judiciales de Costa Rica · PlanoExactoCR': 'Map of judicial auctions in Costa Rica · PlanoExactoCR',
    'Remates judiciales de fincas en Costa Rica, ubicados por plano y finca sobre el catastro, con entorno y análisis de cada lote.': 'Judicial auctions of properties in Costa Rica, located by survey plan and property over the cadastre, with surroundings and per-lot analysis.',
    'Todos los remates judiciales de propiedades de Costa Rica en un mapa, con base, fechas y ubicación.': 'All of Costa Rica’s judicial property auctions on one map, with opening prices, dates and location.',

    // ---- Toggle de idioma ----
    'Idioma': 'Language',
    'Español': 'Spanish',
    'English': 'English',

    // ---- Toggle de moneda ----
    'Moneda': 'Currency',

    // ---- Landing (inicio.html) — hero + manifiesto ----
    'Entrar': 'Sign in',
    'Entrar al mapa': 'Enter the map',
    'Ir al mapa': 'Open the map',
    'Antes de ofertar, mirá bien': 'Before you bid, take a good look',
    'Los remates judiciales de Costa Rica,': 'Costa Rica’s judicial auctions,',
    'sin tanto misterio': 'without all the mystery',
    'Cada día hábil leemos el Boletín Judicial, buscamos cada propiedad en el catastro y juntamos lo que querés saber antes de ofrecer: dónde queda, qué tiene cerca, qué se puede construir y qué deuda arrastra. No reemplaza a tu abogado ni a un avalúo. Te ayuda a llegar bien a esa conversación.': 'Every business day we read the Judicial Gazette, locate each property in the cadastre and gather what you want to know before bidding: where it is, what’s around, what you can build and what debt it carries. It doesn’t replace your lawyer or an appraisal — it helps you walk into that conversation prepared.',
    'remates vigentes hoy': 'active auctions today',
    'nuevos esta semana': 'new this week',
    'con el predio ubicado': 'with the parcel located',
    'último Boletín Judicial': 'latest Judicial Gazette',
    'Probá gratis': 'Try it free',
    'Mirá el mapa primero': 'See the map first',
    'La vista real del mapa, hoy': 'The real map view, today',
    'Mapa de PlanoExactoCR con los remates agrupados por zona y la ficha de una propiedad abierta': 'PlanoExactoCR map with auctions clustered by area and a property card open',

    // Manifiesto (bloque «detrás del mapa»)
    'Somos un equipo pequeño en Costa Rica: arquitectura, derecho y datos. Compramos, vendemos y construimos con las mismas dudas de todo el mundo: ¿de dónde sale el agua?, ¿hay plano al día?, ¿la muni deja construir? Armamos esta herramienta para no andar abriendo diez pestañas cada vez que aparece un remate interesante.': 'We’re a small team in Costa Rica: architecture, law and data. We buy, sell and build with the same questions as everyone else: where does the water come from? Is the survey plan up to date? Will the municipality let me build? We built this tool so we don’t have to open ten tabs every time an interesting auction shows up.',
    '— Si algo no te cierra o querés que miremos un lote contigo, escribinos. Abajo están los medios.': '— If something doesn’t add up, or you want us to look at a lot with you, write to us. Our channels are below.',

    // Sección «qué juntamos» (6 rasgos)
    'Qué juntamos de cada remate': 'What we gather for each auction',
    'La información suele estar repartida en más de diez sitios públicos. La traemos a un solo lugar y la explicamos como si estuvieras hablando con alguien que ya la leyó.': 'The information is usually scattered across more than ten public sites. We bring it to one place and explain it as if you were talking to someone who already read it.',
    'Dónde queda, exactamente': 'Where exactly it is',
    'El predio dibujado en el mapa, con su área y su forma. Si el catastro no lo tiene, lo decimos de frente — es un dato importante antes de ofertar.': 'The parcel drawn on the map, with its area and shape. If the cadastre doesn’t have it, we say so plainly — it matters before you bid.',
    'Cuándo y a cuánto arranca': 'When it starts and at what price',
    'Primer, segundo y tercer remate, en colones y dólares, con los días contados hasta la próxima fecha.': 'First, second and third auction, in colones and dollars, with the days counted down to the next date.',
    'Cuánto es, de verdad': 'What it actually costs',
    'En qué porcentaje del valor de Hacienda arranca la puja. Útil para saber si el precio inicial es un negocio o solo un número.': 'What percentage of the Hacienda land value the bidding starts at. Useful for telling a real deal from just a number.',
    'Qué podés hacer en el lote': 'What you can do with the lot',
    'Qué normativa del plan regulador aplica y una estimación de cuánto se podría construir, para no comprar un terreno que no sirve para lo que querés.': 'Which zoning-plan rules apply and an estimate of how much you could build, so you don’t buy land that doesn’t fit your plans.',
    'Cómo es vivir cerca': 'What it’s like nearby',
    'Cobertura de agua potable, salud, escuela, ríos y distancia a la costa. Lo básico para saber si el entorno sirve.': 'Potable water coverage, health, schools, rivers and distance to the coast. The basics to tell if the surroundings work for you.',
    'Qué te podría complicar': 'What could get in your way',
    'Hipotecas, servidumbres y gravámenes explicados en lenguaje llano, riesgos del proceso y un informe PDF de cuatro páginas para llevarte.': 'Mortgages, easements and encumbrances explained in plain language, process risks and a four-page PDF report to take with you.',

    // ---- Sección Conversemos ----
    '¿Dudas sobre un remate? Conversemos.': 'Questions about an auction? Let’s talk.',
    'Si querés que miremos un lote específico contigo, si una ficha te suena rara, o si simplemente no sabés por dónde empezar: escribinos. Lo leemos nosotros y respondemos.': 'If you’d like us to look at a specific lot with you, if a card seems off, or you just don’t know where to start — write to us. We read it ourselves and reply.',
    'No hay vendedores detrás, no te vamos a llamar «para seguir conversando».': 'No salespeople behind this. We won’t call you to «keep the conversation going».',
    'Si lo que necesitás es un abogado o un avaluador, también te decimos — tenemos gente de confianza.': 'If what you really need is a lawyer or an appraiser, we’ll tell you — we have people we trust.',
    'Respondemos en el día, de lunes a viernes.': 'We reply the same day, Monday to Friday.',
    'Escribinos por WhatsApp': 'Message us on WhatsApp',
    'Número por definir — pronto activo': 'Number to be set — coming soon',
    'Mandanos un correo': 'Send us an email',
    'DM en Instagram': 'DM us on Instagram',
    '@planoexactocr · publicamos remates que vale la pena mirar': '@planoexactocr · we post auctions worth a look',
    'Pronto, lo que dicen quienes lo usan': 'Soon: what the people using it have to say',
    'Estamos juntando las primeras experiencias. Si ya nos usaste y querés aparecer acá, contanos.': 'We’re gathering the first experiences. If you’ve used us and want to appear here, let us know.',

    'Planes': 'Plans',
    'Empezá gratis. Suscribite solo cuando lo que te damos ya te esté ahorrando tiempo o cuidando una decisión importante.': 'Start free. Subscribe only when what we give you is already saving time or protecting a real decision.',
    'Cuenta gratis': 'Free account',
    'Solo con tu correo': 'Just your email',
    'Fechas y bases de cada remate, área y estado del plan regulador': 'Dates and opening prices for each auction, area and zoning plan status',
    'Predio exacto en el mapa, con su forma según el catastro': 'Exact parcel on the map, with its shape from the cadastre',
    'Guardás listas y seguís lotes': 'Save lists and follow lots',
    '1 expediente PDF completo por semana': '1 full PDF report per week',
    'Esencial': 'Essential',
    'Para decidir con calma': 'To decide with time',
    'al mes': 'per month',
    'o ₡51.900 al año (dos meses de regalo)': 'or ₡51,900 per year (two months free)',
    'o ₡112.900 al año (dos meses de regalo)': 'or ₡112,900 per year (two months free)',
    'Todo lo de la cuenta gratis': 'Everything in the free account',
    'Número de finca y plano, servidumbres y gravámenes citados en el edicto': 'Property and survey plan numbers, easements and encumbrances cited in the notice',
    'Agua potable, vía, salud, escuela, ríos y costa': 'Potable water, roads, health, schools, rivers and coastline',
    '5 expedientes por semana': '5 reports per week',
    'Para quien compra en serio': 'For serious buyers',
    'Todo lo del plan Esencial': 'Everything in the Essential plan',
    'Valor de Hacienda, índice Puja/Hacienda y escala PECR': 'Hacienda land value, Bid/Hacienda ratio and PECR scale',
    'Todas las capas, mapa de precios y Top 10 por provincia': 'All layers, price map and Top 10 by province',
    'Potencial constructivo, prefactibilidad, riesgos y alertas de cambio': 'Build-out potential, feasibility, risks and change alerts',
    'Expedientes sin tope': 'Unlimited reports',
    'Si en una semana necesitás más expedientes de los que trae tu plan, cada uno adicional vale': 'If in one week you need more reports than your plan includes, each extra one costs',
    '. El primer mes de cualquier plan tiene 30 % de descuento con el cupón de lanzamiento — se activa solo al registrarte.': '. The first month of any plan is 30% off with the launch coupon — it kicks in automatically when you sign up.',
    'Qué incluye cada plan': 'What each plan includes',
    'Desliza la tabla hacia los lados para ver Esencial y PRO →': 'Swipe the table sideways to see Essential and PRO →',
    'Gratis': 'Free',
    'El mapa': 'The map',
    'Ver los remates en el mapa': 'See the auctions on the map',
    'Capas de valor del terreno, agua potable, vías, salud, zonas de vida, curvas de nivel y zona marítimo terrestre': 'Layers for land value, potable water, roads, health, life zones, contour lines and the maritime zone',
    'La ficha de cada propiedad': 'The card for each property',
    'Fechas, base y área de cada remate': 'Dates, opening prices and area of each auction',
    'Predio dibujado según el catastro': 'Parcel drawn from the cadastre',
    'Número de finca y plano, servidumbres y gravámenes': 'Property and survey plan numbers, easements and encumbrances',
    'Valor de Hacienda, índice Puja/Hacienda, escala PECR e Índice PlanoExacto': 'Hacienda land value, Bid/Hacienda ratio, PECR scale and PlanoExacto Index',
    'Herramientas': 'Tools',
    'Riesgos del proceso y alertas de cambios': 'Process risks and change alerts',
    'Valor de referencia y potencial constructivo': 'Reference value and build-out potential',
    'Prefactibilidad financiera': 'Financial feasibility',
    'Mapa de precios por m² y Top 10 del mes': 'Price-per-m² map and monthly Top 10',
    'Filtrar por atributos del lote': 'Filter by lot attributes',
    'Organizar tu búsqueda': 'Organize your search',
    'Favoritos, seguimiento y listas': 'Favorites, follow-up and lists',
    'Búsquedas guardadas': 'Saved searches',
    'Comparar remates a la vez': 'Compare auctions side by side',
    'Expedientes': 'Reports',
    'Expedientes PDF por semana': 'PDF reports per week',
    'Expediente adicional, fuera del cupo': 'Extra report, beyond the quota',
    'Sin límite': 'Unlimited',
    'Incluido': 'Included',

    'Primer mes con 30 % de descuento': 'First month at 30% off',
    'Entrá al mapa, sin compromiso': 'Enter the map, no strings attached',
    'El mapa en sí está abierto para todos. Con tu cuenta gratis abrís la ficha de cada remate, ves el predio en el catastro, guardás listas y seguís lotes, y generás un expediente PDF por semana. Nada de tarjeta ni letra chica.': 'The map itself is open to everyone. With your free account you open the card of each auction, see the parcel on the cadastre, save lists and follow lots, and generate one PDF report per week. No credit card, no fine print.',
    'Al registrarte te mandamos un cupón de 30 % de descuento para la primera mensualidad, por si más adelante querés probar un plan. Los pagos son por SINPE Móvil — sin suscripción automática, sin cobros sorpresa.': 'When you sign up we send you a coupon for 30% off the first monthly bill, in case you want to try a plan later. Payments go through SINPE Móvil — no auto-renew, no surprise charges.',
    'Continuar con Google': 'Continue with Google',
    'o con tu correo': 'or with your email',
    'Correo electrónico': 'Email',
    'Enviarme un enlace para entrar': 'Email me a sign-in link',
    'Enviando…': 'Sending…',
    'Revisa tu correo': 'Check your email',
    'Sin contraseñas. Si es tu primera vez, se crea tu cuenta gratis y te llega el cupón. Al continuar aceptás la': 'No passwords. If this is your first time, your free account is created and the coupon lands in your inbox. By continuing you accept the',
    'política de privacidad': 'privacy policy',
    'Contraseña': 'Password',
    '(mínimo 8 caracteres)': '(minimum 8 characters)',
    'Nombre (opcional)': 'Name (optional)',
    'Te interesa como': 'Interested as',
    'Comprador': 'Buyer',
    'Inversionista': 'Investor',
    'Abogado': 'Lawyer',
    'Corredor': 'Broker',
    'Desarrollador': 'Developer',
    'Otro': 'Other',
    'Provincia de interés': 'Province of interest',
    'Todo el país': 'Nationwide',
    'Acepto la': 'I accept the',
    ': PlanoExactoCR guarda mi correo y mis preferencias para mi cuenta y para avisarme novedades. Puedo pedir que los borren cuando quiera.': ': PlanoExactoCR keeps my email and preferences for my account and to notify me of updates. I can request deletion at any time.',
    'Probar gratis': 'Try it free',
    'Creando tu cuenta…': 'Creating your account…',
    '¿Ya tenés cuenta?': 'Already have an account?',
    'Entrá acá': 'Sign in here',
    'Listo. Guardate este cupón:': 'All set. Save this coupon:',
    'Siempre va a estar en «Mi cuenta». En Instagram publicamos remates que vale la pena mirar —': 'It’ll always be in «My account». On Instagram we post auctions worth a look —',
    'Ya tenés cuenta. Tu cupón:': 'You already have an account. Your coupon:',
    'Revisa el correo: parece incompleto.': 'Check the email: it looks incomplete.',
    'La contraseña debe tener al menos 8 caracteres.': 'The password must be at least 8 characters long.',
    'Para crear la cuenta, marca la casilla de privacidad.': 'To create the account, check the privacy box.',
    'No se pudo enviar.': 'Couldn’t send.',
    'No se pudo crear la cuenta. Intenta de nuevo en un momento.': 'Couldn’t create the account. Please try again in a moment.',
    'Ya existe una cuenta con ese correo. Entra desde el mapa con tu contraseña.': 'An account with that email already exists. Sign in from the map with your password.',
    'Si necesitas más expedientes de los que incluye tu plan, cada uno adicional cuesta': 'If you need more reports than your plan includes, each extra one costs',
    '. Con el cupón de lanzamiento, el primer mes de cualquier plan tiene 30 % de descuento.': '. With the launch coupon, the first month of any plan is 30% off.',

    'Correo:': 'Email:',
    'Conversemos': 'Let’s talk',
    'WhatsApp': 'WhatsApp',
    'Remates por provincia': 'Auctions by province',
    'Privacidad': 'Privacy',
    'PlanoExactoCR reúne información pública del Boletín Judicial, el Registro Inmobiliario, IGN, Hacienda, AyA, INVU, ARESEP y MINAE, y la ordena para que sea más fácil de entender. No es asesoría legal ni un avalúo: antes de ofertar, siempre revisá el expediente judicial y el Registro Nacional, o escribinos para orientarte.': 'PlanoExactoCR brings together public information from the Judicial Gazette, the Real Estate Registry, IGN, Hacienda, AyA, INVU, ARESEP and MINAE, and arranges it to be easier to read. It’s not legal advice nor an appraisal: before you bid, always review the court file and the National Registry, or write to us for guidance.',

    // ---- Header común del mapa (index.html) ----
    'Ir al inicio': 'Go to the home page',
    'Cuenta': 'Account',
    'Ver el sitio como usuario gratis o como suscriptor PRO (demostración)': 'View the site as a free user or as a PRO subscriber (demo)',
    'Demostración: mira el sitio como lo ve un usuario gratis o un suscriptor PRO': 'Demo: view the site as a free user or a PRO subscriber sees it',
    'Ver como': 'View as',
    'Cómo usar la herramienta': 'How to use the tool',
    'Cómo usar': 'How to use',
    'Quiénes somos': 'About us',
    'Planes y precios': 'Plans & pricing',
    'Mi cuenta': 'My account',
    'Cambiar colores': 'Change colors',
    'Cambiar a colores claros': 'Switch to light theme',
    'Cambiar a colores oscuros': 'Switch to dark theme',

    // ---- Panel lateral del mapa ----
    'Remates': 'Auctions',
    'Buscar plano': 'Find a survey plan',
    'Comparar': 'Compare',
    'Herramientas PRO': 'PRO tools',
    'Filtros': 'Filters',
    'Quitar todos los filtros': 'Clear all filters',
    'Restablecer': 'Reset',
    'Ubicación': 'Location',
    'Lugar, barrio, finca, plano o expediente': 'Place, neighborhood, property, survey plan or file',
    'Buscar remates': 'Search auctions',
    'Ubicación aproximada': 'Approximate location',

    // ---- Filtros ----
    'Fechas': 'Dates',
    'Calendario': 'Calendar',
    'Lista': 'List',
    'Próxima fecha': 'Next date',
    'Remate en 7 días': 'Auction within 7 days',
    'Publicados el último mes': 'Published in the last month',
    'Etapa del próximo remate': 'Stage of the next auction',
    'Primer remate': 'First auction',
    'Segundo remate': 'Second auction',
    'Tercer remate': 'Third auction',
    'Condiciones': 'Conditions',
    'Tipo de propiedad': 'Property type',
    'Con servicio de agua': 'With water service',
    'Sin ríos a menos de 50 m': 'No rivers within 50 m',
    'Sin servidumbres': 'No easements',
    'Plan regulador vigente': 'Current zoning plan',
    'Base vigente': 'Active opening price',
    'Base mínima': 'Minimum opening price',
    'Base máxima': 'Maximum opening price',
    'Mínima': 'Minimum',
    'Máxima': 'Maximum',
    'Mínimo': 'Minimum',
    'Máximo': 'Maximum',
    'Área': 'Area',
    'Área mínima': 'Minimum area',
    'Área máxima': 'Maximum area',
    'Características': 'Features',
    'Atributos del lote': 'Lot attributes',
    'Atributos de la versión PRO': 'PRO version attributes',
    'Provincia': 'Province',
    'Cantón': 'Canton',
    'Todas': 'All',
    'Todos': 'All',

    // ---- Buscar plano ----
    'Buscar en el catastro': 'Search the cadastre',
    'Por plano': 'By survey plan',
    'Por finca': 'By property number',
    'Número de plano': 'Survey plan number',

    // ---- Barra de resultados / ordenamiento ----
    'Ordenar': 'Sort',
    'Más recientes': 'Most recent',
    'Próxima fecha': 'Next date',
    'Menor base': 'Lowest opening price',
    'Menor precio/m²': 'Lowest price/m²',
    'Mayor área': 'Largest area',
    'Mejor índice': 'Best index',
    'Menor índice Puja/Hacienda': 'Lowest Bid/Hacienda index',
    'Buscar por': 'Search by',
    'Mapa de remates': 'Auctions map',
    'Vista': 'View',
    'Ficha de la propiedad': 'Property card',

    // ---- Favoritos y guardado ----
    'Favorito': 'Favorite',
    'Mostrar solo favoritos': 'Show only favorites',
    'Guardar búsqueda': 'Save search',
    'Guardar esta búsqueda en Mi cuenta': 'Save this search in My account',

    // ---- Agrupaciones y popups ----
    'Varios remates juntos': 'Several auctions together',
    'Remate': 'Auction',
    'Remates': 'Auctions',

    // ---- Hub de botones (PRO) ----
    'Ver planes': 'See plans',

    // ---- Panel de capas ----
    'Capas': 'Layers',
    'Mapa base': 'Base map',
    'Referencia': 'Reference',
    'Valor y mercado': 'Value & market',
    'Abastecimiento de agua': 'Water supply',
    'Servicios e infraestructura': 'Services & infrastructure',
    'Ambiente y restricciones': 'Environment & restrictions',

    'Límites cantonales': 'Canton boundaries',
    'Límites distritales': 'District boundaries',
    'Predios del catastro': 'Cadastral parcels',
    'Nombres de ríos': 'River names',
    'Estado del plan regulador': 'Zoning plan status',
    'Zonas homogéneas de Hacienda': 'Hacienda homogeneous zones',
    'valor del terreno': 'land value',
    'Precio por m² de remates': 'Price per m² from auctions',
    'mediana por cantón': 'median by canton',
    'Cobertura de agua potable': 'Potable water coverage',
    'ASADAS (acueductos comunales)': 'ASADAS (communal aqueducts)',
    'Concesiones de agua (fuentes y caudal)': 'Water concessions (sources and flow)',
    'acueductos rurales · caudal en l/s': 'rural aqueducts · flow in l/s',
    'Mapa de calor del caudal': 'Flow heatmap',
    'Mapa de calor integrado del agua': 'Integrated water heatmap',
    'densidad ponderada por l/s otorgados': 'density weighted by granted l/s',
    'concesiones + ASADAS + cobertura implícita': 'concessions + ASADAS + implied coverage',
    'Cobertura implícita (concesiones)': 'Implied coverage (concessions)',
    'derivada de las tomas · comparar con AyA': 'derived from intakes · compare to AyA',
    'Vías públicas': 'Public roads',
    'Puertos y aeropuertos': 'Ports & airports',
    'Centros de salud CCSS': 'CCSS health centers',
    'Zonas de vida': 'Life zones',
    'Uso y cobertura del suelo 2020': 'Land use & cover 2020',
    'Ríos y quebradas': 'Rivers & streams',
    'Curvas de nivel cada 10 m': 'Contour lines every 10 m',
    'Franjas de protección de ríos': 'River protection strips',
    'Pago por servicios ambientales 2025': 'Payment for environmental services 2025',
    'Zona marítimo terrestre': 'Maritime terrestrial zone',

    // Leyenda de agua (ASADAS)
    'Gravedad': 'Gravity-fed',
    'Bombeo': 'Pumped',
    'Mixto': 'Mixed',
    'Sin dato': 'No data',
    'Acueducto municipal': 'Municipal aqueduct',

    // Leyenda concesiones
    'Subterránea (pozo/acuífero)': 'Groundwater (well/aquifer)',
    'Superficial (nacimiento/río)': 'Surface (spring/river)',
    'Otra': 'Other',
    'Bajo': 'Low',
    'Medio': 'Medium',
    'Alto': 'High',
    'Muy alto': 'Very high',
    'Área con tomas registradas por la Dirección de Agua': 'Area with intakes registered by the Water Directorate',

    // Electricidad
    'Abastecimiento eléctrico': 'Electricity supply',
    // Apagar categoría
    'Apagar las capas activas de Referencia': 'Turn off active layers in Reference',
    'Apagar las capas activas de Valor y mercado': 'Turn off active layers in Value & market',
    'Apagar las capas activas de Abastecimiento de agua': 'Turn off active layers in Water supply',
    'Apagar las capas activas de Abastecimiento eléctrico': 'Turn off active layers in Electricity supply',
    'Apagar las capas activas de Servicios e infraestructura': 'Turn off active layers in Services & infrastructure',
    'Apagar las capas activas de Ambiente y restricciones': 'Turn off active layers in Environment & restrictions',
    'Cobertura eléctrica por operador': 'Electric coverage by operator',
    'ICE, CNFL, ESPH, JASEC y cooperativas': 'ICE, CNFL, ESPH, JASEC and cooperatives',
    'Operador eléctrico': 'Electric operator',
    'Área:': 'Area:',

    // Tooltips de las capas vectoriales
    'Fuente de agua': 'Water source',
    'Sin caudal registrado': 'No flow registered',
    'Caudal:': 'Flow:',
    'Uso:': 'Use:',
    'Sistema:': 'System:',
    'Abonados:': 'Users:',
    'Zona:': 'Zone:',
    'Rural': 'Rural',
    'Urbana': 'Urban',
    'Costera': 'Coastal',
    'Periurbana': 'Peri-urban',
    'Rural Indígena': 'Rural Indigenous',

    'consumo humano': 'human consumption',
    'acueducto rural': 'rural aqueduct',
    'riego': 'irrigation',
    'agropecuario': 'agricultural',
    'agroindustrial': 'agro-industrial',
    'industrial': 'industrial',
    'comercial': 'commercial',
    'turistico': 'tourism',
    'fuerza hidraulica': 'hydraulic power',

    // Click handler
    'Agua potable': 'Potable water',
    'ASADA más cercana': 'Nearest ASADA',
    'sin tipo': 'no type',
    'abonados': 'users',
    'Fuente de agua más cercana': 'Nearest water source',
    'caudal': 'flow',
    'sin caudal registrado': 'no flow registered',
    'Cobertura implícita': 'Implied coverage',
    'Zona homogénea': 'Homogeneous zone',
    'Zona de vida': 'Life zone',
    'Uso del suelo': 'Land use',
    'Precio por m² en': 'Price per m² in',
    'mediana de': 'median of',
    'remates': 'auctions',
    'Menos de 3 remates con área': 'Fewer than 3 auctions with area',

    // Ficha de propiedad (bloques comunes)
    'Agua potable': 'Potable water',
    'Cobertura de': 'Coverage from',
    'Favoritos': 'Favorites',
    'Agregar a favoritos': 'Add to favorites',
    'Quitar de favoritos': 'Remove from favorites',
    'Agregado a favoritos': 'Added to favorites',
    'Agregar al comparador': 'Add to compare',
    'Agregado al comparador': 'Added to compare',
    'Quitar del comparador': 'Remove from compare',
    'Abrir para este lote': 'Open for this lot',
    'Activar en el mapa': 'Activate on the map',
    'Activar plan': 'Activate plan',
    'Activo': 'Active',
    'Activo hasta el ': 'Active until ',
    'Administración': 'Administration',
    'Aeródromo': 'Airfield',
    'Aeropuerto internacional': 'International airport',

    // Botones comunes
    'Guardar': 'Save',
    'Cancelar': 'Cancel',
    'Cerrar': 'Close',
    'Aceptar': 'Accept',
    'Continuar': 'Continue',
    'Volver': 'Back',
    'Siguiente': 'Next',
    'Anterior': 'Previous',
    'Buscar': 'Search',
    'Limpiar': 'Clear',
    'Más': 'More',
    'Menos': 'Less',

    // Nivel de zoom
    'Nivel de zoom': 'Zoom level',

    // ============================================================
    // FICHA DE PROPIEDAD / EXPEDIENTE / HERRAMIENTAS PRO
    // ============================================================

    // Encabezados y secciones
    'Información base': 'Base information',
    'Remate': 'Auction',
    'Terreno': 'Land',
    'Normativa': 'Zoning rules',
    'Registro y ubicación': 'Registry & location',
    'Servicios y entorno': 'Services & surroundings',
    'Valor y mercado': 'Value & market',
    'Índice Puja/Hacienda': 'Bid/Hacienda index',
    'Escala de valor PECR': 'PECR value scale',
    'Índice PlanoExacto': 'PlanoExacto Index',
    'Atributos del lote': 'Lot attributes',
    'Expediente': 'Report',
    'Expediente del lote': 'Lot report',
    'Con el plan Esencial': 'With the Essential plan',
    'Con el plan PRO': 'With the PRO plan',

    // Labels (dt) de la ficha
    'Área': 'Area',
    'Dimensiones': 'Dimensions',
    'Forma del predio': 'Parcel shape',
    'Topografía': 'Topography',
    'Uso del suelo': 'Land use',
    'Zona de vida': 'Life zone',
    'Finca': 'Property №',
    'Plano': 'Survey plan',
    'Servidumbres': 'Easements',
    'Ubicación': 'Location',
    'Publicado': 'Published',
    'Agua potable': 'Potable water',
    'Vía más cercana': 'Nearest road',
    'Salud': 'Health',
    'Escuela': 'School',
    'Ríos': 'Rivers',
    'Costa': 'Coastline',
    'Zona homogénea': 'Homogeneous zone',

    // Valores / estados
    'Sin dato': 'No data',
    'Sin dato del MINAE': 'No data from MINAE',
    'Sin cobertura registrada': 'No registered coverage',
    'Sin cartografía 1:5 000 en el sitio': 'No 1:5,000 cartography at this location',
    'Ninguna citada en el edicto': 'None cited in the notice',
    'Ninguno a menos de 400 m': 'None within 400 m',
    'Sin fechas legibles en el edicto.': 'No readable dates in the notice.',
    'Sin atributos destacados': 'No notable attributes',
    'Sin ríos a menos de 50 m': 'No rivers within 50 m',
    'Sin servidumbres': 'No easements',
    'No indicado': 'Not stated',
    'Ubicación por definir': 'Location to be defined',
    'Aproximada: el punto marca el centro del distrito declarado, porque el catastro no devolvió el predio': 'Approximate: the dot marks the center of the stated district, because the cadastre did not return the parcel',
    'Predio del catastro consultado por plano': 'Cadastral parcel looked up by survey plan',
    'área s/d': 'area n/a',
    'Una citada': 'One cited',
    'citadas': 'cited',
    'varias fincas o derechos': 'multiple properties or rights',

    // Textos de ayuda (card lock)
    'Confirme zona, usos, cobertura y altura con el certificado de uso de suelo.': 'Confirm zone, uses, coverage and height with the land-use certificate.',
    'Lote mínimo 90 a 120 m², frente mínimo 6 m, fondo hasta 7 veces el frente.': 'Minimum lot 90 to 120 m², minimum frontage 6 m, depth up to 7 times the frontage.',
    'Número de finca y plano, servidumbres citadas y origen de la ubicación.': 'Property and survey plan numbers, cited easements and location origin.',
    'Agua potable, vía de acceso, salud, escuela, ríos y distancia a la costa.': 'Potable water, access road, health, school, rivers and distance to the coast.',
    'Valor de Hacienda de la zona y en qué porcentaje de ese valor arranca la puja.': 'Hacienda land value for the zone and the percentage of it at which the bidding starts.',
    'Nivel del predio en la escala de valor PECR, de 1 a 10.': 'Parcel level on the PECR value scale, from 1 to 10.',
    'Sanidad jurídica, precio por m², servicios y restricciones': 'Legal soundness, price per m², services and restrictions',
    'Según curvas de nivel del IGN': 'According to IGN contour lines',
    'AyA, ESPH, ASADAS y acueductos municipales': 'AyA, ESPH, ASADAS and municipal aqueducts',
    'Desglose en el expediente o en PRO': 'Breakdown in the report or in PRO',
    'Información orientativa de fuentes públicas. No sustituye la certificación del Registro Nacional, el certificado de uso de suelo ni la revisión del expediente judicial.': 'Guidance based on public sources. It does not replace the National Registry certification, the land-use certificate or review of the court file.',
    'Términos y descargo': 'Terms & disclaimer',

    // Botones y acciones
    'En favoritos': 'In favorites',
    'Está en remate: ver ficha': 'It is in auction: open card',
    'O abre el expediente de este lote': 'Or open the report for this lot',
    'Abrir expediente': 'Open report',
    'Generar expediente': 'Generate report',
    'Expediente adicional': 'Extra report',
    'Disponible': 'Available',
    'Incluido en PRO': 'Included in PRO',
    'sin límite': 'unlimited',
    'te queda 1': '1 left',
    'te quedan': 'left',

    // Expediente — bullets
    'Texto del edicto, datos registrales y despacho': 'Notice text, registry data and court office',
    'Texto del edicto (si está en remate), datos registrales y despacho': 'Notice text (if in auction), registry data and court office',
    'Gravámenes y servidumbres explicados en lenguaje claro': 'Encumbrances and easements explained in plain language',
    'Valor de Hacienda, índices y entorno completo del predio': 'Hacienda value, indices and full surroundings of the parcel',
    'Análisis multidimensional y comparables de la zona': 'Multidimensional analysis and comparables for the area',
    'Versión imprimible con mapa del predio': 'Printable version with map of the parcel',
    'No es un certificado de uso de suelo ni una certificación registral: es un compendio de información pública con un análisis orientativo.': 'It is neither a land-use certificate nor a registry certification: it is a compendium of public information with guidance-level analysis.',

    // Herramientas PRO (botones)
    'Herramientas': 'Tools',
    'Riesgos': 'Risks',
    'Alertas': 'Alerts',
    'Potencial constructivo': 'Build-out potential',
    'Prefactibilidad': 'Feasibility',
    'Alertas del remate': 'Auction alerts',
    'Antes de ofertar': 'Before bidding',
    'Avisarme cuando': 'Notify me when',
    'Dejar de seguir este lote': 'Stop following this lot',
    'Mis favoritos': 'My favorites',

    // Niveles / calidad
    'Favorable': 'Favorable',
    'Muy favorable': 'Very favorable',
    'Desfavorable': 'Unfavorable',
    'Intermedio': 'Intermediate',
    'Con reparos': 'With caveats',
    'Bueno': 'Good',
    'Muy bueno': 'Very good',
    'Malo': 'Poor',
    'Alto': 'High',
    'Altos': 'High',
    'altos': 'high',
    'medios': 'medium',

    // Topografía
    'Terreno plano': 'Flat terrain',
    'Ondulada': 'Rolling',
    'Quebrada': 'Steep',
    'Muy quebrada': 'Very steep',

    // Entorno
    'Zona urbana': 'Urban zone',
    'Frente a vía': 'Fronting a road',
    'Entorno urbano': 'Urban surroundings',
    'Escuela cerca': 'School nearby',
    'Cauce cercano': 'Nearby watercourse',
    'Cauce a': 'Watercourse at',
    'Cobertura forestal': 'Forest cover',
    'Contrato de pago por servicios ambientales': 'Payment-for-environmental-services contract',
    'Franja de protección de ríos': 'River protection strip',

    // Normativa / lote
    'Frente mínimo': 'Minimum frontage',
    'Fondo máximo': 'Maximum depth',
    'Cobertura máxima': 'Maximum coverage',
    'Cantón con plan regulador vigente': 'Canton with current zoning plan',
    'Cantón sin plan regulador vigente': 'Canton without current zoning plan',
    'Fuera de las áreas de cobertura registradas': 'Outside registered coverage areas',
    'Forma del lote fuera de la norma nacional': 'Lot shape outside the national norm',
    'El catastro no coincide con el edicto': 'The cadastre does not match the notice',
    'El catastro devolvió un predio que no coincide con el edicto': 'The cadastre returned a parcel that does not match the notice',
    'El edicto incluye varias fincas o derechos': 'The notice includes several properties or rights',
    'Acceso a confirmar': 'Access to confirm',
    'Acceso por servidumbre': 'Access via easement',
    'Filial de condominio': 'Condominium unit',

    // Tipo de propiedad (catálogo)
    'Lote': 'Lot',
    'Con construcción': 'With building',
    'Agrícola': 'Agricultural',
    'Filial': 'Condo unit',
    'Construcción': 'Building',
    'Construcción depreciada': 'Depreciated building',
    'Edad': 'Age',
    'Circulaciones y muros': 'Circulation & walls',

    // Gravámenes y servidumbres
    'Hipoteca': 'Mortgage',
    'Hipoteca citada': 'Mortgage cited',
    'Hipoteca citada en el edicto': 'Mortgage cited in the notice',
    'Embargo': 'Attachment',
    'Embargo inscrito': 'Attachment on record',
    'Demanda inscrita': 'Lawsuit on record',
    'Anotación': 'Annotation',
    'Anotaciones o demandas': 'Annotations or lawsuits',
    'Arrendamiento': 'Lease',

    // Prefactibilidad / mercado
    'Base vigente frente a referencia': 'Opening price vs. reference',
    'Base vigente frente a la mediana de remates de la zona': 'Opening price vs. the median auction in the zone',
    'De la compra a la venta': 'From purchase to resale',
    'Ganancia': 'Gain',
    'Comisión de venta': 'Sales commission',
    'Gastos de adjudicación': 'Award costs',
    'Historia del sitio': 'Site history',

    // Varios
    'Correo electrónico': 'Email',
    'Canales': 'Channels',
    'El lote': 'The lot',
    'Buscar por': 'Search by',

    // Provincias — se dejan en español por regla (nombres propios).
    // No se traducen: San José, Alajuela, Cartago, Heredia, Guanacaste, Puntarenas, Limón.
  });
})();
