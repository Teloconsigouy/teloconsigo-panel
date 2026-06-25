// ═══════════════════════════════════════════════
//  TELOCONSIGO + TOP SHOP — Panel de Control
//  v53 LOCAL DEV REPARADO — base v50 persistencia + Publicador IA
// ═══════════════════════════════════════════════

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Carga variables locales desde .env cuando se ejecuta en PC. En Railway usa Variables.
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) { console.warn('dotenv no disponible:', e.message); }

const PORT = 8080;


// ═══════════════════════════════════════════════
//  ESTADOS PERSISTENTES DE BANDEJA
//  Guarda leído/no leído, pendientes, descartados y reclamos en JSON.
// ═══════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'inbox-state.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');
const PUBLICATIONS_CACHE_FILE = path.join(DATA_DIR, 'publications-cache.json');
const PUBLICADOR_DRAFTS_FILE = path.join(DATA_DIR, 'publicador-borradores.json');

const MODULES = {
  meliads: { label: 'MeLi ADS', pages: ['/meliads.html'], api: ['/api/meli'] },
  inbox: { label: 'Bandeja MeLi', pages: ['/inbox.html'], api: ['/api/inbox', '/api/state'] },
  prices: { label: 'Lista de Precios', pages: ['/precios.html'], api: [] },
  publications: { label: 'Publicaciones', pages: ['/publicaciones.html'], api: ['/api/publications'] },
  publicador: { label: 'Creador de Publicaciones', pages: ['/publicador.html'], api: ['/api/publicador'] },
  analytics: { label: 'Analytics General', pages: ['/analytics.html'], api: [] },
  automation: { label: 'Alertas & Automatización', pages: ['/automatizacion.html'], api: [] },
  config: { label: 'Configuración', pages: ['/configuracion.html'], api: [] },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultInboxState() {
  return {
    messages: {},
    claims: {},
    questions: {},
    updatedAt: new Date().toISOString(),
  };
}

function loadInboxState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    const initial = defaultInboxState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      ...defaultInboxState(),
      ...data,
      messages: data.messages || {},
      claims: data.claims || {},
      questions: data.questions || {},
    };
  } catch (e) {
    const backup = STATE_FILE + '.broken-' + Date.now();
    try { fs.copyFileSync(STATE_FILE, backup); } catch {}
    const initial = defaultInboxState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function saveInboxState(data) {
  ensureDataDir();
  const clean = {
    messages: data.messages || {},
    claims: data.claims || {},
    questions: data.questions || {},
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function loadAuditLog() {
  ensureDataDir();
  if (!fs.existsSync(AUDIT_FILE)) {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify({ actions: [] }, null, 2));
    return { actions: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    return { actions: Array.isArray(data.actions) ? data.actions : [] };
  } catch {
    return { actions: [] };
  }
}

function saveAuditLog(data) {
  ensureDataDir();
  const actions = (data.actions || []).slice(-1000);
  fs.writeFileSync(AUDIT_FILE, JSON.stringify({ actions }, null, 2));
}


function defaultPublicationsCache() {
  return {
    tlc: [],
    topshop: [],
    supplierLinks: {},
    localEdits: {},
    publicationLinks: {},
    movements: [],
    lastAutoLinkedSyncAt: null,
    updatedAt: null,
  };
}

function loadPublicationsCache() {
  ensureDataDir();
  if (!fs.existsSync(PUBLICATIONS_CACHE_FILE)) {
    const initial = defaultPublicationsCache();
    fs.writeFileSync(PUBLICATIONS_CACHE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(PUBLICATIONS_CACHE_FILE, 'utf8'));
    return {
      ...defaultPublicationsCache(),
      ...data,
      tlc: Array.isArray(data.tlc) ? data.tlc : [],
      topshop: Array.isArray(data.topshop) ? data.topshop : [],
      supplierLinks: data.supplierLinks || {},
      localEdits: data.localEdits || {},
      publicationLinks: data.publicationLinks || {},
      movements: Array.isArray(data.movements) ? data.movements : [],
    };
  } catch {
    const backup = PUBLICATIONS_CACHE_FILE + '.broken-' + Date.now();
    try { fs.copyFileSync(PUBLICATIONS_CACHE_FILE, backup); } catch {}
    const initial = defaultPublicationsCache();
    fs.writeFileSync(PUBLICATIONS_CACHE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function savePublicationsCache(data) {
  ensureDataDir();
  const clean = {
    tlc: Array.isArray(data.tlc) ? data.tlc : [],
    topshop: Array.isArray(data.topshop) ? data.topshop : [],
    supplierLinks: data.supplierLinks || {},
    localEdits: data.localEdits || {},
    publicationLinks: data.publicationLinks || {},
    movements: (data.movements || []).slice(-500),
    lastAutoLinkedSyncAt: data.lastAutoLinkedSyncAt || null,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PUBLICATIONS_CACHE_FILE, JSON.stringify(clean, null, 2));
  return clean;
}


function defaultPublicadorDrafts() {
  return { drafts: [], updatedAt: null };
}

function loadPublicadorDrafts() {
  ensureDataDir();
  if (!fs.existsSync(PUBLICADOR_DRAFTS_FILE)) {
    const initial = defaultPublicadorDrafts();
    fs.writeFileSync(PUBLICADOR_DRAFTS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(PUBLICADOR_DRAFTS_FILE, 'utf8'));
    return { drafts: Array.isArray(data.drafts) ? data.drafts : [], updatedAt: data.updatedAt || null };
  } catch {
    try { fs.copyFileSync(PUBLICADOR_DRAFTS_FILE, PUBLICADOR_DRAFTS_FILE + '.broken-' + Date.now()); } catch {}
    const initial = defaultPublicadorDrafts();
    fs.writeFileSync(PUBLICADOR_DRAFTS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function savePublicadorDrafts(data) {
  ensureDataDir();
  const clean = { drafts: Array.isArray(data.drafts) ? data.drafts.slice(-300) : [], updatedAt: new Date().toISOString() };
  fs.writeFileSync(PUBLICADOR_DRAFTS_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function decodeHtmlEntities(text) {
  let s = String(text || '');
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
    deg: '°', ordm: 'º', frac12: '½', bull: '•'
  };
  s = s.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (_, n) => named[n] || `&${n};`);
  s = s.replace(/&#(\d+);/g, (_, n) => {
    try { return String.fromCodePoint(Number(n)); } catch { return _; }
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; }
  });
  return s;
}

function cleanPublicadorText(v) {
  return decodeHtmlEntities(String(v || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapePlainText(v) {
  return cleanPublicadorText(v).replace(/\s+/g, ' ').trim();
}

function getMetaContent(htmlStr, keys) {
  for (const key of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
    const m = htmlStr.match(re1) || htmlStr.match(re2);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return '';
}

function normalizePublicadorImageUrl(src, pageUrl) {
  if (!src || typeof src !== 'string') return '';
  src = decodeHtmlEntities(src)
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .trim();
  src = src.replace(/^['\"]+|['\"]+$/g, '');
  if (src.startsWith('//')) src = 'https:' + src;
  if (src.startsWith('/')) {
    try { src = new URL(src, pageUrl).toString(); } catch {}
  }
  return src;
}


function isUsefulPublicadorImage(src) {
  const low = String(src || '').toLowerCase();
  if (!low.startsWith('http')) return false;
  if (low.includes('logo') || low.includes('icon') || low.includes('sprite') || low.includes('banner') || low.includes('avatar') || low.includes('favicon')) return false;
  if (low.includes('mlstatic.com')) return true;
  if (low.includes('makerworld') || low.includes('bambulab') || low.includes('bblmw.com') || low.includes('makerworld.bblmw.com')) return true;
  if (low.includes('image') || low.includes('picture') || low.includes('photo') || low.includes('thumb') || low.includes('cover')) return true;
  return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(low);
}

function decodePossibleImageUrl(v, pageUrl='') {
  let src = String(v || '').trim();
  if (!src) return '';
  try { src = JSON.parse('"' + src.replace(/"/g, '\\"') + '"'); } catch {}
  src = decodeHtmlEntities(src)
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
  try {
    if (/^https?%3a%2f%2f/i.test(src)) src = decodeURIComponent(src);
  } catch {}
  src = src.replace(/^['"]+|['"]+$/g, '');
  if (src.startsWith('//')) src = 'https:' + src;
  if (src.startsWith('/')) {
    try { src = new URL(src, pageUrl).toString(); } catch {}
  }
  return src;
}

function normalizePublicadorImageUrl(src, pageUrl) {
  src = decodePossibleImageUrl(src, pageUrl);
  if (/mlstatic\.com/i.test(src)) {
    // Cuando sea posible, preferir versiones grandes de Mercado Libre.
    src = src.replace(/-S\.(jpg|jpeg|png|webp)(\?|$)/i, '-O.$1$2')
             .replace(/-I\.(jpg|jpeg|png|webp)(\?|$)/i, '-O.$1$2')
             .replace(/-V\.(jpg|jpeg|png|webp)(\?|$)/i, '-O.$1$2');
  }
  return src;
}

function collectImageUrlsDeep(obj, pageUrl='', out=[], depth=0) {
  if (!obj || depth > 10 || out.length > 80) return out;
  if (typeof obj === 'string') {
    const s = decodePossibleImageUrl(obj, pageUrl);
    if (isUsefulPublicadorImage(s)) out.push(s);
    const re = /(https?:\\?\/\\?\/[^"'<>\s\\]+|https?:\/\/[^"'<>\s]+)/gi;
    let m;
    while ((m = re.exec(obj)) !== null && out.length < 80) {
      const u = decodePossibleImageUrl(m[1], pageUrl);
      if (isUsefulPublicadorImage(u)) out.push(u);
    }
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach(x => collectImageUrlsDeep(x, pageUrl, out, depth+1));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k,v] of Object.entries(obj)) {
      const key = String(k).toLowerCase();
      if (typeof v === 'string' && /(image|picture|photo|thumbnail|thumb|cover|src|url|secure_url|permalink)/i.test(key)) {
        const u = decodePossibleImageUrl(v, pageUrl);
        if (isUsefulPublicadorImage(u)) out.push(u);
      }
      collectImageUrlsDeep(v, pageUrl, out, depth+1);
    }
  }
  return out;
}

function extractJsonBlocksFromHtml(htmlStr) {
  const blocks = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(htmlStr || ''))) !== null) {
    const t = (m[1] || '').trim();
    if (!t) continue;
    const candidates = [];
    if (/^\s*[\[{]/.test(t)) candidates.push(t);
    const next = t.match(/self\.__next_f\.push\(\[\d+,\s*["']([\s\S]*?)["']\]\)/);
    if (next) candidates.push(next[1]);
    const state = t.match(/(?:window\.__PRELOADED_STATE__|__PRELOADED_STATE__|__INITIAL_STATE__|__NEXT_DATA__)\s*=\s*({[\s\S]*?})\s*;?\s*$/);
    if (state) candidates.push(state[1]);
    for (const c of candidates) {
      let cleaned = c;
      try { cleaned = JSON.parse('"' + cleaned.replace(/"/g,'\\"') + '"'); } catch {}
      try { blocks.push(JSON.parse(cleaned)); } catch { blocks.push(cleaned); }
    }
  }
  return blocks;
}

function extractPublicadorImages(htmlStr, pageUrl) {
  const images = [];
  const seen = new Set();
  function addImage(src) {
    src = normalizePublicadorImageUrl(src, pageUrl);
    if (!isUsefulPublicadorImage(src)) return;
    const clean = src.split('#')[0];
    if (seen.has(clean)) return;
    seen.add(clean);
    images.push(clean);
  }

  // Mantiene lo anterior: og/twitter/meta.
  const ogImg = getMetaContent(htmlStr, ['og:image', 'twitter:image', 'image']);
  if (ogImg) addImage(ogImg);

  // img/source srcset y data-srcset.
  const srcSetRegex = /<(?:img|source)[^>]+(?:srcset|data-srcset)=['"]([^'"]+)['"][^>]*>/gi;
  let sm;
  while ((sm = srcSetRegex.exec(htmlStr)) !== null && images.length < 30) {
    const candidates = sm[1].split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean);
    for (const c of candidates.reverse()) addImage(c);
  }

  // img, data-src, data-zoom, poster, links preload.
  const attrRegex = /<(?:img|source|link|meta|video)[^>]+(?:content|href|poster|data-zoom|data-full|data-src|data-original|data-lazy|src)=['"]([^'"]+)['"][^>]*>/gi;
  let m;
  while ((m = attrRegex.exec(htmlStr)) !== null && images.length < 40) addImage(m[1]);

  // URLs directas normales y escapadas dentro de JSON/scripts.
  const urlRegexes = [
    /https?:\\?\/\\?\/[^"'<>\s]+?(?:mlstatic\.com|makerworld|bambulab|bblmw\.com)[^"'<>\s]*/gi,
    /https?:\/\/[^"'<>\s]+?(?:\.jpg|\.jpeg|\.png|\.webp)(?:[^"'<>\s]*)?/gi,
    /https?%3A%2F%2F[^"'<>\s]+?(?:jpg|jpeg|png|webp|mlstatic\.com|bblmw\.com)[^"'<>\s]*/gi
  ];
  for (const re of urlRegexes) {
    let mm;
    while ((mm = re.exec(htmlStr)) !== null && images.length < 60) addImage(mm[0]);
  }

  // JSON interno (Next/MakerWorld/MercadoLibre). Captura cualquier campo tipo image/url/src profundo.
  for (const block of extractJsonBlocksFromHtml(htmlStr)) {
    collectImageUrlsDeep(block, pageUrl).forEach(addImage);
  }

  const isMeli = /mercadolibre\./i.test(pageUrl || '') || /mlstatic\.com/i.test(htmlStr || '');
  const ordered = isMeli
    ? [...images.filter(x => /mlstatic\.com/i.test(x)), ...images.filter(x => !/mlstatic\.com/i.test(x))]
    : images;
  return Array.from(new Set(ordered)).slice(0, 12);
}

function extractMeliIdsFromUrlOrHtml(url, htmlStr) {
  const rawUrl = String(url || '');
  const rawHtml = String(htmlStr || '');
  const decodedUrl = (() => { try { return decodeURIComponent(rawUrl); } catch { return rawUrl; } })();
  const decodedHtml = (() => { try { return decodeURIComponent(rawHtml); } catch { return rawHtml; } })();
  const text = `${decodedUrl} ${decodedHtml}`;

  function normItem(id) {
    if (!id) return '';
    id = String(id).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^\d+$/.test(id)) id = `MLU${id}`;
    return /^MLU\d{6,}$/.test(id) ? id : '';
  }
  function normCatalog(id) {
    if (!id) return '';
    id = String(id).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^MLU\d{6,}$/.test(id) ? id : '';
  }
  function normUserProduct(id) {
    if (!id) return '';
    id = String(id).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^MLUU\d{6,}$/.test(id) ? id : '';
  }

  let itemId = '';
  let catalogId = '';
  let userProductId = '';
  try {
    const u = new URL(decodedUrl);
    const paramsToCheck = ['item_id','itemId','itemIdFrom','item_id_from','recommended_item_id','wid','reco_item_id'];
    const hashParams = new URLSearchParams(String(u.hash || '').replace(/^#/, '').replace(/^polycard_client=/, 'polycard_client='));
    for (const p of paramsToCheck) {
      itemId = normItem(u.searchParams.get(p)) || normItem(hashParams.get(p));
      if (itemId) break;
    }
    const pdp = u.searchParams.get('pdp_filters') || u.searchParams.get('pdp_filters[]') || hashParams.get('pdp_filters') || '';
    if (!itemId && pdp) {
      const m = String(pdp).match(/(?:item_id|itemId)\s*[:=]\s*(MLU-?\d{6,})/i);
      if (m) itemId = normItem(m[1]);
    }
    const upm = u.pathname.match(/\/(?:up|user-products?)\/(MLUU-?\d{6,})/i);
    if (upm) userProductId = normUserProduct(upm[1]);
    const cm = u.pathname.match(/\/p\/(MLU-?\d{6,})/i);
    if (cm) catalogId = normCatalog(cm[1]);
    const im = u.pathname.match(/\/(MLU-?\d{6,})(?:[\/_-]|$)/i);
    if (im && !/\/p\//i.test(u.pathname)) itemId = itemId || normItem(im[1]);
  } catch {}

  if (!itemId) {
    const priorityPatterns = [
      /[?&#](?:wid|item_id|itemId|recommended_item_id)=\s*(MLU-?\d{6,})/i,
      /(?:wid|item_id|itemId|itemIdFrom|item_id_from|recommended_item_id)\s*[:=]\s*["']?(MLU-?\d{6,})/i,
      /(?:item_id|itemId|recommended_item_id|wid)[^A-Z0-9]{0,60}(MLU-?\d{6,})/i,
      /["'](?:item_id|itemId|id)["']\s*:\s*["'](MLU-?\d{6,})["']/i
    ];
    for (const re of priorityPatterns) {
      const m = text.match(re);
      if (m) { itemId = normItem(m[1]); break; }
    }
  }
  if (!catalogId) {
    const cm = text.match(/\/p\/(MLU-?\d{6,})/i) || text.match(/["']catalog_product_id["']\s*:\s*["'](MLU-?\d{6,})["']/i);
    if (cm) catalogId = normCatalog(cm[1]);
  }
  if (!userProductId) {
    const um = text.match(/\/(?:up|user-products?)\/(MLUU-?\d{6,})/i) || text.match(/\b(MLUU-?\d{6,})\b/i);
    if (um) userProductId = normUserProduct(um[1]);
  }
  if (!itemId) {
    const all = [...text.matchAll(/\b(MLU-?\d{8,})\b/gi)].map(m => normItem(m[1])).filter(Boolean);
    itemId = all.find(id => id !== catalogId) || '';
  }
  return { itemId, catalogId, userProductId };
}

function extractMeliItemIdFromUrlOrHtml(url, htmlStr) {
  return extractMeliIdsFromUrlOrHtml(url, htmlStr).itemId;
}

async function fetchMeliJson(url, token='') {
  try {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 TLC-Publicador/3.0',
      'X-Format-New': 'true'
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function imagesFromMeliObject(data) {
  const out = [];
  function addPic(p) {
    if (!p) return;
    if (typeof p === 'string') out.push(p);
    else out.push(p.secure_url || p.url || p.max_size || p.thumbnail || p.secure_thumbnail || p.src || p.picture || p.full_size || '');
  }
  if (Array.isArray(data)) data.forEach(x => imagesFromMeliObject(x).forEach(u => out.push(u)));
  if (Array.isArray(data?.pictures)) data.pictures.forEach(addPic);
  if (Array.isArray(data?.images)) data.images.forEach(addPic);
  if (Array.isArray(data?.results)) data.results.forEach(x => imagesFromMeliObject(x).forEach(u => out.push(u)));
  if (Array.isArray(data?.variations)) data.variations.forEach(v => imagesFromMeliObject(v).forEach(u => out.push(u)));
  if (data?.body) imagesFromMeliObject(data.body).forEach(u => out.push(u));
  const buyBox = data?.buy_box_winner || data?.buyBoxWinner;
  if (buyBox) imagesFromMeliObject(buyBox).forEach(u => out.push(u));
  collectImageUrlsDeep(data).forEach(u => out.push(u));
  return Array.from(new Set(out.filter(Boolean).map(u => normalizePublicadorImageUrl(u, ''))));
}

function collectMeliItemIdsDeep(obj, out = [], depth = 0) {
  if (!obj || depth > 8 || out.length > 30) return out;
  function add(v) {
    const id = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^MLU\d{6,}$/.test(id) && !out.includes(id)) out.push(id);
  }
  if (typeof obj === 'string') {
    for (const m of obj.matchAll(/\bMLU-?\d{6,}\b/gi)) add(m[0]);
    return out;
  }
  if (Array.isArray(obj)) { obj.forEach(x => collectMeliItemIdsDeep(x, out, depth + 1)); return out; }
  if (typeof obj === 'object') {
    for (const [k,v] of Object.entries(obj)) {
      if (/^(id|item_id|itemId|itemIdFrom|item_id_from|winner_item_id)$/i.test(k)) add(v);
      collectMeliItemIdsDeep(v, out, depth + 1);
    }
  }
  return out;
}

async function fetchMeliItemImagesFromPublicApi(itemId, catalogId = '', cuenta = '', userProductId = '') {
  const urls = [];
  const tried = new Set();
  function addEndpoint(u) { if (u && !tried.has(u)) { tried.add(u); urls.push(u); } }

  if (itemId) {
    addEndpoint(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`);
    addEndpoint(`https://api.mercadolibre.com/items?ids=${encodeURIComponent(itemId)}`);
  }
  if (userProductId) {
    addEndpoint(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}`);
    addEndpoint(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/items`);
  }
  if (catalogId) {
    addEndpoint(`https://api.mercadolibre.com/products/${encodeURIComponent(catalogId)}`);
    addEndpoint(`https://api.mercadolibre.com/products/${encodeURIComponent(catalogId)}/items`);
    addEndpoint(`https://api.mercadolibre.com/sites/MLU/search?catalog_product_id=${encodeURIComponent(catalogId)}`);
  }

  let token = '';
  if (cuenta) {
    try { token = await getMeliAccessToken(cuenta); } catch {}
  }

  const images = [];
  const itemIdsFound = new Set(itemId ? [itemId] : []);
  for (const endpoint of urls) {
    let data = await fetchMeliJson(endpoint);
    let found = imagesFromMeliObject(data);
    collectMeliItemIdsDeep(data).forEach(id => itemIdsFound.add(id));
    if ((!found.length || endpoint.includes('/user-products/')) && token) {
      data = await fetchMeliJson(endpoint, token);
      found = imagesFromMeliObject(data);
      collectMeliItemIdsDeep(data).forEach(id => itemIdsFound.add(id));
    }
    if (found.length) images.push(...found);
  }

  // Los links /p/ y /up/ a veces devuelven solo IDs de ofertas. Pedimos esas publicaciones reales.
  for (const id of Array.from(itemIdsFound).slice(0, 8)) {
    if (images.length >= 12) break;
    let data = await fetchMeliJson(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`);
    let found = imagesFromMeliObject(data);
    if (!found.length && token) {
      data = await fetchMeliJson(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`, token);
      found = imagesFromMeliObject(data);
    }
    if (found.length) images.push(...found);
  }

  return Array.from(new Set(images)).slice(0, 12);
}


function extractMakerWorldIdsFromUrl(url) {
  const raw = String(url || '');
  let designId = '';
  let profileId = '';
  const m1 = raw.match(/\/models\/(\d+)/i);
  if (m1) designId = m1[1];
  const m2 = raw.match(/[?#&]profileId[-=](\d+)/i) || raw.match(/profileId-(\d+)/i) || raw.match(/[?#&]profileId=(\d+)/i);
  if (m2) profileId = m2[1];
  return { designId, profileId };
}

function imagesFromMakerWorldObject(data) {
  const out = [];
  function add(v) {
    if (!v) return;
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'object') {
      out.push(v.url || v.src || v.image || v.imageUrl || v.cover || v.coverUrl || v.thumbnail || v.thumbnailUrl || v.largeUrl || v.originalUrl || v.fileUrl || '');
    }
  }
  if (!data) return [];
  if (Array.isArray(data)) data.forEach(x => imagesFromMakerWorldObject(x).forEach(add));
  if (typeof data === 'object') {
    const buckets = [
      data.images, data.imageList, data.pictures, data.pictureList, data.covers, data.coverImages,
      data.modelImages, data.renderImages, data.gallery, data.galleryImages, data.previewImages,
      data.data?.images, data.data?.imageList, data.data?.pictures, data.data?.coverImages,
      data.design?.images, data.design?.imageList, data.design?.pictures,
      data.model?.images, data.model?.imageList,
      data.instances, data.data?.instances, data.printProfiles, data.profiles
    ];
    buckets.forEach(b => {
      if (Array.isArray(b)) b.forEach(add);
      else add(b);
    });
    collectImageUrlsDeep(data).forEach(add);
  }
  return Array.from(new Set(out.filter(Boolean)));
}

async function fetchMakerWorldImagesFromPublicApi(pageUrl) {
  const ids = extractMakerWorldIdsFromUrl(pageUrl);
  if (!ids.designId) return [];
  const endpoints = [
    `https://api.bambulab.com/v1/design-service/design/${encodeURIComponent(ids.designId)}?trafficSource=browse&visitHistory=false`,
    `https://makerworld.com/api/v1/design-service/design/${encodeURIComponent(ids.designId)}?trafficSource=browse&visitHistory=false`,
    `https://api.bambulab.com/v1/design-service/design/${encodeURIComponent(ids.designId)}`,
    `https://makerworld.com/api/v1/design-service/design/${encodeURIComponent(ids.designId)}`,
  ];
  if (ids.profileId) {
    endpoints.push(`https://api.bambulab.com/v1/design-service/instance/${encodeURIComponent(ids.profileId)}/f3mf?type=preview`);
    endpoints.push(`https://makerworld.com/api/v1/design-service/instance/${encodeURIComponent(ids.profileId)}/f3mf?type=preview`);
  }
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    'Origin': 'https://makerworld.com',
    'Referer': pageUrl,
  };
  const images = [];
  for (const endpoint of endpoints) {
    try {
      const r = await fetch(endpoint, { headers, redirect: 'follow' });
      if (!r.ok) continue;
      const txt = await r.text();
      let data = null;
      try { data = JSON.parse(txt); } catch { data = txt; }
      imagesFromMakerWorldObject(data).forEach(u => images.push(u));
      // Tambien extrae URLs crudas si la respuesta vino como texto/JSON escapado.
      extractPublicadorImages(txt, pageUrl).forEach(u => images.push(u));
    } catch {}
  }
  return Array.from(new Set(images));
}

function mergePublicadorImages(primary = [], extra = [], pageUrl = '') {
  const out = [];
  const seen = new Set();
  for (const raw of [...extra, ...primary]) {
    const src = normalizePublicadorImageUrl(raw, pageUrl);
    if (!isUsefulPublicadorImage(src)) continue;
    const key = src.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 12) break;
  }
  return out;
}

function parseJsonLdProducts(htmlStr) {
  const found = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(htmlStr)) !== null) {
    try {
      const raw = decodeHtmlEntities(m[1]).trim();
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        if (!item) continue;
        if (item['@graph']) arr.push(...item['@graph']);
        const type = String(item['@type'] || '').toLowerCase();
        if (type.includes('product')) found.push(item);
      }
    } catch {}
  }
  return found;
}

function inferProductFacts(text, title) {
  const all = `${title || ''}\n${text || ''}`;
  const upper = all.toUpperCase();
  const facts = {};
  const knownBrands = ['INGCO','TOTAL','STANLEY','DEWALT','BLACK+DECKER','BLACK & DECKER','BOSCH','MAKITA','MILWAUKEE','TRAMONTINA','HOTECH'];
  facts.brand = knownBrands.find(b => upper.includes(b.replace('&', '&'))) || '';
  const modelMatch = upper.match(/\b([A-Z]{2,}[A-Z0-9-]{3,}\d{2,}[A-Z0-9-]*)\b/);
  if (modelMatch) facts.model = modelMatch[1];
  const diameter = all.match(/(115\s*mm|4\s*[½1\/2-]+\s*['"]?|4\s*1\/2|4½)/i);
  if (diameter) facts.diameter = diameter[1].replace(/\s+/g, ' ').trim();
  const voltage = all.match(/\b(12|18|20|21|40|42)\s*V\b/i);
  if (voltage) facts.voltage = `${voltage[1]}V`;
  const watts = all.match(/\b(\d{3,4})\s*W\b/i);
  if (watts) facts.power = `${watts[1]}W`;
  if (/BRUSHLESS|SIN CARBONES/i.test(all)) facts.motor = 'Brushless';
  if (/BATER[IÍ]A|BAT\b|INAL[AÁ]MBR|CORDLESS|P20S/i.test(all)) facts.powerSource = 'Batería';
  else if (/EL[ÉE]CTRICA|CABLE|220V|230V/i.test(all)) facts.powerSource = 'Eléctrica';
  if (/AMOLADORA|ESMERIL/i.test(all)) facts.productType = 'Amoladora angular';
  else if (/TALADRO/i.test(all)) facts.productType = 'Taladro';
  else if (/SIERRA/i.test(all)) facts.productType = 'Sierra';
  facts.includesBattery = !/BATER[IÍ]A\s+Y\s+CARGADOR\s+(SE\s+)?VENDEN\s+POR\s+SEPARADO|SOLD\s+SEPARATELY/i.test(all);
  if (/BATER[IÍ]A\s+Y\s+CARGADOR\s+(SE\s+)?VENDEN\s+POR\s+SEPARADO|SOLD\s+SEPARATELY/i.test(all)) facts.batteryNote = 'No incluye batería ni cargador';
  return facts;
}

function buildFallbackPublicadorContent(input) {
  const facts = inferProductFacts(input.scrapedDescription, input.scrapedTitle);
  const parts = [];
  if (facts.productType) parts.push(facts.productType);
  if (facts.brand) parts.push(facts.brand);
  if (facts.diameter) parts.push(facts.diameter.replace(/4\s*[½1\/2-]+\s*['"]?/i, '4 1/2'));
  if (facts.voltage) parts.push(facts.voltage);
  if (facts.motor) parts.push(facts.motor);
  if (facts.model) parts.push(facts.model);
  let title = parts.join(' ') || String(input.scrapedTitle || 'Producto').substring(0, 60);
  title = title.replace(/\s+/g, ' ').trim().substring(0, 60);

  const bullets = [];
  if (facts.productType) bullets.push(`Tipo de producto: ${facts.productType}.`);
  if (facts.brand) bullets.push(`Marca: ${facts.brand}.`);
  if (facts.model) bullets.push(`Modelo: ${facts.model}.`);
  if (facts.voltage) bullets.push(`Voltaje: ${facts.voltage}.`);
  if (facts.power) bullets.push(`Potencia: ${facts.power}.`);
  if (facts.diameter) bullets.push(`Diámetro de disco: ${facts.diameter}.`);
  if (facts.motor) bullets.push('Motor brushless sin carbones, con mejor eficiencia y menor mantenimiento.');
  if (facts.batteryNote) bullets.push(facts.batteryNote + '.');
  const base = bullets.length ? bullets.join('\n') : input.scrapedDescription;
  const desc = `${title}\n\n${base}\n\nProducto ideal para trabajos de corte, desbaste y mantenimiento. Revisá las características antes de comprar para confirmar que se ajusta al uso que necesitás.`;
  return {
    titulo_meli: title,
    descripcion_meli: desc.substring(0, 5000),
    condicion: 'new',
    tipo_publicacion: 'gold_special',
    brand: facts.brand || 'Generica',
    model: facts.model || '',
    productType: facts.productType || '',
    powerSource: facts.powerSource || '',
    voltage: facts.voltage || '',
    diameter: facts.diameter || '',
    motor: facts.motor || '',
    batteryNote: facts.batteryNote || '',
  };
}

function parsePublicadorHtml(html, pageUrl) {
  const htmlStr = typeof html === 'string' ? html : JSON.stringify(html || '');
  const jsonProducts = parseJsonLdProducts(htmlStr);
  const product = jsonProducts[0] || {};
  const h1 = htmlStr.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const titleTag = htmlStr.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitle = getMetaContent(htmlStr, ['og:title', 'twitter:title']);
  const metaDesc = getMetaContent(htmlStr, ['og:description', 'description', 'twitter:description']);
  const rawTitle = product.name || h1?.[1] || ogTitle || titleTag?.[1] || 'Producto sin titulo';

  let bodyText = cleanPublicadorText(htmlStr);
  const descriptionCandidates = [
    product.description,
    metaDesc,
    ...Array.from(htmlStr.matchAll(/<p[^>]*>([\s\S]{40,900}?)<\/p>/gi)).map(x => x[1]),
    ...Array.from(htmlStr.matchAll(/<li[^>]*>([\s\S]{10,250}?)<\/li>/gi)).map(x => x[1]),
  ].filter(Boolean).map(cleanPublicadorText).filter(Boolean);
  const rawDescription = descriptionCandidates.join('\n').substring(0, 2500) || bodyText.substring(0, 1200) || 'Sin descripcion disponible';
  const scrapedTitle = escapePlainText(rawTitle).replace(/\s*[-|]\s*INGCO.*$/i, '').substring(0, 300);
  const scrapedDescription = cleanPublicadorText(rawDescription).substring(0, 2500);
  const facts = inferProductFacts(scrapedDescription, scrapedTitle);
  return {
    scrapedTitle,
    scrapedDescription,
    images: extractPublicadorImages(htmlStr, pageUrl),
    extractedFacts: facts,
    brand: facts.brand || '',
    model: facts.model || '',
    productType: facts.productType || '',
    powerSource: facts.powerSource || '',
    voltage: facts.voltage || '',
    diameter: facts.diameter || '',
    motor: facts.motor || '',
    batteryNote: facts.batteryNote || '',
  };
}

async function generatePublicadorContent(input) {
  const fallback = buildFallbackPublicadorContent(input);
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || '';
  if (!apiKey) return { ...fallback, aiAvailable: false, aiNote: 'Falta OPENAI_API_KEY. Se genero una version inteligente local, pero sin IA real.' };
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.PUBLICADOR_OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Sos especialista en publicaciones de Mercado Libre Uruguay. Extraes marca, modelo, tipo de producto y atributos tecnicos desde paginas de proveedores. Responde SOLO JSON valido, sin markdown.' },
          { role: 'user', content: `Producto a analizar:\nURL: ${input.url}\nTITULO ORIGINAL: ${input.scrapedTitle}\nDESCRIPCION / DATOS EXTRAIDOS:\n${input.scrapedDescription}\n\nDatos detectados por reglas: ${JSON.stringify(input.extractedFacts || {})}\n\nDevolve SOLO este JSON:\n{\n  "titulo_meli": "maximo 60 caracteres, claro, con marca/modelo y dato clave",\n  "descripcion_meli": "descripcion comercial limpia en espanol, minimo 120 palabras, sin HTML y sin inventar caracteristicas",\n  "brand": "marca real",\n  "model": "modelo/codigo real",\n  "productType": "tipo de producto",\n  "powerSource": "Bateria / Electrica / Manual / Otro",\n  "voltage": "ej: 20V",\n  "diameter": "ej: 115 mm",\n  "motor": "ej: Brushless",\n  "batteryNote": "nota sobre bateria/cargador si corresponde",\n  "condicion": "new",\n  "tipo_publicacion": "gold_special"\n}` }
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || `OpenAI ${r.status}`);
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(String(raw).replace(/```json/gi, '').replace(/```/g, '').trim());
    return {
      ...fallback,
      ...parsed,
      titulo_meli: String(parsed.titulo_meli || fallback.titulo_meli).substring(0, 60),
      descripcion_meli: String(parsed.descripcion_meli || fallback.descripcion_meli).replace(/<[^>]+>/g, '').substring(0, 5000),
      brand: parsed.brand || fallback.brand,
      model: parsed.model || fallback.model,
      condicion: parsed.condicion || 'new',
      tipo_publicacion: parsed.tipo_publicacion || 'gold_special',
      aiAvailable: true,
    };
  } catch (e) {
    return { ...fallback, aiAvailable: false, aiNote: `No se pudo usar IA: ${e.message}. Se uso extraccion inteligente local.` };
  }
}

async function detectPublicadorCategory(title) {
  try {
    const url = new URL('https://api.mercadolibre.com/sites/MLU/domain_discovery/search');
    url.searchParams.set('q', title || 'producto');
    url.searchParams.set('limit', '1');
    const r = await fetch(url);
    const data = await r.json();
    const first = Array.isArray(data) ? data[0] : data;
    return { categoryId: first?.category_id || 'MLU1574', categoryName: first?.category_name || 'Otros', domainId: first?.domain_id || first?.domainId || '' };
  } catch {
    return { categoryId: 'MLU1574', categoryName: 'Otros' };
  }
}

async function getPublicadorCategoryAttributes(categoryId) {
  try {
    const r = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}/attributes`);
    const data = await r.json();
    const attrs = Array.isArray(data) ? data : [];
    return attrs.map(attr => ({
      id: attr.id,
      name: attr.name,
      value_type: attr.value_type || 'string',
      type: attr.type || '',
      tags: attr.tags || {},
      tooltip: attr.tooltip || '',
      hierarchy: attr.hierarchy || '',
      relevance: attr.relevance || 0,
      values: (attr.values || []).slice(0, 60).map(v => ({ id: v.id, name: v.name })),
    })).filter(a => a.id);
  } catch {
    return [];
  }
}

function isPublicadorRequiredAttr(attr) {
  const t = attr?.tags || {};
  const id = String(attr?.id || '').toUpperCase();
  return t.required === true || t.catalog_required === true || t.conditional_required === true || t.new_required === true || id === 'GTIN' || id === 'EMPTY_GTIN_REASON';
}

function addSyntheticSpecialRequirements(attrs, category = {}) {
  // v85: modo publicación rápida estable.
  // No agregamos campos sintéticos como SIZE_GRID_ID/SIZE_GRID_ROW_ID al formulario.
  // Esos IDs no son datos operativos que el usuario pueda conocer. Si Mercado Libre
  // exige grilla de talles, se informa claramente al publicar y se deja el borrador
  // guardado para terminarlo/editarlos en Mercado Libre.
  return Array.isArray(attrs) ? [...attrs] : [];
}

async function getPublicadorRequiredAttributes(categoryId, category = {}) {
  const all = await getPublicadorCategoryAttributes(categoryId);
  const enriched = addSyntheticSpecialRequirements(all, category);
  return enriched.filter(isPublicadorRequiredAttr);
}

function pickEmptyGtinReasonFromAttributes(requiredAttrs, preferred) {
  const prefRaw = String(preferred || '').trim().toLowerCase();
  const attr = (Array.isArray(requiredAttrs) ? requiredAttrs : []).find(a => String(a && a.id || '').toUpperCase() === 'EMPTY_GTIN_REASON');
  const values = Array.isArray(attr && attr.values) ? attr.values : [];
  function norm(x) { return String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  const priorities = [prefRaw, 'unregistered', 'no registrado', 'nao registrado', 'não registrado', 'otro', 'other', 'kit', 'artesanal', 'craft'].filter(Boolean);
  for (const want of priorities) {
    const nw = norm(want);
    const found = values.find(v => norm(v.name) === nw || norm(v.id) === nw || norm(v.name).includes(nw) || norm(v.id).includes(nw));
    if (found) return { id: 'EMPTY_GTIN_REASON', value_id: String(found.id || '').trim() || undefined, value_name: String(found.name || '').trim() || undefined };
  }
  // Para la API, en varias integraciones el valor correcto se manda como value_id textual:
  // unregistered / other / kit / craft. No usar value_name solo, porque Mercado Libre lo rechaza.
  const fallback = prefRaw && ['craft','kit','unregistered','other'].includes(prefRaw) ? prefRaw : 'unregistered';
  return { id: 'EMPTY_GTIN_REASON', value_id: fallback };
}

function buildPublicadorPayload(data) {
  let familyName = String(data.titulo_meli || data.scrapedTitle || 'Producto').replace(/\s+/g, ' ').trim().substring(0, 60);
  const requiredAttrs = Array.isArray(data.requiredAttributes) ? data.requiredAttributes : [];
  const noGtinLoaded = !String(data.gtin || data.GTIN || '').trim();
  const genericWithoutGtin = !!(data.noGtinGenericFallback || data.forceGenericNoGtin) && noGtinLoaded;
  if (genericWithoutGtin) {
    const realBrand = String(data.brand || '').trim();
    if (realBrand && realBrand.toLowerCase() !== 'generica' && realBrand.toLowerCase() !== 'genérica') {
      const safeBrand = realBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cleaned = familyName.replace(new RegExp('^\\s*' + safeBrand + '\\s*[-–—:]?\\s*', 'i'), '').replace(new RegExp('\\s+' + safeBrand + '\\s*$', 'i'), '').replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 8) familyName = cleaned.substring(0, 60);
    }
  }
  const attrDefaults = {
    BRAND: genericWithoutGtin ? 'Generica' : (data.brand || 'Generica'),
    MODEL: data.model || familyName.substring(0, 30),
    POWER_SUPPLY_TYPE: data.powerSource || 'Batería',
    POWER_SOURCE: data.powerSource || 'Batería',
    VOLTAGE: data.voltage || '',
    DISC_DIAMETER: data.diameter || '',
    DIAMETER: data.diameter || '',
    MOTOR_TYPE: data.motor || '',
    GTIN: data.gtin || data.GTIN || '',
    EMPTY_GTIN_REASON: data.emptyGtinReason || data.EMPTY_GTIN_REASON || 'No registrado',
    EMPTY_GTIN_REASON_ID: data.emptyGtinReasonId || data.EMPTY_GTIN_REASON_ID || '17055160',
  };

  // Para crear publicaciones, Mercado Libre rechaza atributos que no pertenecen
  // a la categoria. Por seguridad enviamos solo los atributos que MeLi devolvio
  // para la categoria detectada, mas los valores editados por el usuario.
  const allAttrsForPayload = Array.isArray(data.allAttributes) ? data.allAttributes : [];
  const allowedIds = new Set([...requiredAttrs, ...allAttrsForPayload].map(a => String(a.id || '').trim()).filter(Boolean));
  const hasGtinDefinition = requiredAttrs.some(a => String(a.id || '').toUpperCase() === 'GTIN');
  // Si el usuario carga GTIN manualmente, lo dejamos pasar aunque no venga en la lista visible.
  if (String(data.gtin || data.GTIN || '').trim()) allowedIds.add('GTIN');
  // Aunque algunas categorias no lo devuelven completo en /attributes, MeLi lo acepta como sustituto condicional del GTIN.
  allowedIds.add('EMPTY_GTIN_REASON');
  const attributes = [];
  function pushAttr(id, value) {
    id = String(id || '').trim();
    value = String(value || '').trim();
    if (!id || !value) return;
    if (allowedIds.size && !allowedIds.has(id)) return;
    if (attributes.some(a => String(a.id) === id)) return;
    attributes.push({ id, value_name: value });
  }
  function pushAttrObj(obj) {
    if (!obj || !obj.id) return;
    const id = String(obj.id).trim();
    if (!id) return;
    if (allowedIds.size && !allowedIds.has(id)) return;
    if (attributes.some(a => String(a.id) === id)) return;
    const clean = { id };
    if (obj.value_id !== undefined && obj.value_id !== null && String(obj.value_id).trim()) clean.value_id = String(obj.value_id).trim();
    if (obj.value_name !== undefined && obj.value_name !== null && String(obj.value_name).trim()) clean.value_name = String(obj.value_name).trim();
    if (clean.value_id || clean.value_name) attributes.push(clean);
  }

  const editedValues = data.attributeValues && typeof data.attributeValues === 'object' ? data.attributeValues : {};
  for (const id of Object.keys(editedValues || {})) { if (id && String(editedValues[id] || '').trim()) allowedIds.add(id); }
  for (const attr of requiredAttrs) {
    const id = String(attr.id || '').trim();
    if (!id) continue;
    const upperId = id.toUpperCase();
    const manual = editedValues[id];
    if (upperId === 'GTIN') {
      const gtin = manual !== undefined ? String(manual || '').trim() : String(attrDefaults.GTIN || '').trim();
      if (gtin) pushAttr(id, gtin);
      continue;
    }
    if (manual !== undefined && String(manual).trim()) {
      pushAttr(id, manual);
    } else if (attrDefaults[id]) {
      pushAttr(id, attrDefaults[id]);
    } else if (attr.values && attr.values.length) {
      pushAttr(id, attr.values[0].name);
    } else if (!['number', 'number_unit'].includes(attr.value_type)) {
      pushAttr(id, 'Estandar');
    }
  }

  const hasGtinValue = attributes.some(a => String(a.id || '').toUpperCase() === 'GTIN' && String(a.value_name || a.value_id || '').trim());
  const forceGenericNoGtin = genericWithoutGtin && !hasGtinValue;
  if (forceGenericNoGtin) {
    const idx = attributes.findIndex(a => String(a.id || '').toUpperCase() === 'BRAND');
    if (idx >= 0) attributes[idx] = { id: 'BRAND', value_name: 'Generica' };
    else attributes.unshift({ id: 'BRAND', value_name: 'Generica' });
    for (let i = attributes.length - 1; i >= 0; i--) {
      if (String(attributes[i].id || '').toUpperCase() === 'EMPTY_GTIN_REASON') attributes.splice(i, 1);
    }
  } else if (!hasGtinValue) {
    const preferredReason = data.emptyGtinReasonId || data.EMPTY_GTIN_REASON_ID || data.emptyGtinReason || data.EMPTY_GTIN_REASON || 'unregistered';
    pushAttrObj(pickEmptyGtinReasonFromAttributes(requiredAttrs, preferredReason));
  }


  // Si el producto es de moda/calzado y la IA puso SIZE = "Único" pero el título/descrición trae talles reales,
  // usamos el primer talle detectado. Esto evita enviar "Único" en zapatos/pantuflas con talle 38, 39, etc.
  try {
    const sizeIdx = attributes.findIndex(a => String(a.id || '').toUpperCase() === 'SIZE');
    const currentSize = sizeIdx >= 0 ? String(attributes[sizeIdx].value_name || attributes[sizeIdx].value_id || '').trim() : '';
    const textForSizes = [familyName, data.descripcion_meli, data.scrapedTitle, data.scrapedDescription].filter(Boolean).join(' ');
    const detectedSizes = extractAllNumericSizes(textForSizes).filter(x => /^\d{2}$/.test(String(x)));
    if (detectedSizes.length && (!currentSize || /^(único|unico|a medida)$/i.test(currentSize))) {
      if (sizeIdx >= 0) attributes[sizeIdx] = { id: 'SIZE', value_name: detectedSizes[0] };
      else attributes.push({ id: 'SIZE', value_name: detectedSizes[0] });
      data.sizeGuideRows = Array.isArray(data.sizeGuideRows) && data.sizeGuideRows.length ? data.sizeGuideRows : detectedSizes.slice(0, 12).map((n, i) => {
        const base = Number(String(n).match(/\d+/)?.[0] || 38);
        const from = (base >= 35 && base <= 45) ? (22.5 + (base - 35) * 0.5) : Math.max(20, base - 14);
        return { size: String(n), manufacturer_size: String(n), foot_from: String(from), foot_to: String(from + 0.5), publish: i === 0 };
      });
    }
  } catch {}

  return {
    // Mercado Libre en categorias catalogables/family_name rechaza title en el POST inicial.
    // El titulo visible queda controlado por family_name para esta llamada.
    family_name: familyName,
    category_id: data.categoryId || 'MLU1574',
    price: Number(data.price) || 100,
    currency_id: data.currency || 'UYU',
    available_quantity: Number(data.stock) || 50,
    buying_mode: 'buy_it_now',
    listing_type_id: data.tipo_publicacion || 'gold_special',
    condition: data.condicion || 'new',
    description: { plain_text: String(data.descripcion_meli || '').replace(/<[^>]+>/g, '').substring(0, 5000) || 'Producto importado automaticamente' },
    pictures: (Array.isArray(data.images) ? data.images : []).slice(0, 8).map(source => ({ source })),
    attributes,
  };
}



function normalizeEmptyGtinReason(reason) {
  if (reason && typeof reason === 'object') {
    const id = String(reason.id || reason.value_id || '').trim();
    const name = String(reason.name || reason.value_name || '').trim();
    if (id) return { value_id: id, value_name: name || undefined };
    if (name) return normalizeEmptyGtinReason(name);
  }
  const raw = String(reason || '').trim().toLowerCase();
  const map = {
    'artesanal': { value_id: 'craft' },
    'craft': { value_id: 'craft' },
    'kit': { value_id: 'kit' },
    'no registrado': { value_id: 'unregistered' },
    'não registrado': { value_id: 'unregistered' },
    'nao registrado': { value_id: 'unregistered' },
    'unregistered': { value_id: 'unregistered' },
    'otro': { value_id: 'other' },
    'other': { value_id: 'other' },
  };
  return map[raw] || { value_id: 'unregistered' };
}

function setEmptyGtinReasonOnPayload(payload, reason) {
  if (!payload || !Array.isArray(payload.attributes)) return;
  const normalized = normalizeEmptyGtinReason(reason || 'unregistered');
  payload.attributes = payload.attributes.filter(a => String(a.id || '').toUpperCase() !== 'EMPTY_GTIN_REASON');
  payload.attributes.push({ id: 'EMPTY_GTIN_REASON', value_id: normalized.value_id });
}

function getEmptyGtinReasonValuesFromDraft(draft) {
  const attrs = Array.isArray(draft && draft.requiredAttributes) ? draft.requiredAttributes : [];
  const attr = attrs.find(a => String(a.id || '').toUpperCase() === 'EMPTY_GTIN_REASON');
  const fromMeli = Array.isArray(attr && attr.values)
    ? attr.values.map(v => ({ id: String(v && v.id || '').trim(), name: String(v && v.name || '').trim() })).filter(v => v.id || v.name)
    : [];
  const fixed = [
    { id: 'unregistered', name: 'No registrado' },
    { id: 'other', name: 'Otro' },
    { id: 'craft', name: 'Artesanal' },
    { id: 'kit', name: 'Kit' },
  ];
  const seen = new Set();
  return [...fromMeli, ...fixed].filter(v => {
    const key = String(v.id || v.name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function forceGenericBrandNoGtinPayload(payload) {
  const clean = JSON.parse(JSON.stringify(payload || {}));
  const oldFamily = String(clean.family_name || clean.title || '').replace(/\s+/g, ' ').trim();
  const brandAttr = Array.isArray(clean.attributes) ? clean.attributes.find(a => String(a.id || '').toUpperCase() === 'BRAND') : null;
  const realBrand = String(brandAttr && (brandAttr.value_name || brandAttr.value_id) || '').trim();
  if (realBrand && !/^gen[eé]rica$/i.test(realBrand)) {
    const safeBrand = realBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleaned = oldFamily.replace(new RegExp('^\\s*' + safeBrand + '\\s*[-–—:]?\\s*', 'i'), '').replace(new RegExp('\\s+' + safeBrand + '\\s*$', 'i'), '').replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 8) clean.family_name = cleaned.substring(0, 60);
  }
  delete clean.title;
  clean.attributes = Array.isArray(clean.attributes) ? clean.attributes : [];
  clean.attributes = clean.attributes.filter(a => !['EMPTY_GTIN_REASON','GTIN'].includes(String(a.id || '').toUpperCase()));
  const idx = clean.attributes.findIndex(a => String(a.id || '').toUpperCase() === 'BRAND');
  if (idx >= 0) clean.attributes[idx] = { id: 'BRAND', value_name: 'Generica' };
  else clean.attributes.unshift({ id: 'BRAND', value_name: 'Generica' });
  clean._tlcNoGtinFallback = 'brand_generica';
  return clean;
}

function errorNeedsFashionGridRetry(response) {
  const txt = JSON.stringify(response || {});
  return /SIZE_GRID_ID|fashion_grid|missing\.fashion_grid/i.test(txt);
}


async function detectPublicadorCategoryCandidates(query, limit = 12) {
  try {
    const url = new URL('https://api.mercadolibre.com/sites/MLU/domain_discovery/search');
    url.searchParams.set('q', query || 'producto hogar');
    url.searchParams.set('limit', String(limit));
    const r = await fetch(url);
    const data = await r.json().catch(() => []);
    const arr = Array.isArray(data) ? data : (data ? [data] : []);
    const seen = new Set();
    return arr.map(x => ({
      categoryId: x?.category_id || '',
      categoryName: x?.category_name || '',
      domainId: x?.domain_id || x?.domainId || '',
    })).filter(x => {
      if (!x.categoryId || seen.has(x.categoryId)) return false;
      seen.add(x.categoryId);
      return true;
    });
  } catch {
    return [];
  }
}

async function categoryRequiresFashionGrid(categoryId) {
  const attrs = await getPublicadorCategoryAttributes(categoryId);
  return attrs.some(a => String(a.id || '').toUpperCase() === 'SIZE_GRID_ID' && isPublicadorRequiredAttr(a));
}

function buildDraftForAlternateCategory(originalDraft, category, allAttributes) {
  const draft = JSON.parse(JSON.stringify(originalDraft || {}));
  draft.categoryId = category.categoryId;
  draft.categoryName = category.categoryName || 'Categoria alternativa';
  draft.domainId = category.domainId || '';
  draft.allAttributes = Array.isArray(allAttributes) ? allAttributes : [];
  draft.requiredAttributes = addSyntheticSpecialRequirements(draft.allAttributes, category).filter(isPublicadorRequiredAttr);
  draft.noGtinGenericFallback = true;
  draft.forceGenericNoGtin = true;
  // Si caemos a categoria alternativa, evitamos arrastrar atributos especificos de moda que generan grillas.
  draft.attributeValues = draft.attributeValues && typeof draft.attributeValues === 'object' ? { ...draft.attributeValues } : {};
  delete draft.attributeValues.SIZE_GRID_ID;
  delete draft.attributeValues.SIZE_GRID_ROW_ID;
  return draft;
}

async function findQuickPublishCategoryWithoutFashionGrid(payload, draft) {
  const baseName = String(payload?.family_name || draft?.titulo_meli || draft?.scrapedTitle || 'producto').replace(/\s+/g, ' ').trim();
  const genericQueries = [
    baseName,
    baseName.replace(/\b(botas?|zapatos?|pantuflas?|calzado|talle|talles|mujer|hombre|niño|niña|unisex)\b/gi, ' ').replace(/\s+/g, ' ').trim(),
    'producto hogar decoracion',
    'producto para el hogar',
    'articulo hogar',
    'otros productos hogar'
  ].filter(Boolean);
  const tried = new Set();
  const errors = [];
  for (const q of genericQueries) {
    const candidates = await detectPublicadorCategoryCandidates(q, 12);
    for (const cat of candidates) {
      if (!cat.categoryId || tried.has(cat.categoryId) || cat.categoryId === 'MLU1574') continue;
      tried.add(cat.categoryId);
      const attrs = await getPublicadorCategoryAttributes(cat.categoryId);
      const hasGrid = attrs.some(a => String(a.id || '').toUpperCase() === 'SIZE_GRID_ID' && isPublicadorRequiredAttr(a));
      if (hasGrid) { errors.push(`${cat.categoryId} ${cat.categoryName}: requiere grilla`); continue; }
      // Debe ser una categoria hoja publicable; si no es hoja, MeLi avisara en el POST.
      return { ...cat, allAttributes: attrs, searchQuery: q, tried: Array.from(tried), errors };
    }
  }
  return { categoryId: '', categoryName: '', allAttributes: [], tried: Array.from(tried), errors };
}

async function tryQuickPublishWithoutFashionGrid(cuenta, token, payload, draft) {
  // v88: primero intenta crear/reusar grilla real de talles; si no, prueba categorias alternativas.
  // Esto evita quedar trabado cuando MeLi exige SIZE_GRID_ID en moda/calzado.
  const baseName = String(payload?.family_name || draft?.titulo_meli || draft?.scrapedTitle || 'producto').replace(/\s+/g, ' ').trim();
  const genericQueries = [
    baseName,
    baseName.replace(/\b(botas?|zapatos?|pantuflas?|calzado|talle|talles|mujer|hombre|niño|niña|unisex)\b/gi, ' ').replace(/\s+/g, ' ').trim(),
    'producto hogar decoracion',
    'producto para el hogar',
    'articulo hogar',
    'otros productos hogar',
    'souvenir regalo hogar',
    'accesorio hogar'
  ].filter(Boolean);

  const tried = new Set();
  const attempts = [];

  async function postCandidate(cat, attrs, searchQuery) {
    const altDraft = buildDraftForAlternateCategory(draft, cat, attrs || []);
    let altPayload = cleanMeliCreatePayload(buildPublicadorPayload(altDraft));
    altPayload.category_id = cat.categoryId;
    delete altPayload.title;
    delete altPayload.variations;

    // Mantener payload simple: familia + stock raiz, sin atributos de talle/grilla.
    if (!altPayload.available_quantity) altPayload.available_quantity = Number(payload.available_quantity || draft.stock || 50) || 50;
    altPayload.attributes = Array.isArray(altPayload.attributes) ? altPayload.attributes.filter(a => !['SIZE_GRID_ID','SIZE_GRID_ROW_ID','SIZE','GENDER'].includes(String(a.id || '').toUpperCase())) : [];
    const brandIdx = altPayload.attributes.findIndex(a => String(a.id || '').toUpperCase() === 'BRAND');
    if (brandIdx >= 0) altPayload.attributes[brandIdx] = { id: 'BRAND', value_name: 'Generica' };
    else altPayload.attributes.unshift({ id: 'BRAND', value_name: 'Generica' });

    const r = await fetch('https://api.mercadolibre.com/items', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(cleanMeliCreatePayload(altPayload)),
    });
    const raw = await r.text();
    let response = null;
    try { response = raw ? JSON.parse(raw) : {}; } catch { response = { raw }; }
    let descriptionResult = null;
    if (r.ok && response?.id) {
      descriptionResult = await postMeliItemDescription(token, response.id, altPayload?.description?.plain_text || payload?.description?.plain_text);
      response._tlc_description_result = descriptionResult;
    }
    return { ok: r.ok && !!response?.id, status: r.status, response, payload: altPayload, alt: { ...cat, searchQuery }, descriptionResult };
  }

  for (const q of genericQueries) {
    const candidates = await detectPublicadorCategoryCandidates(q, 12);
    for (const cat of candidates) {
      if (!cat.categoryId || tried.has(cat.categoryId) || cat.categoryId === 'MLU1574') continue;
      tried.add(cat.categoryId);
      let attrs = [];
      try { attrs = await getPublicadorCategoryAttributes(cat.categoryId); } catch { attrs = []; }
      const hasGrid = attrs.some(a => String(a.id || '').toUpperCase() === 'SIZE_GRID_ID' && isPublicadorRequiredAttr(a));
      if (hasGrid) {
        attempts.push(`${cat.categoryId} ${cat.categoryName || ''}: requiere grilla`);
        continue;
      }
      const attempt = await postCandidate(cat, attrs, q);
      if (attempt.ok) {
        attempt.tried = Array.from(tried);
        attempt.attempts = attempts;
        return attempt;
      }
      const causes = Array.isArray(attempt.response?.cause) ? attempt.response.cause.map(c => [c.code, c.message].filter(Boolean).join(': ')).filter(Boolean) : [];
      attempts.push(`${cat.categoryId} ${cat.categoryName || ''}: ${attempt.response?.error || attempt.response?.message || 'error'}${causes.length ? ' - ' + causes.join(' | ') : ''}`.trim());
    }
  }

  return { ok: false, message: 'No encontre una categoria alternativa publicable sin grilla de talles.', alt: { tried: Array.from(tried), errors: attempts.slice(0, 20) } };
}

function getAttrValueFromPayload(payload, id) {
  const attr = (Array.isArray(payload && payload.attributes) ? payload.attributes : [])
    .find(a => String(a && a.id || '').toUpperCase() === String(id || '').toUpperCase());
  return String(attr && (attr.value_name || attr.value_id) || '').trim();
}

function extractFirstNumericSize(value, fallbackText) {
  const text = `${value || ''} ${fallbackText || ''}`;
  const m = text.match(/\b(\d{1,2})(?:\s*[-\/ ]\s*\d{1,2})?\b/);
  return m ? m[1] : String(value || '').trim() || 'Unico';
}

function extractFootLengthCm(text) {
  const s = String(text || '');
  const m = s.match(/(?:suela|pie|plantilla|largo)[^\d]{0,30}(\d{2}(?:[.,]\d)?)\s*cm/i) || s.match(/\b(\d{2}(?:[.,]\d)?)\s*cm\b/i);
  if (!m) return '';
  return String(m[1]).replace(',', '.') + ' cm';
}

function normalizeMeliChartDomainId(rawDomainId) {
  return String(rawDomainId || '').trim().toUpperCase();
}

function stripMeliSiteFromDomain(rawDomainId) {
  return normalizeMeliChartDomainId(rawDomainId).replace(/^(MLU|MLA|MLB|MLM|MCO|MPE|MLC|MEC)-/i, '').toUpperCase();
}

function chartDomainCandidates(rawDomainId) {
  const raw = normalizeMeliChartDomainId(rawDomainId);
  const stripped = stripMeliSiteFromDomain(rawDomainId);
  const out = [];
  function add(domain_id, includeSite, label) {
    if (!domain_id) return;
    const key = domain_id + '::' + (includeSite ? 'site' : 'nosite');
    if (out.some(x => x.key === key)) return;
    out.push({ key, domain_id, includeSite, label });
  }
  // Segun la documentacion de guias de talle, el POST /catalog/charts recibe normalmente
  // domain_id sin prefijo de sitio + site_id. Dejamos variantes para compatibilidad porque
  // algunas respuestas de domain_discovery vienen como MLU-SLIPPERS.
  add(stripped, true, 'stripped_with_site');
  add(raw, false, 'raw_no_site');
  add(raw, true, 'raw_with_site');
  add(stripped, false, 'stripped_no_site');
  return out;
}

function meliGenderValue(genderText) {
  const t = String(genderText || '').toLowerCase();
  if (/hombre|masculino|man\b/.test(t)) return { id: '339666', name: 'Hombre' };
  if (/niña|nina|girl/.test(t)) return { id: '339668', name: 'Niñas' };
  if (/niño|nino|boy/.test(t)) return { id: '339667', name: 'Niños' };
  if (/beb[eé]|infantil|kid/.test(t)) return { id: '1915949', name: 'Sin género infantil' };
  if (/unisex|sin g[eé]nero|gender neutral/.test(t)) return { id: '110461', name: 'Sin género' };
  return { id: '339665', name: 'Mujer' };
}

function formatSizeForChart(size, mainAttr) {
  const n = extractFirstNumericSize(size, size);
  const id = String(mainAttr || '').toUpperCase();
  if ((id === 'AR_SIZE' || id === 'W_AR_SIZE' || id === 'M_AR_SIZE') && /^\d+$/.test(n)) return n + ' AR';
  if (id === 'UY_SIZE' && /^\d+$/.test(n)) return n + ' UY';
  return n;
}

function extractAllNumericSizes(text) {
  const t = String(text || '');
  const out = [];
  const ranges = t.match(/\b(\d{2})\s*[-–/]\s*(\d{2})\b/g) || [];
  for (const r of ranges) {
    const m = r.match(/(\d{2})\D+(\d{2})/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      if (a >= 15 && a <= 60 && b >= a && b <= 60 && b - a <= 8) {
        for (let n = a; n <= b; n++) out.push(String(n));
      }
    }
  }
  const singles = t.match(/\b(?:talle|t|nro|numero|número)?\s*(\d{2})\b/gi) || [];
  for (const x of singles) {
    const m = x.match(/(\d{2})/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 15 && n <= 60) out.push(String(n));
    }
  }
  const uniq = [];
  for (const x of out) if (!uniq.includes(x)) uniq.push(x);
  return uniq.length ? uniq : [extractFirstNumericSize(text, text) || '38'];
}

function chartMainAttributeCandidates(payload, draft) {
  const gender = getAttrValueFromPayload(payload, 'GENDER') || String(draft && draft.gender || 'Mujer');
  const g = meliGenderValue(gender).name;
  // En calzado MeLi suele aceptar el talle local como AR_SIZE. Dejamos varias alternativas
  // porque el atributo principal depende del dominio/ficha tecnica de MeLi.
  if (/hombre/i.test(g)) return ['UY_SIZE', 'AR_SIZE', 'M_AR_SIZE', 'MANUFACTURER_SIZE', 'SIZE'];
  if (/mujer/i.test(g)) return ['UY_SIZE', 'AR_SIZE', 'W_AR_SIZE', 'MANUFACTURER_SIZE', 'SIZE'];
  return ['UY_SIZE', 'AR_SIZE', 'MANUFACTURER_SIZE', 'SIZE'];
}


async function getMeliUserIdFromToken(token) {
  try {
    const r = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const j = await r.json().catch(() => ({}));
    return j && j.id ? Number(j.id) : null;
  } catch {
    return null;
  }
}


function parseMeliSizeChartId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // URLs del editor web de Mercado Libre Uruguay tienen esta forma:
  // /moda/talles/221081730-baba7d83-e348-4819-a7a7-3db02eb5a08e/modificar/2300121
  // El ID real de la guía es TODO el segmento después de /talles/, no solo el primer número.
  let m = raw.match(/\/talles\/([^\/?#]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]).trim();

  // También aceptamos URLs/endpoints de API o valores pegados manualmente.
  m = raw.match(/\/catalog\/charts\/([^\/?#]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]).trim();

  // ID compuesto típico de grilla: número + UUID.
  m = raw.match(/\b(\d{5,}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  if (m) return m[1];

  // Fallback histórico: algunos endpoints/devuelven solo número.
  m = raw.match(/\b([0-9]{5,})\b/);
  return m ? m[1] : '';
}

function meliSizeChartIdCandidates(value) {
  const raw = String(value || '').trim();
  const first = parseMeliSizeChartId(raw);
  const out = [];
  function add(x) { x = String(x || '').trim(); if (x && !out.includes(x)) out.push(x); }
  add(first);
  // Si viene ID compuesto, probamos también el prefijo numérico porque algunos endpoints lo usan.
  const prefix = first.match(/^(\d{5,})-/);
  if (prefix) add(prefix[1]);
  const anyNum = raw.match(/\b([0-9]{5,})\b/);
  if (anyNum) add(anyNum[1]);
  return out;
}

async function fetchMeliSizeChartById(token, chartId) {
  const ids = meliSizeChartIdCandidates(chartId);
  if (!ids.length) return null;
  const urls = [];
  for (const id of ids) {
    urls.push(`https://api.mercadolibre.com/catalog/charts/${encodeURIComponent(id)}`);
    urls.push(`https://api.mercadolibre.com/catalog/charts/${encodeURIComponent(id)}?site_id=MLU`);
  }
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }});
      const txt = await r.text();
      let j = null;
      try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
      if (r.ok && j && (j.id || Array.isArray(j.rows))) return j;
    } catch {}
  }
  return null;
}

function normalizeSizeTokenForCompare(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/,/g,'.').replace(/[^0-9a-z.]+/g,'');
}

function findMeliSizeChartRow(chart, wantedSize) {
  const rows = Array.isArray(chart && chart.rows) ? chart.rows : [];
  if (!rows.length) return null;
  const wantedRaw = String(wantedSize || '').trim();
  const wanted = normalizeSizeTokenForCompare(wantedRaw);
  const wantedNum = (wantedRaw.match(/\d+(?:[.,]\d+)?/) || [''])[0].replace(',', '.');
  for (const row of rows) {
    const attrs = Array.isArray(row.attributes) ? row.attributes : [];
    const txt = normalizeSizeTokenForCompare(JSON.stringify(attrs));
    if (wanted && txt.includes(wanted)) return row;
    if (wantedNum && new RegExp(`(^|[^0-9])${wantedNum.replace('.', '\\.')}(?:[^0-9]|$)`).test(txt)) return row;
  }
  return rows[0] || null;
}

function applySizeGridToRootPayload(basePayload, chartId, rowId) {
  const p = JSON.parse(JSON.stringify(basePayload || {}));
  p.attributes = Array.isArray(p.attributes) ? p.attributes.filter(a => !['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(String(a.id || '').toUpperCase())) : [];
  p.attributes.push({ id: 'SIZE_GRID_ID', value_name: String(chartId) });
  p.attributes.push({ id: 'SIZE_GRID_ROW_ID', value_name: String(rowId) });
  delete p.title;
  delete p.variations;
  return p;
}

async function useProvidedFashionSizeChart(token, payload, draft, selectedSize) {
  const raw = draft && (draft.sizeChartIdOrUrl || draft.sizeChartUrl || draft.sizeGridUrl || draft.sizeGridId || draft.SIZE_GRID_ID || draft.attributeValues?.SIZE_GRID_ID);
  const chartId = parseMeliSizeChartId(raw);
  if (!chartId) return null;
  const chart = await fetchMeliSizeChartById(token, chartId);
  if (!chart) throw new Error('No pude leer la guía de talles indicada en Mercado Libre. Verificá que la guía sea de la misma cuenta y esté guardada.');
  const row = findMeliSizeChartRow(chart, selectedSize);
  if (!row || !row.id) throw new Error('Leí la guía, pero no encontré una fila de talle compatible con ' + selectedSize + '.');
  return {
    payload: applySizeGridToRootPayload(payload, chart.id || chartId, row.id),
    variationPayload: buildFashionVariationPayload(payload, chart.id || chartId, row.id, { size: selectedSize || getAttrValueFromPayload(payload, 'SIZE') || '38' }),
    chart,
    chartAttempt: 'provided_chart'
  };
}

function pickSizeChartFromSearchResponse(data, wantedSize) {
  const charts = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : (Array.isArray(data?.charts) ? data.charts : []));
  const sizeText = String(wantedSize || '').toLowerCase().replace(/[^0-9a-z]/g, '');
  for (const chart of charts) {
    const rows = Array.isArray(chart?.rows) ? chart.rows : [];
    if (!rows.length) continue;
    let row = rows[0];
    for (const r of rows) {
      const attrs = Array.isArray(r.attributes) ? r.attributes : [];
      const txt = JSON.stringify(attrs).toLowerCase().replace(/[^0-9a-z]/g, '');
      if (sizeText && txt.includes(sizeText)) { row = r; break; }
    }
    if (chart.id && row && row.id) return { chart, row };
  }
  return null;
}

async function searchExistingFashionSizeChart(token, rawDomainId, genderValue, size) {
  const sellerId = await getMeliUserIdFromToken(token);
  if (!sellerId) return null;
  const domain = stripMeliSiteFromDomain(rawDomainId);
  const bodies = [
    { domain_id: domain, site_id: 'MLU', type: 'SPECIFIC', seller_id: sellerId, attributes: [{ id: 'GENDER', values: [{ id: genderValue.id, value: genderValue.name, name: genderValue.name }] }] },
    { domain_id: domain, site_id: 'MLU', seller_id: sellerId, attributes: [{ id: 'GENDER', values: [{ id: genderValue.id, value: genderValue.name, name: genderValue.name }] }] },
    { domain_id: domain, site_id: 'MLU', type: 'SPECIFIC', seller_id: sellerId }
  ];
  for (const body of bodies) {
    try {
      const r = await fetch('https://api.mercadolibre.com/catalog/charts/search', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      const j = txt ? JSON.parse(txt) : {};
      if (r.ok) {
        const found = pickSizeChartFromSearchResponse(j, size);
        if (found) return { ...found, searchPayload: body };
      }
    } catch {}
  }
  return null;
}


function normalizeCmNumber(v){
  const m=String(v||'').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m?m[0]:'';
}
function normalizeManualSizeGuideRows(draft, fallbackText){
  const rows=Array.isArray(draft&&draft.sizeGuideRows)?draft.sizeGuideRows:[];
  const clean=[];
  for(const r of rows){
    const size=String(r.size||r.uy_size||r.UY_SIZE||r.manufacturer_size||'').trim();
    if(!size)continue;
    const from=normalizeCmNumber(r.foot_from||r.footLengthFrom||r.from||'');
    const to=normalizeCmNumber(r.foot_to||r.footLengthTo||r.to||'');
    clean.push({size, manufacturer_size:String(r.manufacturer_size||size).trim(), foot_from:from, foot_to:to, publish:!!r.publish});
  }
  if(clean.length){ if(!clean.some(r=>r.publish)) clean[0].publish=true; return clean; }
  const nums=extractAllNumericSizes(fallbackText||'');
  return nums.map((n,i)=>{
    const base=Number(String(n).match(/\d+/)?.[0]||38);
    const from=(base>=35&&base<=45)?(22.5+(base-35)*0.5):Math.max(20,base-14);
    return {size:String(n), manufacturer_size:String(n), foot_from:String(from), foot_to:String(from+0.5), publish:i===0};
  });
}
async function getGridSpecMainCandidates(token, rawDomainId){
  const out=[];
  for(const cand of chartDomainCandidates(rawDomainId)){
    try{
      const r=await fetch(`https://api.mercadolibre.com/domains/${encodeURIComponent(cand.domain_id)}/technical_specs?section=grids`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json'},body:'{}'});
      const j=await r.json().catch(()=>({}));
      const txt=JSON.stringify(j||{});
      const re=/"id"\s*:\s*"([A-Z0-9_]*SIZE[A-Z0-9_]*)"/g;
      let m; while((m=re.exec(txt))){
        const id=m[1];
        if(!out.includes(id)&&!['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(id)) out.push(id);
      }
    }catch{}
  }
  return out;
}
function attrTagsArray(a) {
  const t = a && a.tags;
  if (Array.isArray(t)) return t.map(x => String(x || '').toLowerCase());
  if (t && typeof t === 'object') return Object.keys(t).filter(k => t[k]).map(k => String(k || '').toLowerCase());
  return [];
}

function walkTechnicalSpecAttributes(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node.attributes)) {
    for (const a of node.attributes) if (a && a.id) out.push(a);
  }
  if (Array.isArray(node.components)) {
    for (const c of node.components) walkTechnicalSpecAttributes(c, out);
  }
  if (node.input) walkTechnicalSpecAttributes(node.input, out);
  if (Array.isArray(node.groups)) {
    for (const g of node.groups) walkTechnicalSpecAttributes(g, out);
  }
  return out;
}

async function getFashionGridTechnicalSpec(token, rawDomainId, genderValue) {
  const domains = chartDomainCandidates(rawDomainId).map(x => x.domain_id);
  const seen = new Set();
  let lastError = '';
  for (const domain of domains) {
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const bodies = [
      {
        domain_id: domain,
        site_id: 'MLU',
        type: 'SPECIFIC',
        attributes: [{ id: 'GENDER', values: [{ id: genderValue.id, value: genderValue.name, name: genderValue.name }] }]
      },
      {
        site_id: 'MLU',
        type: 'SPECIFIC',
        attributes: [{ id: 'GENDER', values: [{ id: genderValue.id, value: genderValue.name, name: genderValue.name }] }]
      },
      {}
    ];
    for (const body of bodies) {
      try {
        const r = await fetch(`https://api.mercadolibre.com/domains/${encodeURIComponent(domain)}/technical_specs?section=grids`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body),
        });
        const txt = await r.text();
        let j = null;
        try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
        if (!r.ok) {
          lastError = (j && (j.message || j.error)) || `technical_specs ${r.status}`;
          continue;
        }
        const attrs = walkTechnicalSpecAttributes(j, []);
        if (!attrs.length) continue;
        const mainCandidates = [];
        const rowRequired = [];
        const globalRequired = [];
        for (const a of attrs) {
          const id = String(a.id || '').toUpperCase();
          const tags = attrTagsArray(a);
          const isMain = tags.includes('main_attribute_candidate');
          const isRequired = tags.includes('required');
          const isGridFilter = tags.includes('grid_filter') || tags.includes('grid_template_required') || tags.includes('fixed');
          if (isMain && !mainCandidates.includes(id)) mainCandidates.push(id);
          if (isRequired) {
            if (isGridFilter || ['GENDER','BRAND'].includes(id)) {
              if (!globalRequired.some(x => String(x.id || '').toUpperCase() === id)) globalRequired.push(a);
            } else {
              if (!rowRequired.some(x => String(x.id || '').toUpperCase() === id)) rowRequired.push(a);
            }
          }
        }
        return { domain, raw: j, attrs, mainCandidates, rowRequired, globalRequired, sourceBody: body };
      } catch (e) {
        lastError = e.message || String(e);
      }
    }
  }
  return { domain: stripMeliSiteFromDomain(rawDomainId), attrs: [], mainCandidates: [], rowRequired: [], globalRequired: [], error: lastError };
}

function valueForSizeChartAttribute(attrId, row, genderValue, brand, mainAttr) {
  const id = String(attrId || '').toUpperCase();
  const rawSize = String(row.size || row.manufacturer_size || '38').trim();
  if (id === 'GENDER') return { id: genderValue.id, name: genderValue.name };
  if (id === 'BRAND') return { name: brand || 'Generica' };
  if (id === 'FOOT_LENGTH') {
    const v = normalizeCmNumber(row.foot_from || row.foot_to || '');
    return { name: (v || '24') + ' cm' };
  }
  if (id === 'FOOT_LENGTH_TO') {
    const v = normalizeCmNumber(row.foot_to || row.foot_from || '');
    return { name: (v || '24.5') + ' cm' };
  }
  if (id === 'MANUFACTURER_SIZE') return { name: String(row.manufacturer_size || rawSize) };
  if (id.endsWith('_SIZE') || id === 'SIZE') return { name: formatSizeForChart(rawSize, id) };
  return { name: String(row[id] || row[id.toLowerCase()] || row.manufacturer_size || rawSize || 'Estándar') };
}

function makeChartRowAttributes(spec, mainAttr, row, genderValue, brand) {
  const ids = [];
  function add(id) {
    id = String(id || '').toUpperCase();
    if (!id || ids.includes(id)) return;
    ids.push(id);
  }
  add(mainAttr);
  for (const a of spec.rowRequired || []) add(a.id);
  // En calzado de Uruguay suele aparecer FOOT_LENGTH como requerido aunque el endpoint a veces no lo devuelva claramente.
  if (!ids.includes('FOOT_LENGTH')) add('FOOT_LENGTH');
  const attrs = [];
  for (const id of ids) {
    if (['GENDER','BRAND','SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(id)) continue;
    attrs.push({ id, values: [valueForSizeChartAttribute(id, row, genderValue, brand, mainAttr)] });
  }
  return attrs;
}

function buildFashionVariationPayload(basePayload, chartId, rowId, row) {
  const p = JSON.parse(JSON.stringify(basePayload || {}));
  const title = String(p.family_name || p.title || 'Producto').substring(0, 60);
  delete p.family_name;
  p.title = title;
  const qty = Number(p.available_quantity || 1) || 1;
  delete p.available_quantity;
  p.attributes = Array.isArray(p.attributes) ? p.attributes.filter(a => !['SIZE_GRID_ID','SIZE_GRID_ROW_ID','SIZE'].includes(String(a.id || '').toUpperCase())) : [];
  const color = getAttrValueFromPayload(basePayload, 'COLOR') || 'Marrón';
  const sizeName = String(row && row.size || getAttrValueFromPayload(basePayload, 'SIZE') || '38');
  p.variations = [{
    price: Number(p.price || 0) || 1,
    available_quantity: qty,
    attribute_combinations: [
      { id: 'COLOR', value_name: color },
      { id: 'SIZE', value_name: sizeName }
    ],
    attributes: [
      { id: 'SIZE_GRID_ID', value_name: String(chartId) },
      { id: 'SIZE_GRID_ROW_ID', value_name: String(rowId) }
    ]
  }];
  return p;
}

async function createFashionSizeChartForPayload(cuenta, token, payload, draft) {
  const rawDomainId = String(draft && (draft.domainId || draft.domain_id || draft.domain) || '').trim();
  if (!rawDomainId) throw new Error('Falta domain_id de Mercado Libre para crear grilla de talles. Usá Reanalizar producto y volvé a intentar.');

  const gender = getAttrValueFromPayload(payload, 'GENDER') || String(draft.gender || draft.GENDER || 'Mujer').trim() || 'Mujer';
  const genderValue = meliGenderValue(gender);
  const brand = getAttrValueFromPayload(payload, 'BRAND') || String(draft.brand || 'Generica').trim() || 'Generica';
  const sizeRaw = getAttrValueFromPayload(payload, 'SIZE') || String(draft.size || draft.SIZE || '').trim() || String(payload.family_name || '38');
  const fallbackText = `${sizeRaw} ${payload.family_name || ''} ${payload.description && payload.description.plain_text || ''} ${draft.scrapedDescription || ''}`;
  const guideRows = normalizeManualSizeGuideRows(draft, fallbackText);
  const selectedRow = guideRows.find(r => r.publish) || guideRows[0] || { size: extractFirstNumericSize(sizeRaw, fallbackText) || '38', foot_from: '24', foot_to: '24.5', manufacturer_size: '38', publish: true };
  const providedChart = await useProvidedFashionSizeChart(token, payload, draft, selectedRow.size || sizeRaw);
  if (providedChart) return providedChart;
  const chartName = `TLC ${String(payload.family_name || 'Guia de talles').substring(0, 42)}`;
  const spec = await getFashionGridTechnicalSpec(token, rawDomainId, genderValue);
  const mainAttrs = (spec.mainCandidates && spec.mainCandidates.length ? spec.mainCandidates : chartMainAttributeCandidates(payload, draft));
  const domainCandidates = spec.domain ? [{ domain_id: spec.domain, label: 'technical_specs', includeSite: true }] : chartDomainCandidates(rawDomainId);
  const attempts = [];
  let lastError = '';
  const allErrors = [];

  const preSize = formatSizeForChart(selectedRow.size || sizeRaw, mainAttrs[0] || 'UY_SIZE');
  const existing = await searchExistingFashionSizeChart(token, rawDomainId, genderValue, preSize);
  if (existing && existing.chart && existing.row) {
    const rootPayload = JSON.parse(JSON.stringify(payload));
    rootPayload.attributes = Array.isArray(rootPayload.attributes) ? rootPayload.attributes.filter(a => !['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(String(a.id || '').toUpperCase())) : [];
    rootPayload.attributes.push({ id: 'SIZE_GRID_ID', value_name: String(existing.chart.id) });
    rootPayload.attributes.push({ id: 'SIZE_GRID_ROW_ID', value_name: String(existing.row.id) });
    delete rootPayload.title;
    delete rootPayload.variations;
    return { payload: rootPayload, variationPayload: buildFashionVariationPayload(payload, existing.chart.id, existing.row.id, selectedRow), chart: existing.chart, chartPayload: existing.searchPayload, chartAttempt: 'existing_chart' };
  }

  for (const cand of domainCandidates) {
    for (const mainAttr of mainAttrs) {
      const rows = guideRows.map(row => ({ attributes: makeChartRowAttributes(spec, mainAttr, row, genderValue, brand) }));
      const chartPayload = {
        names: { MLU: chartName },
        domain_id: cand.domain_id,
        site_id: 'MLU',
        type: 'SPECIFIC',
        attributes: [
          { id: 'GENDER', values: [ { id: genderValue.id, name: genderValue.name } ] }
        ],
        main_attribute: {
          attributes: [ { site_id: 'MLU', id: mainAttr } ]
        },
        rows
      };
      // Si la ficha técnica exige marca en la grilla, la mandamos. Si no, la omitimos para no atar la grilla a una marca incorrecta.
      if ((spec.globalRequired || []).some(a => String(a.id || '').toUpperCase() === 'BRAND')) {
        chartPayload.attributes.push({ id: 'BRAND', values: [{ name: brand || 'Generica' }] });
      }
      attempts.push({ cand, mainAttr, chartPayload });
    }
  }

  for (const attempt of attempts) {
    const r = await fetch('https://api.mercadolibre.com/catalog/charts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(attempt.chartPayload),
    });
    const raw = await r.text();
    let chart = null;
    try { chart = raw ? JSON.parse(raw) : {}; } catch { chart = { raw }; }
    if (r.ok && chart && chart.id) {
      const publishIdx = Math.max(0, guideRows.findIndex(r => r.publish));
      const rowId = chart.rows && chart.rows[publishIdx] && chart.rows[publishIdx].id || chart.rows && chart.rows[0] && chart.rows[0].id;
      if (!rowId) throw new Error('Mercado Libre creó la grilla pero no devolvió SIZE_GRID_ROW_ID. Respuesta: ' + JSON.stringify(chart).slice(0,500));

      const rootPayload = JSON.parse(JSON.stringify(payload));
      rootPayload.attributes = Array.isArray(rootPayload.attributes) ? rootPayload.attributes.filter(a => !['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(String(a.id || '').toUpperCase())) : [];
      rootPayload.attributes.push({ id: 'SIZE_GRID_ID', value_name: String(chart.id) });
      rootPayload.attributes.push({ id: 'SIZE_GRID_ROW_ID', value_name: String(rowId) });
      delete rootPayload.title;
      delete rootPayload.variations;

      return { payload: rootPayload, variationPayload: buildFashionVariationPayload(payload, chart.id, rowId, guideRows[publishIdx] || selectedRow), chart, chartPayload: attempt.chartPayload, chartAttempt: attempt.cand.label + '/' + attempt.mainAttr };
    }
    const msg = (chart && (chart.message || chart.error)) || `No se pudo crear la grilla de talles (${r.status})`;
    const causes = Array.isArray(chart && chart.cause) ? chart.cause.map(c => [c.code, c.message].filter(Boolean).join(': ')).join(' | ') : '';
    lastError = `${msg}${causes ? ' - ' + causes : ''} (intento ${attempt.cand.label}, domain ${attempt.cand.domain_id}, main ${attempt.mainAttr})`;
    allErrors.push(lastError);
  }

  throw new Error((lastError || 'No se pudo crear la grilla de talles.') + (allErrors.length ? ' | Intentos: ' + allErrors.slice(0,8).join(' || ') : '') + (spec.error ? ' | technical_specs: ' + spec.error : ''));
}


function buildPublicadorFallbackCategoryPayload(payload) {
  const clean = JSON.parse(JSON.stringify(payload || {}));
  // Fallback operativo para categorias de moda/calzado que exigen grilla de talles.
  // Permite probar la publicacion en una categoria generica cuando MeLi bloquea por SIZE_GRID_ID.
  // Idealmente luego se implementa una grilla real de talles por cuenta/categoria.
  const fallbackCategory = process.env.PUBLICADOR_FASHION_FALLBACK_CATEGORY || 'MLU1574';
  clean.category_id = fallbackCategory;
  delete clean.title;
  clean.family_name = String(clean.family_name || 'Producto').replace(/\s+/g, ' ').trim().substring(0, 60) || 'Producto';
  clean.attributes = Array.isArray(clean.attributes) ? clean.attributes : [];
  // En categoria fallback evitamos atributos de moda que suelen disparar la grilla obligatoria.
  const skip = new Set(['SIZE_GRID_ID', 'SIZE_GRID_ROW_ID', 'SIZE', 'GENDER']);
  clean.attributes = clean.attributes.filter(a => !skip.has(String(a.id || '').toUpperCase()));
  const idx = clean.attributes.findIndex(a => String(a.id || '').toUpperCase() === 'BRAND');
  if (idx >= 0) clean.attributes[idx] = { id: 'BRAND', value_name: 'Generica' };
  else clean.attributes.unshift({ id: 'BRAND', value_name: 'Generica' });
  clean._tlcFashionGridFallback = 'category_' + fallbackCategory;
  return clean;
}


function parseDataImageSource(src) {
  const m = String(src || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}
function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}
async function uploadDataImageToMeliPicture(token, dataUrl) {
  const parsed = parseDataImageSource(dataUrl);
  if (!parsed || !parsed.buffer || !parsed.buffer.length) throw new Error('Imagen manual invalida.');
  const form = new FormData();
  const blob = new Blob([parsed.buffer], { type: parsed.mime || 'image/jpeg' });
  form.append('file', blob, 'foto_manual.' + extFromMime(parsed.mime));
  const r = await fetch('https://api.mercadolibre.com/pictures/items/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });
  const raw = await r.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!r.ok || !data.id) throw new Error(data.message || data.error || 'Mercado Libre no acepto una foto manual.');
  return data.id;
}

async function postMeliItemDescription(token, itemId, plainText) {
  const text = String(plainText || '').replace(/<[^>]+>/g, '').trim();
  if (!token || !itemId || !text) return { ok: false, skipped: true, reason: 'Sin descripcion para publicar.' };
  const body = JSON.stringify({ plain_text: text.substring(0, 50000) });
  async function send(method) {
    const r = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/description`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body,
    });
    const raw = await r.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    return { ok: r.ok, status: r.status, data };
  }
  let result = await send('POST');
  // Si Mercado Libre responde que ya existe una descripcion o no acepta POST, probamos actualizarla.
  if (!result.ok && [400, 409, 404, 405].includes(Number(result.status))) {
    const putResult = await send('PUT');
    if (putResult.ok) return { ...putResult, method: 'PUT' };
  }
  return { ...result, method: result.ok ? 'POST' : 'POST_FAILED' };
}

async function preparePublicadorPicturesForAccount(payload, token) {
  const out = JSON.parse(JSON.stringify(payload || {}));
  const pics = Array.isArray(out.pictures) ? out.pictures : [];
  const prepared = [];
  for (const pic of pics.slice(0, 8)) {
    const source = String(pic && (pic.source || pic.url || '') || '').trim();
    const id = String(pic && pic.id || '').trim();
    if (id) { prepared.push({ id }); continue; }
    if (/^data:image\//i.test(source)) {
      const uploadedId = await uploadDataImageToMeliPicture(token, source);
      prepared.push({ id: uploadedId });
    } else if (source) {
      prepared.push({ source });
    }
  }
  out.pictures = prepared;
  return out;
}

function cleanMeliCreatePayload(payload) {
  const clean = JSON.parse(JSON.stringify(payload || {}));
  // Nunca enviar campos internos del panel a Mercado Libre.
  // MeLi rechaza cualquier propiedad extra como _tlcFashionGridFallback.
  for (const key of Object.keys(clean)) {
    if (key.startsWith('_tlc') || key.startsWith('_')) delete clean[key];
  }
  if (Array.isArray(clean.attributes)) {
    clean.attributes = clean.attributes
      .filter(a => a && a.id)
      .map(a => {
        const out = { id: a.id };
        if (a.value_id !== undefined && a.value_id !== null && String(a.value_id).trim() !== '') out.value_id = String(a.value_id).trim();
        if (a.value_name !== undefined && a.value_name !== null && String(a.value_name).trim() !== '') out.value_name = String(a.value_name).trim();
        return out;
      })
      .filter(a => a.id && (a.value_id || a.value_name));
  }
  return clean;
}

function errorNeedsEmptyGtinReasonRetry(response) {
  const causes = Array.isArray(response && response.cause) ? response.cause : [];
  const txt = JSON.stringify(response || {});
  return /GTIN/i.test(txt) || causes.some(c => /GTIN|EMPTY_GTIN_REASON/i.test(String(c.message || '') + ' ' + String(c.code || '')));
}

function pickSkuFromMeliItem(raw) {
  const direct = raw.sku || raw.SKU || raw.seller_sku || raw.sellerSku || raw.custom_sku || raw.seller_custom_field || raw.sellerCustomField || '';
  if (direct) return direct;
  const attrs = Array.isArray(raw.attributes) ? raw.attributes : [];
  const skuAttr = attrs.find(a => String(a.id || a.name || '').toUpperCase().includes('SELLER_SKU') || String(a.name || '').toLowerCase() === 'sku');
  if (skuAttr && (skuAttr.value_name || skuAttr.value_id)) return skuAttr.value_name || skuAttr.value_id;
  const variations = Array.isArray(raw.variations) ? raw.variations : [];
  for (const v of variations) {
    if (v.seller_custom_field) return v.seller_custom_field;
    const vAttrs = Array.isArray(v.attributes) ? v.attributes : [];
    const vSku = vAttrs.find(a => String(a.id || a.name || '').toUpperCase().includes('SELLER_SKU') || String(a.name || '').toLowerCase() === 'sku');
    if (vSku && (vSku.value_name || vSku.value_id)) return vSku.value_name || vSku.value_id;
  }
  return '';
}

function normalizePublication(raw, cuenta) {
  const id = raw.id || raw.mlu || raw.item_id || raw.itemId || raw.meli_id || raw.meliId || '';
  const sku = pickSkuFromMeliItem(raw);
  const statusRaw = String(raw.status || raw.estado || raw.state || '').toLowerCase();
  const status = statusRaw.includes('pause') || statusRaw.includes('paus') ? 'paused' : (statusRaw || 'active');
  return {
    cuenta,
    account: cuenta === 'topshop' ? 'TOP SHOP' : 'TLC',
    id: String(id || ''),
    mlu: String(raw.mlu || id || ''),
    sku: String(sku || '').trim(),
    title: raw.title || raw.titulo || raw.name || 'Sin titulo',
    price: Number(raw.price ?? raw.precio ?? raw.sale_price ?? 0) || 0,
    currency_id: raw.currency_id || raw.currencyId || raw.currency || raw.moneda || 'UYU',
    stock: Number(raw.available_quantity ?? raw.stock ?? raw.quantity ?? 0) || 0,
    status,
    permalink: raw.permalink || raw.link || raw.url || (id ? `https://articulo.mercadolibre.com.uy/${id}` : ''),
    thumbnail: raw.thumbnail || raw.picture || '',
    updatedAt: raw.updatedAt || raw.last_updated || raw.date_updated || null,
  };
}

function demoPublications(cuenta) {
  const prefix = cuenta === 'tlc' ? 'TLC' : 'TOP';
  return [
    normalizePublication({ id: `${prefix}-DEMO-001`, sku: 'BICI-FIJA-001', title: 'Bicicleta fija magnetica', price: cuenta === 'tlc' ? 8990 : 9150, stock: 4, status: 'active', permalink: '' }, cuenta),
    normalizePublication({ id: `${prefix}-DEMO-002`, sku: 'MALLA-180-001', title: 'Malla electrosoldada 1.80 m', price: cuenta === 'tlc' ? 2190 : 2190, stock: cuenta === 'tlc' ? 12 : 10, status: 'active', permalink: '' }, cuenta),
    normalizePublication({ id: `${prefix}-DEMO-003`, sku: '', title: 'Publicacion sin SKU para revisar', price: 1290, stock: 1, status: 'paused', permalink: '' }, cuenta),
  ];
}

function normalizePublicationsPayload(payload, cuenta) {
  const source = Array.isArray(payload) ? payload : (payload.results || payload.items || payload.publications || payload.data || []);
  if (!Array.isArray(source)) return [];
  return source.map(item => normalizePublication(item, cuenta));
}


function normalizeCuentaKey(cuenta) {
  return String(cuenta || '').toLowerCase().replace(/\s+/g, '').includes('top') ? 'topshop' : 'tlc';
}

const MELI_OAUTH_FILE = path.join(DATA_DIR, 'meli-oauth-tokens.json');
const MELI_TOKEN_CACHE = { tlc: null, topshop: null };

function loadMeliOAuthStore() {
  ensureDataDir();
  if (!fs.existsSync(MELI_OAUTH_FILE)) return { tlc: {}, topshop: {}, updatedAt: null };
  try {
    const data = JSON.parse(fs.readFileSync(MELI_OAUTH_FILE, 'utf8'));
    return { tlc: data.tlc || {}, topshop: data.topshop || {}, updatedAt: data.updatedAt || null };
  } catch {
    return { tlc: {}, topshop: {}, updatedAt: null };
  }
}

function saveMeliOAuthStore(store) {
  ensureDataDir();
  fs.writeFileSync(MELI_OAUTH_FILE, JSON.stringify({ ...(store || {}), updatedAt: new Date().toISOString() }, null, 2));
}

function envFirst(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function getMeliOAuthConfig(cuenta) {
  const key = normalizeCuentaKey(cuenta);
  const suffix = key === 'topshop' ? 'TOPSHOP' : 'TLC';
  const appId = envFirst([`MELI_APP_ID_${suffix}`, `MELI_CLIENT_ID_${suffix}`, `ML_APP_ID_${suffix}`, `ML_CLIENT_ID_${suffix}`]);
  const clientSecret = envFirst([`MELI_CLIENT_SECRET_${suffix}`, `ML_CLIENT_SECRET_${suffix}`]);
  const store = loadMeliOAuthStore();
  const savedRefreshToken = store[key]?.refresh_token || '';
  const refreshToken = savedRefreshToken || envFirst([`MELI_REFRESH_TOKEN_${suffix}`, `ML_REFRESH_TOKEN_${suffix}`]);
  const fixedAccessToken = envFirst(key === 'topshop'
    ? ['MELI_ACCESS_TOKEN_TOPSHOP', 'ML_ACCESS_TOKEN_TOPSHOP', 'MERCADOLIBRE_ACCESS_TOKEN_TOPSHOP', 'ACCESS_TOKEN_TOPSHOP', 'MELI_TOPSHOP_TOKEN']
    : ['MELI_ACCESS_TOKEN_TLC', 'ML_ACCESS_TOKEN_TLC', 'MERCADOLIBRE_ACCESS_TOKEN_TLC', 'ACCESS_TOKEN_TLC', 'MELI_TLC_TOKEN']);
  return { key, suffix, appId, clientSecret, refreshToken, fixedAccessToken };
}

function getPublicBaseUrl(req) {
  const envUrl = process.env.PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || '';
  if (String(envUrl).startsWith('http')) return String(envUrl).replace(/\/$/, '');
  if (envUrl) return `https://${String(envUrl).replace(/\/$/, '')}`;
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'tlcpanelcontrol.up.railway.app';
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function getMeliRedirectUri(req) {
  return process.env.MELI_REDIRECT_URI || `${getPublicBaseUrl(req)}/api/meli/oauth/callback`;
}

async function refreshMeliAccessToken(cuenta) {
  const cfg = getMeliOAuthConfig(cuenta);
  if (!cfg.appId || !cfg.clientSecret || !cfg.refreshToken) {
    if (cfg.fixedAccessToken) return { access_token: cfg.fixedAccessToken, expires_at: Date.now() + 20 * 60 * 1000, fixed: true };
    throw new Error(`Faltan credenciales Mercado Libre para ${cfg.key}. Configurá MELI_APP_ID_${cfg.suffix}, MELI_CLIENT_SECRET_${cfg.suffix} y MELI_REFRESH_TOKEN_${cfg.suffix}.`);
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.appId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
  });
  const r = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(data.message || data.error_description || data.error || `No se pudo renovar token Mercado Libre ${cfg.key}`);
  }

  const expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 21600) - 120) * 1000;
  const tokenData = { access_token: data.access_token, refresh_token: data.refresh_token || cfg.refreshToken, expires_at: expiresAt };
  MELI_TOKEN_CACHE[cfg.key] = tokenData;

  const store = loadMeliOAuthStore();
  store[cfg.key] = {
    ...(store[cfg.key] || {}),
    refresh_token: tokenData.refresh_token,
    last_access_token_refresh: new Date().toISOString(),
  };
  saveMeliOAuthStore(store);
  return tokenData;
}

async function getMeliAccessToken(cuenta) {
  const cfg = getMeliOAuthConfig(cuenta);
  const cached = MELI_TOKEN_CACHE[cfg.key];
  if (cached?.access_token && cached.expires_at && Date.now() < cached.expires_at) return cached.access_token;
  const refreshed = await refreshMeliAccessToken(cfg.key);
  return refreshed.access_token;
}

async function exchangeMeliAuthorizationCode(cuenta, code, req) {
  const cfg = getMeliOAuthConfig(cuenta);
  if (!cfg.appId || !cfg.clientSecret) {
    throw new Error(`Faltan MELI_APP_ID_${cfg.suffix} y MELI_CLIENT_SECRET_${cfg.suffix} en Railway.`);
  }
  const redirectUri = getMeliRedirectUri(req);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.appId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const r = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.refresh_token) throw new Error(data.message || data.error_description || data.error || 'No se pudo obtener refresh token');
  const store = loadMeliOAuthStore();
  store[cfg.key] = {
    ...(store[cfg.key] || {}),
    refresh_token: data.refresh_token,
    user_id: data.user_id || null,
    obtained_at: new Date().toISOString(),
  };
  saveMeliOAuthStore(store);
  MELI_TOKEN_CACHE[cfg.key] = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + Math.max(60, Number(data.expires_in || 21600) - 120) * 1000 };
  return { ...data, redirect_uri: redirectUri };
}

async function meliApi(cuenta, apiPath, options = {}) {
  const token = await getMeliAccessToken(cuenta);
  const url = apiPath.startsWith('http') ? apiPath : `https://api.mercadolibre.com${apiPath}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    ...(options.headers || {}),
  };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.message || data?.error || data?.cause?.[0]?.message || text || `Mercado Libre status ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function fetchMeliSellerId(cuenta) {
  const me = await meliApi(cuenta, '/users/me');
  const id = me && me.id;
  if (!id) throw new Error('Mercado Libre no devolvio seller_id en /users/me');
  return id;
}

function extractScrollId(data) {
  return data?.scroll_id || data?.scrollId || data?.paging?.scroll_id || data?.body?.scroll_id || data?.body?.paging?.scroll_id || '';
}

async function fetchMeliItemDetails(cuenta, ids = []) {
  const out = [];
  const clean = [...new Set(ids.map(x => String(x || '').trim()).filter(Boolean))];
  const attributes = 'id,title,price,currency_id,available_quantity,status,permalink,thumbnail,seller_custom_field,attributes,variations,last_updated,date_created';
  for (let i = 0; i < clean.length; i += 20) {
    const chunk = clean.slice(i, i + 20);
    const data = await meliApi(cuenta, `/items?ids=${encodeURIComponent(chunk.join(','))}&attributes=${encodeURIComponent(attributes)}`);
    const arr = Array.isArray(data) ? data : [];
    for (const row of arr) {
      if (row && Number(row.code || 200) < 400 && row.body) out.push(row.body);
    }
  }
  return out;
}

async function fetchAllPublicationsDirect(cuenta, params = {}) {
  const sellerId = await fetchMeliSellerId(cuenta);
  const limit = Math.min(Number(process.env.PUBLICATIONS_PAGE_LIMIT || 100), 100);
  const maxPages = Number(process.env.PUBLICATIONS_MAX_PAGES || 120);
  const allIds = [];
  const seen = new Set();
  let scrollId = '';

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ search_type: 'scan', limit: String(limit) });
    if (scrollId) qs.set('scroll_id', scrollId);
    const data = await meliApi(cuenta, `/users/${sellerId}/items/search?${qs.toString()}`);
    const ids = Array.isArray(data?.results) ? data.results : [];
    for (const id of ids) {
      const sid = String(id || '').trim();
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      allIds.push(sid);
    }
    const nextScrollId = extractScrollId(data);
    if (nextScrollId) scrollId = nextScrollId;
    if (!ids.length) break;
    if (!scrollId) break;
  }

  const details = await fetchMeliItemDetails(cuenta, allIds);
  return details.map(item => normalizePublication(item, normalizeCuentaKey(cuenta)));
}

async function fetchPublicationsPageFromN8n(cuenta, params = {}) {
  const webhook = PUBLICATIONS_WEBHOOKS[cuenta] || PUBLICATIONS_WEBHOOKS.tlc;

  // Version v9: los workflows nuevos usan search_type=scan + scroll_id.
  // Primera llamada: limit=50
  // Siguientes llamadas: limit=50&scroll_id=...
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.scroll_id) qs.set('scroll_id', String(params.scroll_id));

  // Compatibilidad con workflows viejos: solo mandamos offset si viene explicitamente.
  if (params.offset != null && !params.scroll_id) qs.set('offset', String(params.offset));

  const target = `${webhook}?${qs.toString()}`;
  const r = await fetch(target, { method: 'GET', headers: { 'Accept': 'application/json' } });
  const text = await r.text();

  if (!String(text || '').trim()) {
    if (params.scroll_id || Number(params.offset || 0) > 0) {
      return { items: [], scroll_id: '', rawCount: 0, target };
    }
    throw new Error(`n8n devolvio respuesta vacia o no-JSON (${cuenta}) URL=${target} RAW=vacio`);
  }

  let data;
  try { data = JSON.parse(text); }
  catch {
    const preview = String(text || '').slice(0, 180).replace(/\s+/g, ' ').trim();
    if (params.scroll_id || Number(params.offset || 0) > 0) {
      return { items: [], scroll_id: '', rawCount: 0, target };
    }
    throw new Error(`n8n devolvio respuesta vacia o no-JSON (${cuenta}) URL=${target} RAW=${preview || 'vacio'}`);
  }

  if (!r.ok) throw new Error(data?.error?.message || data?.message || `n8n status ${r.status}`);
  if (data && data.ok === false) throw new Error(data.message || 'n8n devolvio ok=false');

  // n8n a veces envuelve la respuesta en [{ json: {...} }]
  if (Array.isArray(data) && data.length === 1 && data[0] && data[0].json) {
    data = data[0].json;
  }

  const normalized = normalizePublicationsPayload(data, cuenta);
  const nextScrollId = data?.scroll_id || data?.scrollId || data?.next_scroll_id || data?.nextScrollId || data?.paging?.scroll_id || data?.body?.scroll_id || data?.body?.paging?.scroll_id || data?.response?.scroll_id || data?.response?.paging?.scroll_id || '';
  const rawSource = Array.isArray(data) ? data : (data?.results || data?.items || data?.publications || data?.data || []);

  return {
    items: normalized,
    scroll_id: nextScrollId,
    rawCount: Array.isArray(rawSource) ? rawSource.length : normalized.length,
    target,
  };
}

// Alias de compatibilidad con llamadas viejas dentro del proyecto.
async function fetchPublicationsFromN8n(cuenta, params = {}) {
  const page = await fetchPublicationsPageFromN8n(cuenta, params);
  return page.items;
}

async function updatePublicationOnMeli(cuenta, payload = {}) {
  const accountKey = normalizeCuentaKey(cuenta);
  const id = String(payload.id || payload.mlu || '').trim();
  if (!id) throw new Error('Falta id o MLU para editar publicacion');

  const body = {};
  if (payload.price !== undefined && payload.price !== null && payload.price !== '') body.price = Number(payload.price);
  if (payload.stock !== undefined && payload.stock !== null && payload.stock !== '') body.available_quantity = Number(payload.stock);
  else if (payload.available_quantity !== undefined && payload.available_quantity !== null && payload.available_quantity !== '') body.available_quantity = Number(payload.available_quantity);
  if (payload.title !== undefined && String(payload.title).trim()) body.title = String(payload.title).trim();
  if (payload.status !== undefined && String(payload.status).trim()) body.status = String(payload.status).trim();
  if (payload.sku !== undefined) body.seller_custom_field = String(payload.sku || '').trim();

  if (!Object.keys(body).length) return { ok: true, skipped: true, message: 'No habia campos para enviar a Mercado Libre.' };

  // Mercado Libre usa PUT para modificar publicaciones.
  // PATCH puede devolver errores confusos como "Resource /items/MLU... not found".
  // Enviamos siempre el token de la cuenta detectada en la fila (tlc/topshop).
  const data = await meliApi(accountKey, `/items/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });

  return { ok: true, direct: true, method: 'PUT', cuenta: accountKey, item_id: id, sent: body, response: data };
}

async function fetchAllPublicationsFromN8n(cuenta, params = {}) {
  const limit = Number(process.env.PUBLICATIONS_PAGE_LIMIT || 100);
  const maxPages = Number(process.env.PUBLICATIONS_MAX_PAGES || 120);
  const all = [];
  const seen = new Set();
  let scrollId = '';

  for (let page = 0; page < maxPages; page++) {
    const response = await fetchPublicationsPageFromN8n(cuenta, {
      ...params,
      limit: String(limit),
      scroll_id: scrollId || undefined,
    });

    const batch = response.items || [];
    const before = all.length;

    for (const item of batch) {
      const id = String(item.id || item.mlu || `${cuenta}-${page}-${all.length}`);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(item);
    }

    // Mercado Libre a veces devuelve scroll_id solo en la primera respuesta.
    // En las paginas siguientes puede no repetirlo, pero el mismo scroll_id sigue siendo valido.
    const nextScrollId = response.scroll_id || '';
    if (nextScrollId) scrollId = nextScrollId;

    // Fin normal: no llegaron mas resultados, o son repetidos.
    if (!batch.length) break;
    if (all.length === before) break;

    // Si nunca tuvimos scroll_id no podemos continuar, pero si ya teniamos uno lo reutilizamos.
    if (!scrollId) break;
  }

  return all;
}

function cuentaKey(cuenta) {
  return String(cuenta || '').toLowerCase().replace(/\s+/g, '').includes('top') ? 'topshop' : 'tlc';
}

function publicationIdKey(cuenta, id) {
  return `${cuentaKey(cuenta)}::${String(id || '').trim()}`;
}

function linkIdFromPair(tlcId, topshopId) {
  return `${publicationIdKey('tlc', tlcId)}__${publicationIdKey('topshop', topshopId)}`;
}

function linkIdFromGroup(masterId, childCuenta, childId) {
  return `group::${publicationIdKey('tlc', masterId)}__${publicationIdKey(childCuenta, childId)}`;
}

function normalizePublicationLinks(cache) {
  const links = cache.publicationLinks || {};
  const normalized = {};
  for (const [key, raw] of Object.entries(links)) {
    if (!raw || raw.active === false) continue;
    const masterId = String(raw.masterId || raw.tlcMasterId || raw.tlcId || '').trim();
    if (!masterId) continue;
    let childCuenta = cuentaKey(raw.childCuenta || (raw.topshopId ? 'topshop' : 'tlc'));
    let childId = String(raw.childId || raw.topshopId || raw.secondaryTlcId || '').trim();
    if (!childId) continue;
    if (publicationIdKey('tlc', masterId) === publicationIdKey(childCuenta, childId)) continue;
    const id = raw.id || linkIdFromGroup(masterId, childCuenta, childId);
    normalized[id] = {
      ...raw,
      id,
      active: true,
      masterCuenta: 'tlc',
      masterId,
      childCuenta,
      childId,
      tlcId: masterId,
      topshopId: childCuenta === 'topshop' ? childId : (raw.topshopId || ''),
      secondaryTlcId: childCuenta === 'tlc' ? childId : (raw.secondaryTlcId || ''),
    };
  }
  cache.publicationLinks = normalized;
  return normalized;
}

function getManualLinkFor(cache, cuenta, id) {
  const links = normalizePublicationLinks(cache);
  const key = publicationIdKey(cuenta, id);
  for (const link of Object.values(links)) {
    if (!link || link.active === false) continue;
    if (publicationIdKey('tlc', link.masterId) === key || publicationIdKey(link.childCuenta, link.childId) === key) return link;
  }
  return null;
}

function getLinksForPublication(cache, cuenta, id) {
  const links = normalizePublicationLinks(cache);
  const key = publicationIdKey(cuenta, id);
  return Object.values(links).filter(link => {
    if (!link || link.active === false) return false;
    return publicationIdKey('tlc', link.masterId) === key || publicationIdKey(link.childCuenta, link.childId) === key;
  });
}

function findPublicationInCache(cache, cuenta, id) {
  const key = String(id || '').trim();
  const list = cuentaKey(cuenta) === 'topshop' ? (cache.topshop || []) : (cache.tlc || []);
  return list.find(x => String(x.id || x.mlu || '') === key) || null;
}

function buildLinkedPublications(cache) {
  const rows = [];
  const links = normalizePublicationLinks(cache);
  const tlcById = new Map((cache.tlc || []).map(item => [String(item.id || item.mlu || ''), item]));
  const topById = new Map((cache.topshop || []).map(item => [String(item.id || item.mlu || ''), item]));

  for (const link of Object.values(links)) {
    if (!link || link.active === false) continue;
    const master = tlcById.get(String(link.masterId || '')) || null;
    const child = link.childCuenta === 'topshop'
      ? (topById.get(String(link.childId || '')) || null)
      : (tlcById.get(String(link.childId || '')) || null);
    const sku = link.sku || master?.sku || child?.sku || '';
    const supplier = sku ? (cache.supplierLinks[String(sku).toUpperCase()] || {}) : {};
    rows.push({
      master,
      child,
      childCuenta: link.childCuenta,
      childId: link.childId,
      tlc: master,
      topshop: link.childCuenta === 'topshop' ? child : null,
      sku,
      linked: true,
      groupMode: true,
      linkId: link.id || linkIdFromGroup(link.masterId, link.childCuenta, link.childId),
      masterId: link.masterId,
      linkedAt: link.createdAt || null,
      supplierUrl: supplier.url || '',
      supplierPrice: supplier.price || null,
      supplierStock: supplier.stock || null,
      supplierStatus: supplier.status || '',
      lastSupplierCheck: supplier.lastCheck || null,
    });
  }
  return rows.sort((a,b) => String(a.sku || '').localeCompare(String(b.sku || ''), 'es'));
}

async function syncLinkedValuesFromTlcMaster(cache, username = 'sistema', options = {}) {
  const links = Object.values(normalizePublicationLinks(cache)).filter(link => link && link.active !== false);
  const results = [];
  let okCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const link of links) {
    const masterId = String(link.masterId || '').trim();
    const childCuenta = cuentaKey(link.childCuenta);
    const childId = String(link.childId || '').trim();
    const masterItem = findPublicationInCache(cache, 'tlc', masterId);
    const childItem = findPublicationInCache(cache, childCuenta, childId);
    if (!masterItem || !childItem) {
      skippedCount++;
      results.push({ ok: false, skipped: true, masterId, childCuenta, childId, message: 'No se encontro la maestra TLC o la vinculada en el cache actual.' });
      continue;
    }
    const stockMaster = Number(masterItem.stock ?? masterItem.available_quantity ?? 0);
    const stockChild = Number(childItem.stock ?? childItem.available_quantity ?? 0);
    const priceMaster = Number(masterItem.price ?? 0);
    const priceChild = Number(childItem.price ?? 0);
    const currencyMaster = String(masterItem.currency_id || masterItem.currency || 'UYU').trim() || 'UYU';
    const currencyChild = String(childItem.currency_id || childItem.currency || 'UYU').trim() || 'UYU';
    if (!Number.isFinite(stockMaster) || !Number.isFinite(priceMaster) || priceMaster <= 0) {
      skippedCount++;
      results.push({ ok: false, skipped: true, masterId, childCuenta, childId, message: 'Stock o precio de maestra TLC invalido.' });
      continue;
    }
    const needsStock = stockMaster !== stockChild;
    const needsPrice = priceMaster !== priceChild;
    const needsCurrency = currencyMaster !== currencyChild;
    if (!needsStock && !needsPrice && !needsCurrency) {
      skippedCount++;
      results.push({ ok: true, skipped: true, masterId, childCuenta, childId, stock: stockMaster, price: priceMaster, currency_id: currencyMaster, message: 'Ya estaba sincronizado.' });
      continue;
    }
    const payload = { id: childId, mlu: childId, source: options.source || 'sync_group_values_tlc_master', tlcMasterId: masterId };
    if (needsStock) { payload.stock = stockMaster; payload.available_quantity = stockMaster; }
    if (needsPrice) payload.price = priceMaster;
    if (needsCurrency) payload.currency_id = currencyMaster;
    try {
      let meli;
      try {
        meli = await updatePublicationOnMeli(childCuenta, payload);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if ((payload.currency_id || payload.stock !== undefined) && payload.price !== undefined && /has_bids|Cannot update item|cannot update item|currency|moneda/i.test(msg)) {
          meli = await updatePublicationOnMeli(childCuenta, { id: childId, mlu: childId, price: priceMaster, source: 'sync_group_values_price_fallback', tlcMasterId: masterId });
          meli = { ...(meli || {}), ok: true, partial: true, warning: 'Mercado Libre rechazo stock/moneda. Se reintento solo precio.' };
        } else {
          throw err;
        }
      }
      if (!meli || !meli.partial) {
        if (needsStock) { childItem.stock = stockMaster; childItem.available_quantity = stockMaster; }
        if (needsCurrency) childItem.currency_id = currencyMaster;
      }
      if (needsPrice) childItem.price = priceMaster;
      childItem.lastLinkedSyncFromTlc = new Date().toISOString();
      okCount++;
      results.push({ ok: true, partial: !!(meli && meli.partial), warning: meli && meli.warning, masterId, childCuenta, childId, stock: stockMaster, price: priceMaster, currency_id: currencyMaster });
    } catch (e) {
      errorCount++;
      results.push({ ok: false, masterId, childCuenta, childId, message: e.message });
    }
  }
  cache.lastAutoLinkedSyncAt = new Date().toISOString();
  if (!options.silent || okCount || errorCount) {
    cache.movements.push({
      id: crypto.randomBytes(8).toString('hex'),
      at: new Date().toISOString(),
      type: options.source || 'sync_linked_values',
      message: `Grupos sincronizados desde maestra TLC: ${okCount} ok, ${skippedCount} sin cambios, ${errorCount} errores.`,
      user: username,
    });
  }
  savePublicationsCache(cache);
  return { ok: errorCount === 0, okCount, skippedCount, errorCount, results, message: `Grupos sincronizados desde maestra TLC: ${okCount} ok, ${skippedCount} sin cambios, ${errorCount} errores.` };
}

let AUTO_LINKED_SYNC_RUNNING = false;
async function runAutoLinkedSync() {
  if (AUTO_LINKED_SYNC_RUNNING) return;
  AUTO_LINKED_SYNC_RUNNING = true;
  try {
    const cache = loadPublicationsCache();
    const count = Object.values(normalizePublicationLinks(cache)).filter(link => link && link.active !== false).length;
    if (count > 0) await syncLinkedValuesFromTlcMaster(cache, 'sistema', { silent: true, source: 'auto_sync_linked_values' });
  } catch (e) {
    console.error('Auto sync vinculados:', e.message);
  } finally {
    AUTO_LINKED_SYNC_RUNNING = false;
  }
}

function publicationEditKey(cuenta, item) {
  return `${String(cuenta || item.cuenta || item.account || '').toLowerCase().replace(/\s+/g,'')}::${String(item.id || item.mlu || '').trim()}`;
}

function applyLocalEditToPublication(cache, cuenta, item) {
  // IMPORTANTE: no pisamos precio, stock, estado, titulo ni SKU con datos locales.
  // Esos campos deben venir siempre desde Mercado Libre/n8n para evitar mostrar informacion falsa.
  const key = publicationEditKey(cuenta, item);
  const edit = (cache.localEdits || {})[key] || {};
  const merged = { ...item };
  merged.localEditKey = key;
  merged.localEdited = !!Object.keys(edit).length;
  merged.localEditUpdatedAt = edit.updatedAt || null;
  merged.localEditUpdatedBy = edit.updatedBy || '';
  return merged;
}

function buildFlatPublications(cache) {
  const skuGroups = new Map();
  for (const cuenta of ['tlc', 'topshop']) {
    for (const rawItem of cache[cuenta] || []) {
      const item = applyLocalEditToPublication(cache, cuenta, rawItem);
      const skuKey = String(item.sku || '').trim().toUpperCase();
      if (!skuKey) continue;
      if (!skuGroups.has(skuKey)) skuGroups.set(skuKey, { tlc: [], topshop: [] });
      skuGroups.get(skuKey)[cuenta].push(item);
    }
  }

  const out = [];
  for (const cuenta of ['tlc', 'topshop']) {
    for (const rawItem of cache[cuenta] || []) {
      const item = applyLocalEditToPublication(cache, cuenta, rawItem);
      const id = String(item.id || item.mlu || '').trim();
      const skuKey = String(item.sku || '').trim().toUpperCase();
      const supplierKey = String(item.sku || item.id || '').trim().toUpperCase();
      const supplier = supplierKey ? (cache.supplierLinks[supplierKey] || {}) : {};
      const group = skuKey ? (skuGroups.get(skuKey) || { tlc: [], topshop: [] }) : { tlc: [], topshop: [] };
      const otherCuenta = cuenta === 'tlc' ? 'topshop' : 'tlc';
      const manualLink = getManualLinkFor(cache, cuenta, id);
      const linked = !!manualLink;
      let linkedPeer = null;
      let suggestedPeer = null;
      if (manualLink) {
        const peerId = cuenta === 'tlc' ? manualLink.topshopId : manualLink.tlcId;
        linkedPeer = (cache[otherCuenta] || []).find(x => String(x.id || x.mlu || '') === String(peerId || '')) || null;
      }
      if (!linked && skuKey && group.tlc.length === 1 && group.topshop.length === 1) {
        suggestedPeer = group[otherCuenta][0] || null;
      }
      const skuMatch = !!(skuKey && group.tlc.length > 0 && group.topshop.length > 0);
      out.push({
        ...item,
        account: cuenta === 'tlc' ? 'TLC' : 'TOP SHOP',
        cuenta,
        mlu: item.mlu || item.id || '',
        skuKey,
        supplierKey,
        linked,
        skuMatch,
        linkStatus: linked ? 'linked' : (skuMatch ? 'sku_match' : 'unlinked'),
        linkId: manualLink ? (manualLink.id || linkIdFromPair(manualLink.tlcId, manualLink.topshopId)) : '',
        linkedPeerId: linkedPeer ? String(linkedPeer.id || linkedPeer.mlu || '') : '',
        linkedPeerCuenta: linkedPeer ? otherCuenta : '',
        suggestedPeerId: suggestedPeer ? String(suggestedPeer.id || suggestedPeer.mlu || '') : '',
        suggestedPeerCuenta: suggestedPeer ? otherCuenta : '',
        supplierUrl: supplier.url || '',
        supplierPrice: supplier.price || null,
        supplierStock: supplier.stock || null,
        supplierStatus: supplier.status || '',
        lastSupplierCheck: supplier.lastCheck || null,
      });
    }
  }
  return out.sort((a,b) => String(a.title || '').localeCompare(String(b.title || ''), 'es'));
}

function audit(session, action, detail = {}) {
  try {
    const data = loadAuditLog();
    data.actions.push({
      id: crypto.randomBytes(8).toString('hex'),
      at: new Date().toISOString(),
      user: session?.username || 'system',
      name: session?.name || '',
      role: session?.role || '',
      action,
      detail,
    });
    saveAuditLog(data);
  } catch (e) {
    console.error('Error guardando auditoria:', e.message);
  }
}

function normalizePermissions(user) {
  if (!user) return [];
  if (user.role === 'admin') return ['all'];
  if (Array.isArray(user.permissions) && user.permissions.length) return user.permissions;
  // Compatibilidad con usuarios viejos: hasta que el admin los limite, entran a todo.
  return Object.keys(MODULES);
}

function hasPermission(session, moduleKey) {
  if (!session) return false;
  if (session.role === 'admin') return true;
  const perms = normalizePermissions(session);
  return perms.includes('all') || perms.includes(moduleKey);
}

function moduleForPath(pathName) {
  for (const [key, cfg] of Object.entries(MODULES)) {
    if ((cfg.pages || []).includes(pathName) || (cfg.api || []).includes(pathName)) return key;
  }
  return null;
}

function publicUser(user) {
  return {
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChange: !!user.mustChange,
    createdAt: user.createdAt,
    permissions: normalizePermissions(user),
  };
}

function cleanExpiredInboxState(data) {
  const now = Date.now();
  let changed = false;
  for (const [key, st] of Object.entries(data.messages || {})) {
    if (!st || !st.dismissedUntil) continue;
    const until = new Date(st.dismissedUntil).getTime();
    if (Number.isNaN(until) || now >= until) {
      delete data.messages[key];
      changed = true;
    }
  }
  if (changed) saveInboxState(data);
  return data;
}


// Webhooks de n8n (uno por cuenta)
const WEBHOOKS = {
  tlc:     'https://teloconsigo.app.n8n.cloud/webhook/meli-ads-live',
  topshop: 'https://teloconsigo.app.n8n.cloud/webhook/meli-ads-topshop',
};

// Webhooks de n8n: INBOX (preguntas, mensajes y reclamos)
const INBOX_WEBHOOKS = {
  tlc:     'https://teloconsigo.app.n8n.cloud/webhook/meli-inbox-tlc',
  topshop: 'https://teloconsigo.app.n8n.cloud/webhook/meli-inbox-topshop',
};

// Webhooks de n8n: PUBLICACIONES / CATALOGO
// Crear estos dos webhooks en n8n cuando conectemos Mercado Libre real.
// Por ahora, si n8n no responde, el panel muestra cache local + datos demo.
const PUBLICATIONS_WEBHOOKS = {
  tlc:     process.env.N8N_PUBLICATIONS_TLC || 'https://teloconsigo.app.n8n.cloud/webhook/meli-publications-tlc-full',
  topshop: process.env.N8N_PUBLICATIONS_TOPSHOP || 'https://teloconsigo.app.n8n.cloud/webhook/meli-publications-topshop-full',
};

const PUBLICATIONS_EDIT_WEBHOOKS = {
  tlc:     process.env.N8N_PUBLICATION_EDIT_TLC || 'https://teloconsigo.app.n8n.cloud/webhook/meli-publication-tlc-edit',
  topshop: process.env.N8N_PUBLICATION_EDIT_TOPSHOP || 'https://teloconsigo.app.n8n.cloud/webhook/meli-publication-topshop-edit',
};

// ═══════════════════════════════════════════════
//  USUARIOS
// ═══════════════════════════════════════════════
const USERS_FILE = path.join(__dirname, 'users.json');

function hashPassword(pw, salt) {
  return crypto.pbkdf2Sync(pw, salt, 10000, 64, 'sha512').toString('hex');
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    // Primera vez: crea admin con contraseña por defecto
    const salt = crypto.randomBytes(16).toString('hex');
    const initial = {
      users: [
        {
          username: 'admin',
          name: 'Administrador',
          email: 'admin@teloconsigo.com.uy',
          role: 'admin',
          salt: salt,
          hash: hashPassword('admin1234', salt),
          mustChange: true,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(initial, null, 2));
    console.log('');
    console.log('  ⚠️  Se creó el usuario admin por primera vez');
    console.log('  Usuario: admin');
    console.log('  Contraseña: admin1234');
    console.log('  CAMBIALA AL PRIMER LOGIN');
    console.log('');
    return initial;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function findUser(username) {
  const data = loadUsers();
  return data.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
}

function checkPassword(username, pw) {
  const u = findUser(username);
  if (!u) return null;
  const computed = hashPassword(pw, u.salt);
  if (computed === u.hash) return u;
  return null;
}

// ═══════════════════════════════════════════════
//  SESIONES (en memoria, se pierden al reiniciar)
// ═══════════════════════════════════════════════
const SESSIONS = new Map(); // token → { username, role, createdAt }
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, {
    username: user.username,
    name: user.name,
    role: user.role,
    permissions: normalizePermissions(user),
    createdAt: Date.now(),
  });
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const s = SESSIONS.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_DURATION_MS) {
    SESSIONS.delete(token);
    return null;
  }
  return s;
}

function getCookieToken(req) {
  const cookies = req.headers.cookie || '';
  const m = cookies.match(/auth=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════
function jsonResp(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type':                'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'*',
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

// ═══════════════════════════════════════════════
//  SERVIDOR
// ═══════════════════════════════════════════════
const server = http.createServer((req, res) => {

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathName = u.pathname;
  // Login desactivado temporalmente: todas las rutas operan como admin local.
  const session = { username: 'admin', name: 'Admin', role: 'admin', permissions: ['all'] };


  // ───────────────────────────────────────────────
  //  RUTAS PÚBLICAS (sin login)
  // ───────────────────────────────────────────────

  // PING
  if (pathName === '/api/ping') {
    jsonResp(res, 200, { ok: true });
    return;
  }

  // Proxy local de imagenes para previsualizar fotos que bloquean hotlinking (MeLi/MakerWorld/proveedores).
  // El payload sigue usando la URL original; esto solo sirve para mostrar la miniatura en el panel.
  if (req.method === 'GET' && pathName === '/api/publicador-image') {
    (async () => {
      try {
        const src = u.searchParams.get('url') || '';
        if (!/^https?:\/\//i.test(src)) { res.writeHead(400); res.end('bad url'); return; }
        const rr = await fetch(src, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': src.includes('mlstatic.com') ? 'https://www.mercadolibre.com.uy/' : 'https://www.google.com/'
          }
        });
        if (!rr.ok) { res.writeHead(rr.status); res.end('image fetch failed'); return; }
        const ct = rr.headers.get('content-type') || 'image/jpeg';
        const ab = Buffer.from(await rr.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(ab);
      } catch (e) {
        res.writeHead(500);
        res.end(e.message || 'image proxy error');
      }
    })();
    return;
  }

  // LOGIN DESACTIVADO TEMPORALMENTE
  // Se mantiene compatibilidad de endpoints para que el frontend no rompa,
  // pero no se exige usuario ni contraseña hasta nuevo aviso.
  if (req.method === 'POST' && pathName === '/api/login') {
    jsonResp(res, 200, { ok: true, user: session }, {
      'Set-Cookie': 'auth=disabled; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000',
    });
    return;
  }

  if (req.method === 'POST' && pathName === '/api/logout') {
    jsonResp(res, 200, { ok: true, loginDisabled: true });
    return;
  }

  if (pathName === '/api/me') {
    jsonResp(res, 200, { user: session, loginDisabled: true });
    return;
  }

  // OAuth Mercado Libre propio del panel.
  // Uso:
  // /api/meli/oauth/start?cuenta=tlc
  // /api/meli/oauth/start?cuenta=topshop
  if (req.method === 'GET' && pathName === '/api/meli/oauth/start') {
    try {
      const cuenta = normalizeCuentaKey(u.searchParams.get('cuenta') || 'tlc');
      const cfg = getMeliOAuthConfig(cuenta);
      if (!cfg.appId) {
        jsonResp(res, 400, { error: `Falta MELI_APP_ID_${cfg.suffix} o MELI_CLIENT_ID_${cfg.suffix} en Railway.` });
        return;
      }
      const redirectUri = getMeliRedirectUri(req);
      const auth = new URL('https://auth.mercadolibre.com.uy/authorization');
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('client_id', cfg.appId);
      auth.searchParams.set('redirect_uri', redirectUri);
      auth.searchParams.set('state', cuenta);
      res.writeHead(302, { Location: auth.toString() });
      res.end();
    } catch (e) {
      jsonResp(res, 500, { error: e.message });
    }
    return;
  }

  if (req.method === 'GET' && pathName === '/api/meli/oauth/callback') {
    (async () => {
      try {
        const code = u.searchParams.get('code') || '';
        const cuenta = normalizeCuentaKey(u.searchParams.get('state') || u.searchParams.get('cuenta') || 'tlc');
        if (!code) {
          jsonResp(res, 400, { error: 'Mercado Libre no devolvio code.' });
          return;
        }
        const data = await exchangeMeliAuthorizationCode(cuenta, code, req);
        const cfg = getMeliOAuthConfig(cuenta);
        const token = String(data.refresh_token || '');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mercado Libre conectado</title><style>body{font-family:Arial,sans-serif;background:#f6f8f6;color:#102010;padding:32px}code,textarea{width:100%;box-sizing:border-box}textarea{height:120px;margin-top:10px;padding:12px} .box{max-width:900px;background:white;border:1px solid #d9e2d9;border-radius:12px;padding:24px}</style></head><body><div class="box"><h1>Cuenta ${cfg.suffix} conectada</h1><p>Copiá este refresh token y guardalo en Railway como <strong>MELI_REFRESH_TOKEN_${cfg.suffix}</strong>.</p><textarea readonly onclick="this.select()">${token.replace(/</g,'&lt;')}</textarea><p>Redirect usado: <code>${String(data.redirect_uri || '').replace(/</g,'&lt;')}</code></p><p>Después de guardarlo en Railway, podés cerrar esta pestaña.</p></div></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Error OAuth Mercado Libre</h1><pre>${String(e.message || e).replace(/</g,'&lt;')}</pre>`);
      }
    })();
    return;
  }

  if (req.method === 'GET' && pathName === '/api/meli/oauth/status') {
    const store = loadMeliOAuthStore();
    jsonResp(res, 200, {
      tlc: { hasRefreshToken: !!(store.tlc && store.tlc.refresh_token), obtainedAt: store.tlc?.obtained_at || null, lastRefresh: store.tlc?.last_access_token_refresh || null },
      topshop: { hasRefreshToken: !!(store.topshop && store.topshop.refresh_token), obtainedAt: store.topshop?.obtained_at || null, lastRefresh: store.topshop?.last_access_token_refresh || null },
      updatedAt: store.updatedAt || null,
    });
    return;
  }

  // Si alguien entra al login, enviarlo directo al panel.
  if (pathName === '/login.html' || pathName === '/login') {
    res.writeHead(302, { 'Location': '/index.html' });
    res.end();
    return;
  }

  // Desde acá ya NO se requiere login.

  const requestedModule = moduleForPath(pathName);
  if (requestedModule && !hasPermission(session, requestedModule)) {
    if (pathName.endsWith('.html')) {
      res.writeHead(302, { 'Location': '/index.html' });
      res.end();
      return;
    }
    jsonResp(res, 403, { error: 'No tenés permiso para acceder a este módulo' });
    return;
  }

  // ── ESTADOS PERSISTENTES DE BANDEJA ───────────────────
  if (pathName === '/api/state') {
    if (req.method === 'GET') {
      const data = cleanExpiredInboxState(loadInboxState());
      jsonResp(res, 200, data);
      return;
    }
    if (req.method === 'POST') {
      (async () => {
        const body = await readBody(req);
        const data = loadInboxState();
        const section = ['messages', 'claims', 'questions'].includes(body.section) ? body.section : null;
        const key = String(body.key || '');
        if (!section || !key) {
          jsonResp(res, 400, { error: 'Falta section o key' });
          return;
        }
        const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
        if (body.replace === true) {
          data[section][key] = patch;
        } else {
          data[section][key] = {
            ...(data[section][key] || {}),
            ...patch,
            updatedAt: new Date().toISOString(),
            updatedBy: session.username,
            updatedByName: session.name || session.username,
          };
        }
        if (body.removeFields && Array.isArray(body.removeFields)) {
          for (const f of body.removeFields) delete data[section][key][f];
        }
        if (body.delete === true) {
          delete data[section][key];
        }
        const saved = cleanExpiredInboxState(saveInboxState(data));
        audit(session, 'inbox_state_update', { section, key, actionLabel: patch.actionLabel || '', item: patch.item_id || patch.question_id || patch._packId || patch._id || '', delete: body.delete === true, removeFields: body.removeFields || [] });
        jsonResp(res, 200, { ok: true, state: saved[section][key] || null });
      })();
      return;
    }
  }

  // ── CAMBIAR CONTRASEÑA PROPIA ───────────────────
  if (req.method === 'POST' && pathName === '/api/change-password') {
    (async () => {
      const body = await readBody(req);
      const { currentPassword, newPassword } = body;
      if (!newPassword || newPassword.length < 6) {
        jsonResp(res, 400, { error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        return;
      }
      const user = checkPassword(session.username, currentPassword);
      if (!user) {
        jsonResp(res, 401, { error: 'Contraseña actual incorrecta' });
        return;
      }
      const data = loadUsers();
      const idx = data.users.findIndex(x => x.username === session.username);
      const newSalt = crypto.randomBytes(16).toString('hex');
      data.users[idx].salt = newSalt;
      data.users[idx].hash = hashPassword(newPassword, newSalt);
      data.users[idx].mustChange = false;
      saveUsers(data);
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: LISTAR USUARIOS ───────────────────
  if (pathName === '/api/admin/users') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    const data = loadUsers();
    const safe = data.users.map(publicUser);
    jsonResp(res, 200, { users: safe });
    return;
  }

  // ── ADMIN: CREAR USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/create-user') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username, name, email, password, role } = body;
      const permissions = Array.isArray(body.permissions) ? body.permissions.filter(p => MODULES[p]) : Object.keys(MODULES);
      if (!username || !name || !password) {
        jsonResp(res, 400, { error: 'Faltan datos (usuario, nombre, contraseña)' });
        return;
      }
      if (password.length < 6) {
        jsonResp(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres' });
        return;
      }
      const data = loadUsers();
      if (data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        jsonResp(res, 400, { error: 'Ya existe un usuario con ese nombre' });
        return;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      data.users.push({
        username, name, email: email || '',
        role: role === 'admin' ? 'admin' : 'user',
        permissions: role === 'admin' ? ['all'] : permissions,
        salt, hash: hashPassword(password, salt),
        mustChange: true,
        createdAt: new Date().toISOString(),
      });
      saveUsers(data);
      audit(session, 'admin_create_user', { username, role: role === 'admin' ? 'admin' : 'user', permissions });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: RESETEAR CONTRASEÑA DE OTRO USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/reset-password') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username, newPassword } = body;
      if (!username || !newPassword || newPassword.length < 6) {
        jsonResp(res, 400, { error: 'Datos inválidos (mínimo 6 caracteres)' });
        return;
      }
      const data = loadUsers();
      const idx = data.users.findIndex(u => u.username === username);
      if (idx < 0) { jsonResp(res, 404, { error: 'Usuario no encontrado' }); return; }
      const salt = crypto.randomBytes(16).toString('hex');
      data.users[idx].salt = salt;
      data.users[idx].hash = hashPassword(newPassword, salt);
      data.users[idx].mustChange = true;
      saveUsers(data);
      audit(session, 'admin_reset_password', { username });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: EDITAR DATOS DE USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/update-user') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username, newUsername, name, email, role } = body;
      const permissions = Array.isArray(body.permissions) ? body.permissions.filter(p => MODULES[p]) : null;
      if (!username) { jsonResp(res, 400, { error: 'Falta username' }); return; }

      const data = loadUsers();
      const idx = data.users.findIndex(u => u.username === username);
      if (idx < 0) { jsonResp(res, 404, { error: 'Usuario no encontrado' }); return; }

      // Si quiere cambiar el username, validar que no exista
      if (newUsername && newUsername !== username) {
        if (data.users.some(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
          jsonResp(res, 400, { error: 'Ya existe un usuario con ese nombre' });
          return;
        }
        data.users[idx].username = newUsername;
        // Si el usuario está cambiando su propio nombre, actualizar la sesión activa
        if (username === session.username) {
          for (const [token, s] of SESSIONS.entries()) {
            if (s.username === username) {
              s.username = newUsername;
              s.name = name || s.name;
            }
          }
        }
      }
      if (name !== undefined) data.users[idx].name = name;
      if (email !== undefined) data.users[idx].email = email;
      if (permissions) data.users[idx].permissions = permissions;
      if (role) {
        // Validar que no se quede sin admins
        const newRole = role === 'admin' ? 'admin' : 'user';
        if (data.users[idx].role === 'admin' && newRole === 'user') {
          const otherAdmins = data.users.filter((u, i) => i !== idx && u.role === 'admin').length;
          if (otherAdmins === 0) {
            jsonResp(res, 400, { error: 'No podés quitarle el rol admin: es el único administrador' });
            return;
          }
        }
        data.users[idx].role = newRole;
        // Actualizar rol en sesión activa si está logueado
        for (const [token, s] of SESSIONS.entries()) {
          if (s.username === (newUsername || username)) {
            s.role = newRole;
              s.permissions = newRole === 'admin' ? ['all'] : normalizePermissions(data.users[idx]);
          }
        }
      }
      for (const [token, s] of SESSIONS.entries()) {
        if (s.username === (newUsername || username)) {
          s.permissions = normalizePermissions(data.users[idx]);
        }
      }
      saveUsers(data);
      audit(session, 'admin_update_user', { username, newUsername, role, permissions });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: ELIMINAR USUARIO ───────────────────
  if (req.method === 'POST' && pathName === '/api/admin/delete-user') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    (async () => {
      const body = await readBody(req);
      const { username } = body;
      if (username === session.username) {
        jsonResp(res, 400, { error: 'No podés eliminar tu propio usuario' });
        return;
      }
      const data = loadUsers();
      const before = data.users.length;
      data.users = data.users.filter(u => u.username !== username);
      if (data.users.length === before) { jsonResp(res, 404, { error: 'Usuario no encontrado' }); return; }
      saveUsers(data);
      audit(session, 'admin_delete_user', { username });
      jsonResp(res, 200, { ok: true });
    })();
    return;
  }

  // ── ADMIN: AUDITORIA ───────────────────
  if (pathName === '/api/admin/audit') {
    if (session.role !== 'admin') { jsonResp(res, 403, { error: 'No autorizado' }); return; }
    const limit = Math.min(Number(u.searchParams.get('limit') || 200), 1000);
    const data = loadAuditLog();
    jsonResp(res, 200, { actions: data.actions.slice(-limit).reverse() });
    return;
  }

  // ── PROXY ADS a n8n ──────────────────────────
  if (pathName === '/api/meli') {
    (async () => {
      try {
        const cuenta = u.searchParams.get('cuenta') || 'tlc';
        const webhook = WEBHOOKS[cuenta] || WEBHOOKS.tlc;
        u.searchParams.delete('cuenta');
        const target = `${webhook}?${u.searchParams.toString()}`;
        console.log(`[MELI ADS ${cuenta.toUpperCase()}] (${session.username}) → ${target.substring(0, 140)}...`);

        const opts = {
          method: req.method,
          headers: { 'Accept': 'application/json' },
        };

        if (req.method === 'POST') {
          opts.headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(await readBody(req));
        }

        const r = await fetch(target, opts);
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); }
        catch { data = { error: { message: 'n8n devolvió respuesta vacía o no-JSON', raw: text.slice(0, 400) } }; }
        audit(session, 'meli_ads_api', { cuenta, method: req.method, status: r.status, params: Object.fromEntries(u.searchParams.entries()) });
        jsonResp(res, r.status, data);
      } catch (e) {
        console.error('Error proxy MeLi ADS:', e.message);
        jsonResp(res, 500, { error: { message: e.message } });
      }
    })();
    return;
  }

  // ── PROXY INBOX a n8n ────────────────────────
  // /api/inbox?cuenta=tlc&action=questions|messages_unread|claims|answer|messages_pack|send_message
  if (pathName === '/api/inbox') {
    (async () => {
      try {
        const cuenta = u.searchParams.get('cuenta') || 'tlc';
        const webhook = INBOX_WEBHOOKS[cuenta] || INBOX_WEBHOOKS.tlc;
        u.searchParams.delete('cuenta');
        const target = `${webhook}?${u.searchParams.toString()}`;
        console.log(`[MELI INBOX ${cuenta.toUpperCase()}] (${session.username}) ${req.method} → ${target.substring(0, 160)}...`);

        // IMPORTANTE:
        // Los workflows de INBOX en n8n estan registrados como GET.
        // El frontend puede llamar POST para acciones como responder preguntas o enviar mensajes,
        // pero aca convertimos esos datos a querystring y llamamos al webhook por GET.
        // Esto evita el error: "webhook is not registered for POST requests".
        let targetFinal = target;
        const opts = {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        };

        if (req.method === 'POST') {
          const body = await readBody(req);
          const params = new URLSearchParams(u.searchParams);
          for (const [k, v] of Object.entries(body || {})) {
            if (v !== undefined && v !== null) params.set(k, String(v));
          }
          targetFinal = `${webhook}?${params.toString()}`;
          console.log(`[MELI INBOX ${cuenta.toUpperCase()}] POST convertido a GET -> ${targetFinal.substring(0, 180)}...`);
        }

        const r = await fetch(targetFinal, opts);
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); }
        catch { data = { error: { message: 'n8n devolvió respuesta vacía o no-JSON', raw: text.slice(0, 400) } }; }
        audit(session, 'meli_inbox_api', { cuenta, method: req.method, status: r.status, action: u.searchParams.get('action') || '', params: Object.fromEntries(u.searchParams.entries()) });
        jsonResp(res, r.status, data);
      } catch (e) {
        console.error('Error proxy MeLi INBOX:', e.message);
        jsonResp(res, 500, { error: { message: e.message } });
      }
    })();
    return;
  }


  // ── PUBLICACIONES / CATALOGO ──────────────────
  // GET  /api/publications?action=list|movements&refresh=1
  // POST /api/publications action=save_supplier|edit_local|movement
  if (pathName === '/api/publications') {
    (async () => {
      try {
        const action = u.searchParams.get('action') || 'list';
        const cache = loadPublicationsCache();

        if (req.method === 'GET' && action === 'movements') {
          jsonResp(res, 200, { movements: (cache.movements || []).slice(-200).reverse() });
          return;
        }

        if (req.method === 'GET' && action === 'list') {
          const refresh = u.searchParams.get('refresh') === '1';
          const errors = [];

          if (refresh) {
            for (const cuenta of ['tlc', 'topshop']) {
              try {
                const items = await fetchAllPublicationsDirect(cuenta, {});
                cache[cuenta] = items;
              } catch (e) {
                errors.push({ cuenta, message: e.message });
                // Si falla n8n, dejamos el cache anterior para no borrar datos reales.
                // Ya no metemos demo automáticamente durante una sincronización real.
              }
            }
            cache.updatedAt = new Date().toISOString();
            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: 'sync_publications',
              message: errors.length ? 'Sincronizacion parcial: una o mas cuentas no respondieron desde Mercado Libre directo.' : 'Publicaciones sincronizadas directo desde Mercado Libre.',
              user: session.username,
            });
            savePublicationsCache(cache);
            audit(session, 'publications_refresh', { errors });
          } else if ((!cache.tlc || !cache.tlc.length) && (!cache.topshop || !cache.topshop.length)) {
            // En local, si nunca se sincronizo, mostramos demo solamente como vista inicial.
            cache.tlc = demoPublications('tlc');
            cache.topshop = demoPublications('topshop');
            savePublicationsCache(cache);
          }

          jsonResp(res, 200, {
            ok: true,
            updatedAt: cache.updatedAt,
            errors,
            tlc: cache.tlc || [],
            topshop: cache.topshop || [],
            publications: buildFlatPublications(cache),
            linked: buildLinkedPublications(cache),
            movements: (cache.movements || []).slice(-20).reverse(),
          });
          return;
        }

        if (req.method === 'POST') {
          const body = await readBody(req);
          const postAction = body.action || action;

          if (postAction === 'save_supplier') {
            const sku = String(body.sku || body.key || '').trim().toUpperCase();
            if (!sku) { jsonResp(res, 400, { error: 'Falta SKU o clave' }); return; }
            cache.supplierLinks[sku] = {
              ...(cache.supplierLinks[sku] || {}),
              url: String(body.url || '').trim(),
              updatedAt: new Date().toISOString(),
              updatedBy: session.username,
            };
            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: 'supplier_link',
              sku,
              message: `Se guardo link de proveedor para SKU ${sku}.`,
              user: session.username,
            });
            savePublicationsCache(cache);
            audit(session, 'publications_save_supplier', { sku });
            jsonResp(res, 200, { ok: true, linked: buildLinkedPublications(cache) });
            return;
          }


          if (postAction === 'link_publications' || postAction === 'link_to_master') {
            const masterTlcId = String(body.masterTlcId || body.masterId || body.tlcId || body.tlc || '').trim();
            if (!masterTlcId) { jsonResp(res, 400, { error: 'Falta masterTlcId o tlcId' }); return; }
            const masterItem = (cache.tlc || []).find(x => String(x.id || x.mlu || '') === masterTlcId);
            if (!masterItem) { jsonResp(res, 404, { error: 'No se encontro la publicacion maestra TLC' }); return; }

            let items = Array.isArray(body.items) ? body.items : [];
            if (!items.length) {
              if (body.topshopId || body.topshop) items.push({ cuenta: 'topshop', id: body.topshopId || body.topshop });
              if (body.childTlcId || body.secondaryTlcId) items.push({ cuenta: 'tlc', id: body.childTlcId || body.secondaryTlcId });
              if (body.childId) items.push({ cuenta: body.childCuenta || body.cuenta || 'topshop', id: body.childId });
            }
            items = items.map(it => ({ cuenta: cuentaKey(it.cuenta || it.account || it.childCuenta || 'topshop'), id: String(it.id || it.mlu || it.childId || '').trim() }))
              .filter(it => it.id && publicationIdKey(it.cuenta, it.id) !== publicationIdKey('tlc', masterTlcId));
            if (!items.length) { jsonResp(res, 400, { error: 'Falta al menos una publicacion vinculada' }); return; }

            normalizePublicationLinks(cache);
            const created = [];
            const errors = [];
            for (const it of items) {
              const childItem = it.cuenta === 'topshop'
                ? (cache.topshop || []).find(x => String(x.id || x.mlu || '') === it.id)
                : (cache.tlc || []).find(x => String(x.id || x.mlu || '') === it.id);
              if (!childItem) { errors.push(`No se encontro ${it.cuenta} ${it.id}`); continue; }

              // Una publicación secundaria puede depender de una sola maestra.
              for (const [existingKey, existingLink] of Object.entries(cache.publicationLinks || {})) {
                if (!existingLink) continue;
                if (publicationIdKey(existingLink.childCuenta, existingLink.childId) === publicationIdKey(it.cuenta, it.id)) {
                  delete cache.publicationLinks[existingKey];
                }
              }

              const linkId = linkIdFromGroup(masterTlcId, it.cuenta, it.id);
              cache.publicationLinks[linkId] = {
                id: linkId,
                active: true,
                masterCuenta: 'tlc',
                masterId: masterTlcId,
                childCuenta: it.cuenta,
                childId: it.id,
                tlcId: masterTlcId,
                topshopId: it.cuenta === 'topshop' ? it.id : '',
                secondaryTlcId: it.cuenta === 'tlc' ? it.id : '',
                sku: String(body.sku || masterItem.sku || childItem.sku || '').trim(),
                createdAt: cache.publicationLinks[linkId]?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                updatedBy: session.username,
              };
              created.push(cache.publicationLinks[linkId]);
            }

            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: 'link_publications_group',
              sku: String(body.sku || masterItem.sku || '').trim(),
              message: `Se vincularon ${created.length} publicacion(es) a la maestra TLC ${masterTlcId}.`,
              user: session.username,
            });
            savePublicationsCache(cache);
            audit(session, 'publications_link_group', { masterTlcId, created: created.length, errors });
            jsonResp(res, 200, { ok: true, links: created, errors, publications: buildFlatPublications(cache), linked: buildLinkedPublications(cache) });
            return;
          }

          if (postAction === 'unlink_master_group') {
            const masterTlcId = String(body.masterTlcId || body.masterId || body.tlcId || '').trim();
            if (!masterTlcId) { jsonResp(res, 400, { error: 'Falta masterTlcId' }); return; }
            normalizePublicationLinks(cache);
            let removed = 0;
            for (const [existingKey, existingLink] of Object.entries(cache.publicationLinks || {})) {
              if (!existingLink) continue;
              if (String(existingLink.masterId || existingLink.tlcId || '').trim() === masterTlcId) {
                delete cache.publicationLinks[existingKey];
                removed++;
              }
            }
            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: 'unlink_master_group',
              sku: '',
              message: `Se desvinculo el grupo completo de la maestra TLC ${masterTlcId}: ${removed} vinculo(s) eliminado(s).`,
              user: session.username,
            });
            savePublicationsCache(cache);
            audit(session, 'publications_unlink_master_group', { masterTlcId, removed });
            jsonResp(res, 200, { ok: true, removed, publications: buildFlatPublications(cache), linked: buildLinkedPublications(cache) });
            return;
          }

          if (postAction === 'unlink_publications') {
            const linkId = String(body.linkId || '').trim();
            const cuentaRaw = String(body.cuenta || body.account || '').toLowerCase().replace(/\s+/g, '');
            const cuenta = cuentaRaw.includes('top') ? 'topshop' : 'tlc';
            const id = String(body.id || body.mlu || '').trim();
            let foundKey = linkId;
            if (!foundKey && id) {
              const link = getManualLinkFor(cache, cuenta, id);
              foundKey = link ? (link.id || linkIdFromPair(link.tlcId, link.topshopId)) : '';
            }
            if (!foundKey || !cache.publicationLinks[foundKey]) { jsonResp(res, 404, { error: 'No se encontro el vinculo' }); return; }
            const old = cache.publicationLinks[foundKey];
            delete cache.publicationLinks[foundKey];
            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: 'unlink_publications',
              sku: old.sku || '',
              message: `Se desvincularon ${old.tlcId} y ${old.topshopId}.`,
              user: session.username,
            });
            savePublicationsCache(cache);
            audit(session, 'publications_unlink', { linkId: foundKey });
            jsonResp(res, 200, { ok: true, publications: buildFlatPublications(cache), linked: buildLinkedPublications(cache) });
            return;
          }



          if (postAction === 'sync_linked_stock' || postAction === 'sync_linked_values') {
            const result = await syncLinkedValuesFromTlcMaster(cache, session.username, { source: 'sync_linked_values' });
            audit(session, 'publications_sync_linked_values', { okCount: result.okCount, skippedCount: result.skippedCount, errorCount: result.errorCount });
            jsonResp(res, 200, {
              ...result,
              updated: result.okCount,
              skipped: result.skippedCount,
              errors: result.errorCount,
              publications: buildFlatPublications(cache),
              linked: buildLinkedPublications(cache),
              movements: (cache.movements || []).slice(-20).reverse(),
            });
            return;
          }

          if (postAction === 'edit_local' || postAction === 'edit_meli') {
            const cuentaRaw = String(body.cuenta || body.account || '').toLowerCase().replace(/\s+/g, '');
            const cuenta = cuentaRaw.includes('top') ? 'topshop' : 'tlc';
            const id = String(body.id || body.mlu || '').trim();
            if (!id) { jsonResp(res, 400, { error: 'Falta id o MLU de publicacion' }); return; }

            const meliPayload = {
              id,
              mlu: id,
            };
            if (body.price !== undefined) meliPayload.price = body.price;
            if (body.stock !== undefined) {
              meliPayload.stock = body.stock;
              meliPayload.available_quantity = body.stock;
            }
            // Proteccion server-side: TOP SHOP solo envia precio y stock.
            // Mercado Libre rechaza title/status/SKU en muchas publicaciones con has_bids.
            if (cuenta !== 'topshop') {
              if (body.title !== undefined) meliPayload.title = body.title;
              if (body.sku !== undefined) meliPayload.sku = body.sku;
              if (body.status !== undefined) meliPayload.status = body.status;
            }

            let meliResult = null;
            if (postAction === 'edit_meli') {
              try {
                meliResult = await updatePublicationOnMeli(cuenta, meliPayload);
              } catch (err) {
                const msg = String(err && err.message ? err.message : err);
                const isTopShopRetry = cuenta === 'topshop' && body.price !== undefined && body.stock !== undefined && /has_bids|Cannot update item|cannot update item/i.test(msg);

                // Mercado Libre puede rechazar stock en publicaciones con ventas/ofertas (has_bids).
                // En ese caso no bloqueamos el precio: reintentamos TOP SHOP enviando SOLO price.
                if (isTopShopRetry) {
                  const retryPayload = { id, mlu: id, price: body.price, _retry: 'price_only_after_stock_rejected' };
                  meliResult = await updatePublicationOnMeli(cuenta, retryPayload);
                  meliResult = {
                    ...(meliResult || {}),
                    ok: true,
                    partial: true,
                    warning: 'Mercado Libre rechazo modificar stock en esta publicacion con ventas/ofertas. Se reintento y se envio solo el precio.'
                  };
                } else {
                  throw err;
                }
              }
            }

            // Si se editó una publicación TLC que es maestra de un grupo,
            // copiamos precio/stock a todas sus vinculadas (TLC secundarias y TOP SHOP).
            let groupSyncResult = null;
            if (postAction === 'edit_meli' && cuenta === 'tlc' && (body.price !== undefined || body.stock !== undefined)) {
              const hasChildren = Object.values(normalizePublicationLinks(cache)).some(link => link && String(link.masterId || '') === id);
              if (hasChildren) {
                // Actualizamos la maestra en cache antes de sincronizar para que tome los valores nuevos.
                const masterItem = (cache.tlc || []).find(x => String(x.id || x.mlu || '') === id);
                if (masterItem) {
                  if (body.price !== undefined) masterItem.price = Number(body.price);
                  if (body.stock !== undefined) { masterItem.stock = Number(body.stock); masterItem.available_quantity = Number(body.stock); }
                  if (body.currency_id !== undefined) masterItem.currency_id = body.currency_id;
                }
                groupSyncResult = await syncLinkedValuesFromTlcMaster(cache, session.username, { source: 'sync_group_after_master_edit', silent: false });
              }
            }

            const key = `${cuenta}::${id}`;
            const previous = cache.localEdits[key] || {};
            const next = { ...previous };
            // Guardamos solo auditoria local. No guardamos precio/stock/estado/titulo/SKU
            // para no tapar la informacion real que vuelve desde Mercado Libre.
            next.updatedAt = new Date().toISOString();
            next.updatedBy = session.username;
            next.savedToMeli = postAction === 'edit_meli';
            cache.localEdits[key] = next;

            const supplierKey = String((body.sku || body.supplierKey || id) || '').trim().toUpperCase();
            if (supplierKey && body.supplierUrl !== undefined) {
              cache.supplierLinks[supplierKey] = {
                ...(cache.supplierLinks[supplierKey] || {}),
                url: String(body.supplierUrl || '').trim(),
                updatedAt: new Date().toISOString(),
                updatedBy: session.username,
              };
            }

            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: postAction === 'edit_meli' ? 'edit_publication_meli' : 'edit_publication_local',
              sku: next.sku || body.sku || '',
              message: postAction === 'edit_meli' ? `Se envio la edicion de ${id} a Mercado Libre.` : `Se editaron datos internos de ${id}.`,
              user: session.username,
            });
            savePublicationsCache(cache);
            audit(session, postAction === 'edit_meli' ? 'publications_edit_meli' : 'publications_edit_local', { cuenta, id });
            jsonResp(res, 200, { ok: true, item: cache.localEdits[key], meli: meliResult, groupSync: groupSyncResult });
            return;
          }

          if (postAction === 'movement') {
            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: body.type || 'manual',
              sku: body.sku || '',
              message: body.message || 'Movimiento registrado.',
              user: session.username,
            });
            savePublicationsCache(cache);
            jsonResp(res, 200, { ok: true });
            return;
          }

          jsonResp(res, 400, { error: 'Accion no soportada todavia' });
          return;
        }

        jsonResp(res, 405, { error: 'Metodo no permitido' });
      } catch (e) {
        console.error('Error publicaciones:', e.message);
        jsonResp(res, 500, { error: { message: e.message } });
      }
    })();
    return;
  }


  // ── CREADOR DE PUBLICACIONES IA v1 ───────────────
  // Primera etapa segura: analiza link, arma vista previa y guarda borradores.
  // No publica todavia en Mercado Libre.
  if (pathName === '/api/publicador') {
    (async () => {
      try {
        if (req.method === 'GET') {
          const action = u.searchParams.get('action') || 'drafts';
          if (action === 'drafts') {
            jsonResp(res, 200, loadPublicadorDrafts());
            return;
          }
          if (action === 'status') {
            const openaiConfigured = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY);
            jsonResp(res, 200, { ok: true, openaiConfigured, model: process.env.PUBLICADOR_OPENAI_MODEL || 'gpt-4o-mini' });
            return;
          }
          jsonResp(res, 400, { error: 'Accion no soportada' });
          return;
        }

        if (req.method !== 'POST') {
          jsonResp(res, 405, { error: 'Metodo no permitido' });
          return;
        }

        const body = await readBody(req);
        const action = body.action || u.searchParams.get('action') || 'analizar';

        if (action === 'analizar') {
          const url = String(body.url || '').trim();
          const price = Number(String(body.price || '').replace(',', '.'));
          const currency = ['UYU', 'USD', 'ARS'].includes(String(body.currency || '').toUpperCase()) ? String(body.currency).toUpperCase() : 'UYU';
          const stock = Math.max(1, Number(body.stock || 50) || 50);
          const accounts = Array.isArray(body.accounts) && body.accounts.length ? body.accounts : ['tlc', 'topshop'];
          if (!url || !/^https?:\/\//i.test(url)) {
            jsonResp(res, 400, { error: 'Falta un link valido del producto.' });
            return;
          }
          if (!price || price <= 0) {
            jsonResp(res, 400, { error: 'Falta precio valido.' });
            return;
          }

          const pageResp = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 TLC-Publicador/2.0' } });
          const buf = Buffer.from(await pageResp.arrayBuffer());
          const contentType = pageResp.headers.get('content-type') || '';
          const charset = (contentType.match(/charset=([^;]+)/i)?.[1] || '').toLowerCase();
          let html = buf.toString('utf8');
          if (charset && !charset.includes('utf') && (charset.includes('iso') || charset.includes('latin') || charset.includes('windows'))) {
            html = new TextDecoder('latin1').decode(buf);
          }
          let scraped = parsePublicadorHtml(html, url);
          // Si el link es de una publicacion de Mercado Libre, complementa fotos desde la API publica del item.
          // Esto no rompe proveedores comunes: solo suma fotos cuando encuentra MLU en el link/pagina.
          const meliIds = extractMeliIdsFromUrlOrHtml(url, html);
          if (meliIds.itemId || meliIds.catalogId || meliIds.userProductId) {
            const meliImages = await fetchMeliItemImagesFromPublicApi(meliIds.itemId, meliIds.catalogId, accounts[0] || 'tlc', meliIds.userProductId);
            if (meliImages.length) {
              scraped = {
                ...scraped,
                meliSourceItemId: meliIds.itemId || '',
                meliSourceCatalogId: meliIds.catalogId || '',
                meliSourceUserProductId: meliIds.userProductId || '',
                images: mergePublicadorImages(scraped.images || [], meliImages, url),
              };
            }
          }
          if (/makerworld\.com|bambulab\.com|bblmw\.com/i.test(url)) {
            const makerImages = await fetchMakerWorldImagesFromPublicApi(url);
            if (makerImages.length) {
              scraped = {
                ...scraped,
                makerWorldSource: true,
                images: mergePublicadorImages(scraped.images || [], makerImages, url),
              };
            }
          }
          const ai = await generatePublicadorContent({ ...scraped, url });
          const category = await detectPublicadorCategory(ai.titulo_meli || scraped.scrapedTitle);
          const allAttributes = addSyntheticSpecialRequirements(await getPublicadorCategoryAttributes(category.categoryId), category);
          const requiredAttributes = allAttributes.filter(isPublicadorRequiredAttr);
          const result = {
            id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
            status: 'preview',
            source: 'panel',
            url,
            price,
            currency,
            stock,
            accounts,
            createdAt: new Date().toISOString(),
            ...scraped,
            ...ai,
            ...category,
            requiredAttributes,
            allAttributes,
            specialRequirements: requiredAttributes.filter(a => a.tags && a.tags.synthetic),
          };
          result.meliPayload = buildPublicadorPayload(result);
          jsonResp(res, 200, { ok: true, draft: result });
          return;
        }

        if (action === 'recalcular_atributos') {
          const draft = body.draft && typeof body.draft === 'object' ? body.draft : {};
          const title = String(body.title || draft.titulo_meli || draft.scrapedTitle || '').trim();
          if (!title) {
            jsonResp(res, 400, { error: 'Falta titulo para consultar categoria y atributos.' });
            return;
          }
          const category = await detectPublicadorCategory(title);
          const allAttributes = addSyntheticSpecialRequirements(await getPublicadorCategoryAttributes(category.categoryId), category);
          const requiredAttributes = allAttributes.filter(isPublicadorRequiredAttr);
          const merged = {
            ...draft,
            titulo_meli: title,
            ...category,
            requiredAttributes,
            allAttributes,
            specialRequirements: requiredAttributes.filter(a => a.tags && a.tags.synthetic),
          };
          merged.meliPayload = buildPublicadorPayload(merged);
          jsonResp(res, 200, {
            ok: true,
            draft: merged,
            message: `Categoria y atributos recalculados desde Mercado Libre para: ${title}`,
          });
          return;
        }

        if (action === 'save_draft') {
          const draft = body.draft && typeof body.draft === 'object' ? body.draft : null;
          if (!draft) {
            jsonResp(res, 400, { error: 'Falta draft' });
            return;
          }
          const data = loadPublicadorDrafts();
          const id = String(draft.id || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')));
          const clean = { ...draft, id, status: draft.status || 'draft', updatedAt: new Date().toISOString() };
          clean.meliPayload = buildPublicadorPayload(clean);
          const idx = data.drafts.findIndex(d => String(d.id) === id);
          if (idx >= 0) data.drafts[idx] = clean;
          else data.drafts.unshift(clean);
          const saved = savePublicadorDrafts(data);
          audit(session, 'publicador_save_draft', { id, title: clean.titulo_meli || clean.scrapedTitle || '' });
          jsonResp(res, 200, { ok: true, draft: clean, total: saved.drafts.length });
          return;
        }

        if (action === 'delete_draft') {
          const id = String(body.id || '');
          const data = loadPublicadorDrafts();
          data.drafts = data.drafts.filter(d => String(d.id) !== id);
          savePublicadorDrafts(data);
          audit(session, 'publicador_delete_draft', { id });
          jsonResp(res, 200, { ok: true });
          return;
        }

        if (action === 'publicar') {
          const draft = body.draft && typeof body.draft === 'object' ? body.draft : null;
          if (!draft) {
            jsonResp(res, 400, { error: 'Falta la publicación preparada para enviar a Mercado Libre.' });
            return;
          }

          const accounts = (Array.isArray(draft.accounts) && draft.accounts.length ? draft.accounts : ['tlc'])
            .map(normalizeCuentaKey)
            .filter((v, i, arr) => ['tlc', 'topshop'].includes(v) && arr.indexOf(v) === i);

          if (!accounts.length) {
            jsonResp(res, 400, { error: 'Seleccioná al menos una cuenta para publicar: TLC o TOP SHOP.' });
            return;
          }

          if (!String(draft.gtin || draft.GTIN || '').trim()) {
            draft.noGtinGenericFallback = true;
            draft.forceGenericNoGtin = true;
          }
          const payload = buildPublicadorPayload(draft);
          const required = Array.isArray(draft.requiredAttributes) ? draft.requiredAttributes : [];
          const payloadAttrs = Array.isArray(payload.attributes) ? payload.attributes : [];
          const hasEmptyGtinReason = payloadAttrs.some(a => String(a.id).toUpperCase() === 'EMPTY_GTIN_REASON' && String(a.value_name || a.value_id || '').trim());
          const noGtinGeneric = !String(draft.gtin || draft.GTIN || '').trim() && (draft.noGtinGenericFallback || draft.forceGenericNoGtin || true);
          const missingAttrs = required
            .filter(attr => {
              const attrId = String(attr.id || '').toUpperCase();
              if (noGtinGeneric && (attrId === 'GTIN' || attrId === 'EMPTY_GTIN_REASON')) return false;
              if (attrId === 'GTIN' && hasEmptyGtinReason) return false;
              return !payloadAttrs.some(a => String(a.id) === String(attr.id) && String(a.value_name || a.value_id || '').trim());
            })
            .map(attr => ({ id: attr.id, name: attr.name || attr.id }));

          if (!payload.family_name || String(payload.family_name).trim().length < 8) {
            jsonResp(res, 400, { error: 'El título/nombre de familia está incompleto. Revisalo antes de publicar.' });
            return;
          }
          if (!payload.category_id || payload.category_id === 'MLU1574') {
            jsonResp(res, 400, { error: 'La categoría no parece correcta. Usá Reanalizar producto o recalculá atributos antes de publicar.' });
            return;
          }
          if (!payload.price || Number(payload.price) <= 0) {
            jsonResp(res, 400, { error: 'El precio está incompleto o inválido.' });
            return;
          }
          if (!Array.isArray(payload.pictures) || payload.pictures.length === 0) {
            jsonResp(res, 400, { error: 'Seleccioná al menos una foto para publicar.' });
            return;
          }
          if (missingAttrs.length) {
            jsonResp(res, 400, {
              error: `Faltan ${missingAttrs.length} atributo(s) obligatorio(s) de Mercado Libre. Completalos antes de publicar.`,
              missingAttributes: missingAttrs,
            });
            return;
          }

          const results = [];
          for (const cuenta of accounts) {
            try {
              const token = await getMeliAccessToken(cuenta);
              const payloadForAccount = await preparePublicadorPicturesForAccount(payload, token);
              const r = await fetch('https://api.mercadolibre.com/items', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                },
                body: JSON.stringify(cleanMeliCreatePayload(payloadForAccount)),
              });
              const raw = await r.text();
              let response = null;
              try { response = raw ? JSON.parse(raw) : {}; } catch { response = { raw }; }
              if (!r.ok || !response?.id) {
                let finalStatus = r.status;
                let causesRaw = Array.isArray(response?.cause) ? response.cause : [];
                let causes = causesRaw.map(c => [c.code, c.message].filter(Boolean).join(': ')).filter(Boolean);

                // Mercado Libre puede pedir GTIN o motivo de ausencia. El valor permitido puede variar por sitio/categoria,
                // por eso probamos primero los valores que devolvio /categories/:id/attributes y luego opciones comunes.
                let gtinRetrySuccess = false;
                if (errorNeedsEmptyGtinReasonRetry(response)) {
                  const genericPayload = forceGenericBrandNoGtinPayload(payloadForAccount);
                  const genericRetry = await fetch('https://api.mercadolibre.com/items', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify(genericPayload),
                  });
                  finalStatus = genericRetry.status;
                  const genericRaw = await genericRetry.text();
                  try { response = genericRaw ? JSON.parse(genericRaw) : {}; } catch { response = { raw: genericRaw }; }
                  if (genericRetry.ok && response?.id) {
                    const descriptionResult = await postMeliItemDescription(token, response.id, genericPayload?.description?.plain_text || payloadForAccount?.description?.plain_text || payload?.description?.plain_text);
                    response._tlc_description_result = descriptionResult;
                    results.push({ cuenta, ok: true, status: genericRetry.status, itemId: response?.id || null, permalink: response?.permalink || null, response, descriptionResult, retriedWithoutGtinAsGeneric: true, payload: genericPayload });
                    gtinRetrySuccess = true;
                  }

                  const reasons = gtinRetrySuccess ? [] : getEmptyGtinReasonValuesFromDraft(draft);
                  for (const reason of reasons) {
                    const retryPayload = JSON.parse(JSON.stringify(payloadForAccount));
                    setEmptyGtinReasonOnPayload(retryPayload, reason);
                    const retry = await fetch('https://api.mercadolibre.com/items', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                      body: JSON.stringify(cleanMeliCreatePayload(retryPayload)),
                    });
                    finalStatus = retry.status;
                    const retryRaw = await retry.text();
                    try { response = retryRaw ? JSON.parse(retryRaw) : {}; } catch { response = { raw: retryRaw }; }
                    if (retry.ok && response?.id) {
                      const descriptionResult = await postMeliItemDescription(token, response.id, retryPayload?.description?.plain_text || payloadForAccount?.description?.plain_text || payload?.description?.plain_text);
                      response._tlc_description_result = descriptionResult;
                      results.push({ cuenta, ok: true, status: retry.status, itemId: response?.id || null, permalink: response?.permalink || null, response, descriptionResult, retriedWithEmptyGtinReason: reason, payload: cleanMeliCreatePayload(retryPayload) });
                      gtinRetrySuccess = true;
                      break;
                    }
                    causesRaw = Array.isArray(response?.cause) ? response.cause : [];
                    causes = causesRaw.map(c => [c.code, c.message].filter(Boolean).join(': ')).filter(Boolean);
                    if (!/EMPTY_GTIN_REASON|GTIN/i.test(JSON.stringify(response || {}))) break;
                  }
                }
                if (gtinRetrySuccess) continue;

                // v88: si MeLi exige grilla de talles, primero intentamos crear/reusar una grilla real
                // y reintentar la publicacion en la categoria correcta. Si falla, probamos categoria alternativa.
                if (errorNeedsFashionGridRetry(response)) {
                  try {
                    const grid = await createFashionSizeChartForPayload(cuenta, token, payloadForAccount, draft);
                    if (grid && grid.payload) {
                      const gridRetry = await fetch('https://api.mercadolibre.com/items', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                        body: JSON.stringify(cleanMeliCreatePayload(grid.payload)),
                      });
                      finalStatus = gridRetry.status;
                      const gridRaw = await gridRetry.text();
                      try { response = gridRaw ? JSON.parse(gridRaw) : {}; } catch { response = { raw: gridRaw }; }
                      if (gridRetry.ok && response?.id) {
                        const descriptionResult = await postMeliItemDescription(token, response.id, grid.payload?.description?.plain_text || payloadForAccount?.description?.plain_text || payload?.description?.plain_text);
                        response._tlc_description_result = descriptionResult;
                        results.push({ cuenta, ok: true, status: gridRetry.status, itemId: response?.id || null, permalink: response?.permalink || null, response, descriptionResult, createdSizeGrid: true, chartId: grid.chart?.id || null, chartAttempt: grid.chartAttempt || '', payload: cleanMeliCreatePayload(grid.payload) });
                        continue;
                      }
                      const gridCauses = Array.isArray(response?.cause) ? response.cause.map(c => [c.code, c.message].filter(Boolean).join(': ')).filter(Boolean) : [];
                      // v93: no reintentamos con variations. En el modelo actual de User Products,
                      // Mercado Libre rechaza variations cuando el item usa family_name.
                      // La guía se asocia como atributos raíz SIZE_GRID_ID/SIZE_GRID_ROW_ID.
                      causes.push('Intenté crear/reusar grilla de talles pero MeLi rechazó el reintento' + (gridCauses.length ? ': ' + gridCauses.join(' | ') : '.'));
                    }
                  } catch (gridErr) {
                    causes.push('No se pudo crear/reusar grilla de talles automaticamente: ' + (gridErr.message || String(gridErr)));
                  }
                  const quick = await tryQuickPublishWithoutFashionGrid(cuenta, token, payloadForAccount, draft);
                  if (quick && quick.ok) {
                    results.push({
                      cuenta,
                      ok: true,
                      status: quick.status,
                      itemId: quick.response?.id || null,
                      permalink: quick.response?.permalink || null,
                      response: quick.response,
                      quickFashionGridFallback: true,
                      fallbackCategoryId: quick.alt?.categoryId || '',
                      fallbackCategoryName: quick.alt?.categoryName || '',
                      note: 'MeLi exigia grilla de talles. Se publico en categoria alternativa sin grilla para crear rapido y editar luego.',
                      payload: quick.payload,
                    });
                    continue;
                  }
                  causes.push('MeLi exige grilla de talles. Tambien intente categoria alternativa sin grilla, pero no se pudo publicar automaticamente.' + (quick?.message ? ' ' + quick.message : ''));
                  if (quick?.response) {
                    const quickCauses = Array.isArray(quick.response?.cause) ? quick.response.cause.map(c => [c.code, c.message].filter(Boolean).join(': ')).filter(Boolean) : [];
                    if (quickCauses.length) causes.push('Intento alternativo: ' + quickCauses.join(' | '));
                  }
                  if (quick?.alt?.categoryId) causes.push(`Categoria alternativa probada: ${quick.alt.categoryId} ${quick.alt.categoryName || ''}`.trim());
                }

                results.push({
                  cuenta,
                  ok: false,
                  status: finalStatus,
                  error: response?.message || response?.error || `Mercado Libre status ${finalStatus}`,
                  detail: causes.join(' | '),
                  response,
                });
              } else {
                const descriptionResult = await postMeliItemDescription(token, response.id, payloadForAccount?.description?.plain_text || payload?.description?.plain_text);
                response._tlc_description_result = descriptionResult;
                results.push({
                  cuenta,
                  ok: true,
                  status: r.status,
                  itemId: response?.id || null,
                  permalink: response?.permalink || null,
                  response,
                  descriptionResult,
                });
              }
            } catch (err) {
              results.push({
                cuenta,
                ok: false,
                error: err.message || String(err),
                detail: '',
              });
            }
          }

          const okCount = results.filter(r => r.ok).length;
          const data = loadPublicadorDrafts();
          const id = String(draft.id || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')));
          const clean = {
            ...draft,
            id,
            status: okCount === accounts.length ? 'published' : (okCount ? 'partial_error' : 'publish_error'),
            updatedAt: new Date().toISOString(),
            publishedAt: okCount ? new Date().toISOString() : draft.publishedAt || null,
            publishResults: results,
            lastPublishPayload: payload,
          };
          clean.meliPayload = payload;
          const idx = data.drafts.findIndex(d => String(d.id) === id);
          if (idx >= 0) data.drafts[idx] = clean;
          else data.drafts.unshift(clean);
          savePublicadorDrafts(data);

          try {
            const pubCache = loadPublicationsCache();
            pubCache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: 'publicador_publish',
              sku: clean.model || '',
              message: `Publicador IA: ${okCount}/${accounts.length} publicación(es) creadas.`,
              user: session.username,
            });
            savePublicationsCache(pubCache);
          } catch {}

          audit(session, 'publicador_publish', { id, accounts, okCount, results: results.map(r => ({ cuenta: r.cuenta, ok: r.ok, itemId: r.itemId || null, error: r.error || null })) });

          jsonResp(res, 200, {
            ok: okCount > 0,
            complete: okCount === accounts.length,
            okCount,
            total: accounts.length,
            draft: clean,
            results,
            payload,
          });
          return;
        }

        jsonResp(res, 400, { error: 'Accion no soportada' });
      } catch (e) {
        console.error('Error publicador:', e.message);
        jsonResp(res, 500, { error: e.message });
      }
    })();
    return;
  }

  // ── CHAT con Claude (Anthropic) ───────────────
  if (req.method === 'POST' && pathName === '/api/chat') {
    (async () => {
      try {
        const data = await readBody(req);
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':       'application/json',
            'x-api-key':          data.apiKey,
            'anthropic-version':  '2023-06-01',
          },
          body: JSON.stringify({
            model:      data.model || 'claude-sonnet-4-5',
            max_tokens: data.max_tokens || 1500,
            system:     data.system || '',
            messages:   data.messages || [],
          }),
        });
        jsonResp(res, r.status, await r.json());
      } catch (e) {
        jsonResp(res, 500, { error: { message: e.message } });
      }
    })();
    return;
  }

  // ── ARCHIVOS ESTÁTICOS ────────────────────────
  // Bloquear acceso directo a users.json y .bat
  if (pathName.includes('users.json') || pathName.includes('/data/') || pathName.endsWith('.bat') || pathName.endsWith('.js')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Restringir admin.html solo a admins
  if (pathName === '/admin.html' && session.role !== 'admin') {
    res.writeHead(302, { 'Location': '/index.html' });
    res.end();
    return;
  }

  const file = pathName === '/' ? 'index.html' : decodeURIComponent(pathName).slice(1);
  serveStatic(res, file);
});

