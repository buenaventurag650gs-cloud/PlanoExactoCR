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

    // ---- Landing (inicio.html) ----
    'Entrar': 'Sign in',
    'Ir al mapa': 'Open the map',
    'Remates judiciales con contexto territorial': 'Judicial auctions with territorial context',
    'Los remates judiciales de Costa Rica,': 'Costa Rica’s judicial auctions,',
    'en un mapa': 'on a map',
    'Cada día hábil leemos el Boletín Judicial, buscamos cada propiedad en el catastro y la cruzamos con el plan regulador, el valor de Hacienda, el agua potable y su entorno. Así sabes qué estás comprando antes de ofertar.': 'Every business day we read the Judicial Gazette, locate each property in the cadastre and cross-reference it with the zoning plan, Hacienda’s land value, water coverage and surroundings — so you know what you’re buying before bidding.',
    'remates vigentes': 'active auctions',
    'nuevos esta semana': 'new this week',
    'con predio exacto': 'with exact parcel',
    'último Boletín Judicial': 'latest Judicial Gazette',
    'Crear cuenta gratis': 'Create a free account',
    'Explorar el mapa': 'Explore the map',
    'Vista real del mapa · hoy': 'Live map view · today',
    'Mapa de PlanoExactoCR con los remates agrupados por zona y la ficha de una propiedad abierta': 'PlanoExactoCR map with auctions clustered by area and a property card open',

    'Qué ves en cada remate': 'What you see in each auction',
    'Información pública que suele estar repartida en más de diez instituciones, reunida en una sola ficha.': 'Public information that is usually scattered across more than ten institutions, gathered in a single card.',
    'Ubicación en el catastro': 'Cadastral location',
    'El predio dibujado en el mapa, con su área y su forma. Si no aparece en el catastro, lo indicamos.': 'The parcel drawn on the map with its area and shape. If it isn’t in the cadastre, we say so.',
    'Base y fechas': 'Opening prices and dates',
    'Primer, segundo y tercer remate, en colones y dólares.': 'First, second and third auction, in colones and dollars.',
    'Puja frente a Hacienda': 'Opening bid vs. Hacienda',
    'En qué porcentaje del valor de Hacienda arranca la puja.': 'What percentage of the Hacienda land value the bidding starts at.',
    'Plan regulador': 'Zoning plan',
    'Qué normativa aplica al lote y una estimación de cuánto se podría construir.': 'Which rules apply to the lot and an estimate of how much could be built.',
    'Agua y entorno': 'Water & surroundings',
    'Cobertura de agua potable, salud, escuela, ríos y costa.': 'Potable water coverage, health services, schools, rivers and coastline.',
    'Riesgos y expediente': 'Risks & report',
    'Gravámenes explicados en lenguaje claro, riesgos del proceso y un informe PDF de cuatro hojas.': 'Encumbrances explained in plain language, process risks and a four-page PDF report.',

    'Planes': 'Plans',
    'Empieza gratis. Suscríbete cuando necesites más detalle de cada remate.': 'Start free. Subscribe when you need more detail on each auction.',
    'Cuenta gratis': 'Free account',
    'Con tu correo': 'With your email',
    'Fechas y bases de cada remate, área y estado del plan regulador': 'Dates and opening prices for each auction, area and zoning plan status',
    'Predio exacto en el mapa, con su forma según el catastro': 'Exact parcel on the map, with its shape from the cadastre',
    'Listas y seguimiento': 'Lists and follow-up',
    '1 expediente PDF completo por semana': '1 full PDF report per week',
    'Esencial': 'Essential',
    'Lo esencial para decidir': 'The essentials to decide',
    'al mes': 'per month',
    'o ₡51.900 al año (2 meses gratis)': 'or ₡51,900 per year (2 months free)',
    'o ₡112.900 al año (2 meses gratis)': 'or ₡112,900 per year (2 months free)',
    'Todo lo de la cuenta gratis': 'Everything in the free account',
    'Número de finca y plano, servidumbres y gravámenes citados': 'Property and survey plan numbers, easements and encumbrances mentioned',
    'Agua potable, vía, salud, escuela, ríos y costa': 'Potable water, roads, health, schools, rivers and coastline',
    '10 expedientes por semana': '10 reports per week',
    'Acceso total': 'Full access',
    'Todo lo de Esencial': 'Everything in Essential',
    'Valor de Hacienda, índice Puja/Hacienda y escala PECR': 'Hacienda land value, Bid/Hacienda ratio and PECR scale',
    'Todas las capas, mapa de precios y Top 10 por provincia': 'All layers, price map and Top 10 by province',
    'Potencial constructivo, prefactibilidad, riesgos y alertas': 'Build-out potential, feasibility, risks and alerts',
    'Expedientes sin límite': 'Unlimited reports',
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

    'Cupón de lanzamiento · 30 % de descuento': 'Launch coupon · 30% off',
    'Crea tu cuenta gratis': 'Create your free account',
    'El mapa está abierto para todos. Con la cuenta gratis abres la ficha de cada remate, ves el predio en el catastro, guardas listas y seguimientos, y generas un expediente PDF completo por semana.': 'The map is open to everyone. With a free account you open the card of each auction, see the parcel on the cadastre, keep lists and follow-ups, and generate one full PDF report per week.',
    'Al registrarte recibes un cupón de 30 % de descuento para la primera mensualidad de cualquier plan. Los planes se pagan por SINPE Móvil.': 'When you sign up you get a 30% off coupon for the first monthly bill of any plan. Plans are paid via SINPE Móvil.',
    'Continuar con Google': 'Continue with Google',
    'o con tu correo': 'or with your email',
    'Correo electrónico': 'Email',
    'Enviarme un enlace para entrar': 'Email me a sign-in link',
    'Enviando…': 'Sending…',
    'Revisa tu correo': 'Check your email',
    'Sin contraseñas. Si es tu primera vez, se crea tu cuenta gratis y recibes tu cupón. Al continuar aceptas la': 'No passwords. If this is your first time, your free account is created and you get your coupon. By continuing you accept the',
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
    'Crear cuenta y recibir mi cupón': 'Create account and get my coupon',
    'Creando tu cuenta…': 'Creating your account…',
    '¿Ya tienes cuenta?': 'Already have an account?',
    'Entra aquí': 'Sign in here',
    '¡Tu cuenta está lista! Este es tu cupón:': 'Your account is ready! Here is your coupon:',
    'Siempre lo encuentras en «Mi cuenta». En Instagram publicamos remates que vale la pena mirar.': 'You’ll always find it in «My account». On Instagram we post auctions worth a look.',
    'Ya tienes cuenta. Tu cupón:': 'You already have an account. Your coupon:',
    'Revisa el correo: parece incompleto.': 'Check the email: it looks incomplete.',
    'La contraseña debe tener al menos 8 caracteres.': 'The password must be at least 8 characters long.',
    'Para crear la cuenta, marca la casilla de privacidad.': 'To create the account, check the privacy box.',
    'No se pudo enviar.': 'Couldn’t send.',
    'No se pudo crear la cuenta. Intenta de nuevo en un momento.': 'Couldn’t create the account. Please try again in a moment.',
    'Ya existe una cuenta con ese correo. Entra desde el mapa con tu contraseña.': 'An account with that email already exists. Sign in from the map with your password.',
    'Si necesitas más expedientes de los que incluye tu plan, cada uno adicional cuesta': 'If you need more reports than your plan includes, each extra one costs',
    '. Con el cupón de lanzamiento, el primer mes de cualquier plan tiene 30 % de descuento.': '. With the launch coupon, the first month of any plan is 30% off.',

    'Correo:': 'Email:',
    'Remates por provincia': 'Auctions by province',
    'Privacidad': 'Privacy',
    'PlanoExactoCR reúne información pública (Boletín Judicial, Registro Inmobiliario, IGN, Hacienda, AyA, INVU, MINAE) con fines orientativos. No es asesoría legal ni un avalúo: verifica siempre en el expediente judicial y en el Registro Nacional.': 'PlanoExactoCR gathers public information (Judicial Gazette, Real Estate Registry, IGN, Hacienda, AyA, INVU, MINAE) for guidance only. It is neither legal advice nor an appraisal: always verify with the court file and the National Registry.',

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
    'densidad ponderada por l/s otorgados': 'density weighted by granted l/s',
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
    'Sin cobertura registrada': 'No coverage registered',
    'Favoritos': 'Favorites',
    'Agregar a favoritos': 'Add to favorites',
    'Quitar de favoritos': 'Remove from favorites',
    'Agregado a favoritos': 'Added to favorites',
    'Agregar al comparador': 'Add to compare',
    'Agregado al comparador': 'Added to compare',
    'Quitar del comparador': 'Remove from compare',
    'Abrir expediente': 'Open file',
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
  });
})();
