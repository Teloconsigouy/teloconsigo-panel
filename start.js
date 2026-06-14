// ═══════════════════════════════════════════════
//  TELOCONSIGO + TOP SHOP — Panel de Control
//  v49 LOCAL DEV — Publicaciones directas MeLi + vinculaciones simples
// ═══════════════════════════════════════════════

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Carga variables locales desde .env cuando se ejecuta en PC. En Railway usa Variables.
try { require('dotenv').config(); } catch {}

const PORT = Number(process.env.PORT || 8080);


// ═══════════════════════════════════════════════
//  ESTADOS PERSISTENTES DE BANDEJA
//  Guarda leído/no leído, pendientes, descartados y reclamos en JSON.
// ═══════════════════════════════════════════════
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const STATE_FILE = path.join(DATA_DIR, 'inbox-state.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');
const PUBLICATIONS_CACHE_FILE = path.join(DATA_DIR, 'publications-cache.json');
const PRECIOS_FILE = path.join(DATA_DIR, 'precios.json');
const BUNDLED_PRECIOS_FILE = path.join(DEFAULT_DATA_DIR, 'precios.json');

const MODULES = {
  meliads: { label: 'MeLi ADS', pages: ['/meliads.html'], api: ['/api/meli'] },
  inbox: { label: 'Bandeja MeLi', pages: ['/inbox.html'], api: ['/api/inbox', '/api/state'] },
  prices: { label: 'Lista de Precios', pages: ['/precios.html'], api: [] },
  publications: { label: 'Publicaciones', pages: ['/publicaciones.html'], api: ['/api/publications'] },
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


// ═══════════════════════════════════════════════
//  LISTA DE PRECIOS — Base local JSON sin Drive
// ═══════════════════════════════════════════════
const PRECIOS_VAT_RATE = 0.22;

function defaultPreciosDb() {
  return { version: 1, products: [], updatedAt: new Date().toISOString() };
}
function loadPreciosDb() {
  ensureDataDir();
  if (!fs.existsSync(PRECIOS_FILE)) {
    // Railway: si DATA_DIR apunta a un Volume vacio, sembramos la base inicial
    // desde el archivo incluido en el repo. No pisa cambios si el archivo ya existe.
    if (BUNDLED_PRECIOS_FILE !== PRECIOS_FILE && fs.existsSync(BUNDLED_PRECIOS_FILE)) {
      fs.copyFileSync(BUNDLED_PRECIOS_FILE, PRECIOS_FILE);
    } else {
      const initial = defaultPreciosDb();
      fs.writeFileSync(PRECIOS_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
  }
  try {
    const data = JSON.parse(fs.readFileSync(PRECIOS_FILE, 'utf8'));
    return { ...defaultPreciosDb(), ...data, products: Array.isArray(data.products) ? data.products : [] };
  } catch (e) {
    try { fs.copyFileSync(PRECIOS_FILE, PRECIOS_FILE + '.broken-' + Date.now()); } catch {}
    const initial = defaultPreciosDb();
    fs.writeFileSync(PRECIOS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}
function savePreciosDb(db) {
  ensureDataDir();
  const products = (db.products || []).map((p, i) => ({ ...p, rowNumber: i + 2 }));
  const clean = { ...db, products, updatedAt: new Date().toISOString() };
  fs.writeFileSync(PRECIOS_FILE, JSON.stringify(clean, null, 2));
  return clean;
}
function preciosParseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  let str = String(value).trim();
  if (str.includes(',') && str.includes('.')) str = str.replace(/\./g, '').replace(',', '.');
  else if (str.includes(',')) str = str.replace(',', '.');
  str = str.replace(/[^\d.-]/g, '');
  const num = parseFloat(str);
  return Number.isNaN(num) ? 0 : num;
}
function preciosRound2(num) { return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100; }
function preciosText(v) { return String(v || '').trim(); }
function preciosModo(v) { const m = String(v || '').trim().toLowerCase(); return (m === 'pvp_descuento' || m === 'pvp proveedor + descuento') ? 'pvp_descuento' : 'costo_directo'; }
function preciosMoneda(v) { const m = String(v || '').trim().toUpperCase(); return (m === 'USD' || m === 'UYU') ? m : m; }
function preciosVatFromGross(gross) { const g = preciosParseNumber(gross); return preciosRound2(g - (g / (1 + PRECIOS_VAT_RATE))); }
function preciosComision(pvp, pct) { return preciosRound2(preciosParseNumber(pvp) * (preciosParseNumber(pct) / 100)); }
function preciosIvaDgi(costo, pvp, pct) { return preciosRound2(preciosVatFromGross(pvp) - preciosVatFromGross(costo) - preciosVatFromGross(preciosComision(pvp, pct))); }
function preciosGain(costo, pvp, pct, fijo) { return preciosRound2((preciosParseNumber(pvp) - preciosParseNumber(costo)) - preciosIvaDgi(costo, pvp, pct) - preciosComision(pvp, pct) - preciosParseNumber(fijo)); }
function preciosMargin(costo, pvp, pct, fijo) { const venta = preciosParseNumber(pvp); return venta <= 0 ? 0 : preciosRound2((preciosGain(costo, venta, pct, fijo) / venta) * 100); }
function preciosMetrics(costo, pvp, pct, fijo, acos, promo) {
  const c = preciosRound2(costo), venta = preciosRound2(pvp), cm = preciosParseNumber(pct), f = preciosParseNumber(fijo), a = preciosParseNumber(acos), pr = preciosParseNumber(promo);
  const descuentoPromocionImporte = preciosRound2(venta * (pr / 100));
  const ventaFinal = preciosRound2(venta - descuentoPromocionImporte);
  const costoPublicidadAcos = preciosRound2(ventaFinal * (a / 100));
  const comisionMlImporteFinal = preciosComision(ventaFinal, cm);
  const ivaDgiFinal = preciosIvaDgi(c, ventaFinal, cm);
  const gananciaAntesPublicidad = preciosRound2((ventaFinal - c) - ivaDgiFinal - comisionMlImporteFinal - f);
  const gananciaFinal = preciosRound2(gananciaAntesPublicidad - costoPublicidadAcos);
  const margenFinal = ventaFinal > 0 ? preciosRound2((gananciaFinal / ventaFinal) * 100) : 0;
  const acosMaximoRentable = ventaFinal > 0 ? preciosRound2(Math.max(0, gananciaAntesPublicidad / ventaFinal * 100)) : 0;
  const costoPublicidadMaximo = preciosRound2(Math.max(0, gananciaAntesPublicidad));
  return {
    precioProveedor: c, pvp: venta, comisionMlPct: cm, comisionMlImporte: preciosComision(venta, cm), ivaComisionMl: preciosVatFromGross(preciosComision(venta, cm)), envioCostoFijo: f,
    ivaCompra: preciosVatFromGross(c), ivaVenta: preciosVatFromGross(venta), ivaDgi: preciosIvaDgi(c, venta, cm), gananciaReal: preciosGain(c, venta, cm, f), margenReal: preciosMargin(c, venta, cm, f),
    acos: a, descuentoPromocion: pr, descuentoPromocionImporte, ventaFinal, costoPublicidadAcos, gananciaAntesPublicidad, acosMaximoRentable, costoPublicidadMaximo, comisionMlImporteFinal, ivaComisionMlFinal: preciosVatFromGross(comisionMlImporteFinal), ivaVentaFinal: preciosVatFromGross(ventaFinal), ivaDgiFinal, gananciaFinal, margenFinal
  };
}
function preciosNormalizeInput(data) {
  const modoCosto = preciosModo(data.modoCosto);
  const pvpProveedor = preciosParseNumber(data.pvpProveedor);
  const descuentoProveedorPct = preciosParseNumber(data.descuentoProveedorPct);
  const precioProveedorIngresado = preciosParseNumber(data.precioProveedor);
  const pvpIngresado = preciosParseNumber(data.pvp);
  const precioProveedor = modoCosto === 'pvp_descuento' ? preciosRound2(pvpProveedor * (1 - descuentoProveedorPct / 100)) : preciosRound2(precioProveedorIngresado);
  const pvp = modoCosto === 'pvp_descuento' ? preciosRound2(pvpProveedor) : preciosRound2(pvpIngresado);
  return {
    originalRowNumber: preciosParseNumber(data.originalRowNumber), articulo: preciosText(data.articulo), codigoTLC: preciosText(data.codigoTLC), proveedor: preciosText(data.proveedor), codigoProveedor: preciosText(data.codigoProveedor), codigoFabrica: preciosText(data.codigoFabrica), moneda: preciosMoneda(data.moneda), modoCosto,
    precioProveedor, pvpProveedor, descuentoProveedorPct, pvp, comisionMlPct: preciosParseNumber(data.comisionMlPct), envioCostoFijo: preciosParseNumber(data.envioCostoFijo), acos: preciosParseNumber(data.acos), descuentoPromocion: preciosParseNumber(data.descuentoPromocion)
  };
}
function preciosIncomplete(data) {
  const fields = [];
  if (!preciosText(data.articulo)) fields.push('Artículo');
  if (!preciosText(data.codigoTLC)) fields.push('Código TLC');
  if (!preciosText(data.codigoProveedor)) fields.push('Código Proveedor');
  if (!preciosText(data.proveedor)) fields.push('Proveedor');
  if (!preciosText(data.moneda)) fields.push('Moneda');
  if (preciosParseNumber(data.precioProveedor) <= 0) fields.push('Precio Proveedor');
  if (preciosParseNumber(data.pvp) <= 0) fields.push('PVP');
  if (preciosModo(data.modoCosto) === 'pvp_descuento' && preciosParseNumber(data.pvpProveedor) <= 0) fields.push('PVP Proveedor');
  return fields;
}
function preciosValidate(data, opts = {}) {
  if (opts.isUpdate && !data.originalRowNumber) throw new Error('Falta la fila original del producto.');
  if (!opts.allowIncompleteCore) {
    if (!data.articulo) throw new Error('El Artículo es obligatorio.');
    if (!data.codigoTLC) throw new Error('El Código TLC es obligatorio.');
  }
  if (!data.moneda) throw new Error('La Moneda es obligatoria.');
  if (data.moneda !== 'USD' && data.moneda !== 'UYU') throw new Error('La Moneda debe ser USD o UYU.');
  if (data.modoCosto === 'pvp_descuento') {
    if (data.pvpProveedor <= 0) throw new Error('En modo PVP proveedor + descuento, el PVP Proveedor debe ser mayor a 0.');
    if (data.descuentoProveedorPct < 0 || data.descuentoProveedorPct > 100) throw new Error('El Descuento Proveedor % debe estar entre 0 y 100.');
  } else {
    if (data.precioProveedor < 0) throw new Error('El Precio Proveedor no puede ser negativo.');
    if (data.pvp <= 0) throw new Error('El PVP debe ser mayor a 0.');
  }
  if (data.comisionMlPct < 0) throw new Error('La Comisión ML % no puede ser negativa.');
  if (data.envioCostoFijo < 0) throw new Error('El Envío / Costo fijo no puede ser negativo.');
  if (data.acos < 0) throw new Error('El ACOS % no puede ser negativo.');
  if (data.descuentoPromocion < 0 || data.descuentoPromocion > 100) throw new Error('El Descuento Promoción % debe estar entre 0 y 100.');
}
function preciosResponse(data, extra = {}) {
  const base = { success: true, articulo: data.articulo, codigoTLC: data.codigoTLC, proveedor: data.proveedor, codigoProveedor: data.codigoProveedor, codigoFabrica: data.codigoFabrica, moneda: data.moneda, modoCosto: data.modoCosto, pvpProveedor: data.pvpProveedor, descuentoProveedorPct: data.descuentoProveedorPct, ...preciosMetrics(data.precioProveedor, data.pvp, data.comisionMlPct, data.envioCostoFijo, data.acos, data.descuentoPromocion) };
  const incompleteFields = preciosIncomplete(base);
  return { ...base, incompleto: incompleteFields.length > 0, incompleteFields, ...extra };
}
function preciosFindIndex(db, idOrRow) {
  const n = preciosParseNumber(idOrRow);
  if (n >= 2 && n - 2 < db.products.length) return n - 2;
  return db.products.findIndex(p => String(p.id) === String(idOrRow) || String(p.codigoTLC) === String(idOrRow));
}
function preciosEnsureUnique(db, data, excludedIndex = -1) {
  const proveedor = preciosText(data.proveedor).toLowerCase();
  const codigo = preciosText(data.codigoTLC);
  if (!codigo) return;
  const found = db.products.findIndex((p, i) => i !== excludedIndex && preciosText(p.codigoTLC) === codigo && preciosText(p.proveedor).toLowerCase() === proveedor);
  if (found >= 0) throw new Error('Ya existe un producto con ese Código TLC para ese mismo proveedor.');
}
async function handlePreciosApi(req, res, pathName, session) {
  try {
    const db = loadPreciosDb();
    const parts = pathName.split('/').filter(Boolean);
    const id = parts[2] || '';

    if (req.method === 'GET' && pathName === '/api/precios') {
      jsonResp(res, 200, { ok: true, products: db.products.map((p, i) => ({ ...p, rowNumber: i + 2 })) });
      return;
    }
    if (req.method === 'POST' && pathName === '/api/precios/preview') {
      const body = await readBody(req);
      const normalized = preciosNormalizeInput(body);
      preciosValidate(normalized, { allowIncompleteCore: true });
      jsonResp(res, 200, preciosResponse(normalized));
      return;
    }
    if (req.method === 'POST' && pathName === '/api/precios/target-price') {
      const body = await readBody(req);
      const normalized = preciosNormalizeInput(body);
      preciosValidate(normalized, { allowIncompleteCore: true });
      const targetMarginPct = preciosParseNumber(body.targetMarginPct);
      if (targetMarginPct <= -99) throw new Error('El margen objetivo debe ser mayor a -99%.');
      if (targetMarginPct >= 95) throw new Error('El margen objetivo debe ser menor a 95%.');
      let low = Math.max(0.01, normalized.precioProveedor + normalized.envioCostoFijo);
      let high = Math.max(low * 2, 1);
      let guard = 0;
      while (preciosMetrics(normalized.precioProveedor, high, normalized.comisionMlPct, normalized.envioCostoFijo, normalized.acos, normalized.descuentoPromocion).margenFinal < targetMarginPct && guard < 60) { high *= 2; guard++; }
      if (guard >= 60) throw new Error('No se pudo calcular un precio para ese margen objetivo.');
      for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2;
        const margin = preciosMetrics(normalized.precioProveedor, mid, normalized.comisionMlPct, normalized.envioCostoFijo, normalized.acos, normalized.descuentoPromocion).margenFinal;
        if (margin < targetMarginPct) low = mid; else high = mid;
      }
      const suggestedPvp = preciosRound2(high);
      const response = preciosResponse({ ...normalized, pvp: suggestedPvp });
      jsonResp(res, 200, { ...response, targetMarginPct: preciosRound2(targetMarginPct), suggestedPvp, achievedMarginPct: preciosMetrics(normalized.precioProveedor, suggestedPvp, normalized.comisionMlPct, normalized.envioCostoFijo, normalized.acos, normalized.descuentoPromocion).margenFinal });
      return;
    }
    if (req.method === 'POST' && pathName === '/api/precios') {
      const body = await readBody(req);
      const normalized = preciosNormalizeInput(body);
      preciosValidate(normalized);
      preciosEnsureUnique(db, normalized);
      const item = preciosResponse(normalized, { id: crypto.randomBytes(8).toString('hex'), rowNumber: db.products.length + 2 });
      db.products.push(item);
      savePreciosDb(db);
      audit(session, 'precios_create', { codigoTLC: item.codigoTLC, articulo: item.articulo });
      jsonResp(res, 200, item);
      return;
    }
    if (req.method === 'PUT' && parts[0] === 'api' && parts[1] === 'precios' && id) {
      const body = await readBody(req);
      const idx = preciosFindIndex(db, id);
      if (idx < 0) throw new Error('No se encontró el producto.');
      const normalized = preciosNormalizeInput({ ...body, originalRowNumber: idx + 2 });
      preciosValidate(normalized, { isUpdate: true });
      preciosEnsureUnique(db, normalized, idx);
      const old = db.products[idx] || {};
      const item = preciosResponse(normalized, { id: old.id || crypto.randomBytes(8).toString('hex'), rowNumber: idx + 2, originalRowNumber: idx + 2 });
      db.products[idx] = item;
      savePreciosDb(db);
      audit(session, 'precios_update', { codigoTLC: item.codigoTLC, articulo: item.articulo });
      jsonResp(res, 200, item);
      return;
    }
    if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'precios' && id) {
      const idx = preciosFindIndex(db, id);
      if (idx < 0) throw new Error('No se encontró el producto.');
      const removed = db.products.splice(idx, 1)[0];
      savePreciosDb(db);
      audit(session, 'precios_delete', { codigoTLC: removed.codigoTLC, articulo: removed.articulo });
      jsonResp(res, 200, { success: true });
      return;
    }
    jsonResp(res, 404, { error: 'Ruta de precios no encontrada' });
  } catch (e) {
    jsonResp(res, 500, { error: { message: e.message } });
  }
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

  // ── LISTA DE PRECIOS local ─────────────────────
  if (pathName === '/api/precios' || pathName.startsWith('/api/precios/')) {
    handlePreciosApi(req, res, pathName, session);
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
  loadPreciosDb(); // crea data/precios.json si es primera vez
  const autoMs = Number(process.env.PUBLICATIONS_LINKED_AUTO_SYNC_MS || 0);
  if (autoMs > 0) setInterval(runAutoLinkedSync, autoMs);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TELOCONSIGO + TOP SHOP — Panel v38 (Publicaciones sin n8n)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  ✓ Servidor activo: http://localhost:${PORT}`);
  console.log(`  ✓ TELOCONSIGO:     ${WEBHOOKS.tlc}`);
  console.log(`  ✓ ADS TOP SHOP:    ${WEBHOOKS.topshop}`);
  console.log(`  ✓ INBOX TLC:       ${INBOX_WEBHOOKS.tlc}`);
  console.log(`  ✓ INBOX TOP SHOP:  ${INBOX_WEBHOOKS.topshop}`);
  console.log(`  ✓ PUB TLC OAuth: ${process.env.MELI_REFRESH_TOKEN_TLC || process.env.MELI_ACCESS_TOKEN_TLC ? 'configurado' : 'FALTA MELI_REFRESH_TOKEN_TLC'}`);
  console.log(`  ✓ PUB TOP OAuth: ${process.env.MELI_REFRESH_TOKEN_TOPSHOP || process.env.MELI_ACCESS_TOKEN_TOPSHOP ? 'configurado' : 'FALTA MELI_REFRESH_TOKEN_TOPSHOP'}`);
  console.log('');
  console.log('  Abrí http://localhost:8080 en Chrome');
  console.log('');
  console.log('  Para detener: Ctrl+C');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