function serveStatic(res, file) {
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = {
      '.html': 'text/html',
      '.js':   'application/javascript',
      '.css':  'text/css',
      '.json': 'application/json',
    }[path.extname(file)] || 'text/plain';
    res.writeHead(200, {
      'Content-Type':                mime + '; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  loadUsers(); // crea admin si es primera vez
  loadInboxState(); // crea data/inbox-state.json si es primera vez
  loadAuditLog(); // crea data/audit-log.json si es primera vez
  loadPublicationsCache(); // crea data/publications-cache.json si es primera vez
  loadPublicadorDrafts(); // crea data/publicador-borradores.json si es primera vez
  const autoMs = Number(process.env.PUBLICATIONS_LINKED_AUTO_SYNC_MS || 0);
  if (autoMs > 0) setInterval(runAutoLinkedSync, autoMs);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TELOCONSIGO + TOP SHOP — Panel v68 PUBLICADOR SIN GTIN');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  ✓ Servidor activo: http://localhost:${PORT}`);
  console.log(`  ✓ TELOCONSIGO:     ${WEBHOOKS.tlc}`);
  console.log(`  ✓ ADS TOP SHOP:    ${WEBHOOKS.topshop}`);
  console.log(`  ✓ INBOX TLC:       ${INBOX_WEBHOOKS.tlc}`);
  console.log(`  ✓ INBOX TOP SHOP:  ${INBOX_WEBHOOKS.topshop}`);
  console.log(`  ✓ PUB TLC OAuth: ${process.env.MELI_REFRESH_TOKEN_TLC || process.env.MELI_ACCESS_TOKEN_TLC ? 'configurado' : 'FALTA MELI_REFRESH_TOKEN_TLC'}`);
  console.log(`  ✓ PUB TOP OAuth: ${process.env.MELI_REFRESH_TOKEN_TOPSHOP || process.env.MELI_ACCESS_TOKEN_TOPSHOP ? 'configurado' : 'FALTA MELI_REFRESH_TOKEN_TOPSHOP'}`);
  console.log(`  ✓ OPENAI IA:      ${process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY ? 'configurada' : 'FALTA OPENAI_API_KEY'}`);
  console.log('');
  console.log('  Abrí http://localhost:8080 en Chrome');
  console.log('');
  console.log('  Para detener: Ctrl+C');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
