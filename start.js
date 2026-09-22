// ═══════════════════════════════════════════════
//  TELOCONSIGO + TOP SHOP — Panel de Control
//  v104 REPARADO — base v50 Bandeja MeLi + Publicador v103
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
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const PRECIOS_FILE = path.join(DATA_DIR, 'precios.json');
const BUNDLED_PRECIOS_FILE = path.join(DEFAULT_DATA_DIR, 'precios.json');
const ROOT_PRECIOS_FILE = path.join(__dirname, 'precios.json');

const MODULES = {
  meliads: { label: 'MeLi ADS', pages: ['/meliads.html'], api: ['/api/meli'] },
  inbox: { label: 'Bandeja MeLi', pages: ['/inbox.html'], api: ['/api/inbox', '/api/state'] },
  prices: { label: 'Lista de Precios', pages: ['/precios.html'], api: ['/api/precios'] },
  publications: { label: 'Publicaciones', pages: ['/publicaciones.html'], api: ['/api/publications'] },
  publicador: { label: 'Creador de Publicaciones', pages: ['/publicador.html'], api: ['/api/publicador'] },
  assistant: { label: 'Asistente IA', pages: ['/assistant.html'], api: ['/api/assistant'] },
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
    // Railway/local: si DATA_DIR apunta a un Volume vacio, sembramos la base inicial.
    // Primero intenta /data/precios.json del repo y luego precios.json en la raiz.
    // No pisa cambios si PRECIOS_FILE ya existe.
    if (BUNDLED_PRECIOS_FILE !== PRECIOS_FILE && fs.existsSync(BUNDLED_PRECIOS_FILE)) {
      fs.copyFileSync(BUNDLED_PRECIOS_FILE, PRECIOS_FILE);
    } else if (ROOT_PRECIOS_FILE !== PRECIOS_FILE && fs.existsSync(ROOT_PRECIOS_FILE)) {
      fs.copyFileSync(ROOT_PRECIOS_FILE, PRECIOS_FILE);
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


    if (req.method === 'POST' && pathName === '/api/precios/ia-chat') {
      const body = await readBody(req);
      const message = String(body.message || '').trim();
      if (!message) {
        jsonResp(res, 400, { error: 'Falta el mensaje.' });
        return;
      }

      const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
      if (!apiKey) {
        jsonResp(res, 500, { error: 'Falta OPENAI_API_KEY en el servidor.' });
        return;
      }

      const productsLite = (db.products || []).map((p, idx) => ({
        index: idx,
        id: p.id || p.rowNumber || p.codigoTLC || idx,
        articulo: p.articulo || p.nombre || '',
        codigoTLC: p.codigoTLC || '',
        codigoProveedor: p.codigoProveedor || '',
        codigoFabrica: p.codigoFabrica || '',
        proveedor: p.proveedor || '',
        moneda: p.moneda || '',
        precioProveedor: Number(p.precioProveedor || 0),
        pvp: Number(p.pvp || 0),
        gananciaReal: Number(p.gananciaReal || 0),
        margenReal: Number(p.margenReal || 0),
        comisionMlPct: Number(p.comisionMlPct || 0),
        envioCostoFijo: Number(p.envioCostoFijo || 0),
        incompleto: !!p.incompleto
      }));

      const normalizedQuery = message.toLowerCase();
      const terms = normalizedQuery
        .split(/[^a-z0-9áéíóúñ.%]+/i)
        .map(t => t.trim())
        .filter(t => t.length >= 3)
        .slice(0, 8);

      let candidates = productsLite.filter(p => {
        const hay = `${p.articulo} ${p.codigoTLC} ${p.codigoProveedor} ${p.codigoFabrica} ${p.proveedor}`.toLowerCase();
        return terms.some(t => hay.includes(t));
      });

      if (/margen\s+menor|menor\s+a|menos\s+de/i.test(message)) {
        const m = message.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (m) {
          const limit = Number(m[1].replace(',', '.'));
          candidates = productsLite.filter(p => Number(p.margenReal || 0) < limit);
        }
      }

      if (/incomplet/i.test(message)) {
        candidates = productsLite.filter(p => p.incompleto);
      }

      if (!candidates.length) candidates = productsLite.slice(0, 80);

      candidates = candidates
        .sort((a, b) => {
          if (/margen/i.test(message)) return Number(a.margenReal || 0) - Number(b.margenReal || 0);
          return 0;
        })
        .slice(0, 120);

      const systemPrompt = `
Sos el asistente interno de TELOCONSIGO para el módulo Lista de Precios.
Respondé en español rioplatense, claro y práctico.
Tu trabajo es buscar productos, explicar costos, márgenes, rentabilidad, descuentos y ACOS.
No inventes datos. Usá solo los productos enviados.
En esta primera versión NO podés modificar precios ni productos. Si el usuario pide cambios, prepará una propuesta y aclarale que requiere confirmación en una próxima versión.
Cuando muestres productos, usá formato breve: artículo, código TLC, proveedor, PVP, ganancia y margen.
`;

      if (typeof fetch !== 'function') {
        jsonResp(res, 500, { error: 'Esta versión local de Node no tiene fetch. Actualizá Node a versión 18 o superior.' });
        return;
      }

      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify({
              consulta: message,
              totalProductosBase: productsLite.length,
              productosCandidatos: candidates
            }) }
          ]
        })
      });

      const data = await openaiRes.json();

      if (!openaiRes.ok) {
        jsonResp(res, 500, { error: data?.error?.message || 'Error consultando OpenAI.' });
        return;
      }

      jsonResp(res, 200, { answer: data?.choices?.[0]?.message?.content || '' });
      return;
    }

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
    catalog_listing: Boolean(raw.catalog_listing || raw.catalogListing),
    catalog_product_id: raw.catalog_product_id || raw.catalogProductId || null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
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

async function getMeliItemForSmartUpdate(cuenta, itemId) {
  const attrs = [
    'id','title','price','currency_id','available_quantity','status','sold_quantity',
    'variations','user_product_id','inventory_id','catalog_listing','catalog_product_id','seller_id',
    'seller_custom_field','attributes','shipping','tags'
  ].join(',');
  return await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}?attributes=${encodeURIComponent(attrs)}`);
}

function getVariationSellerSku(v) {
  if (!v || typeof v !== 'object') return '';
  if (v.seller_custom_field) return String(v.seller_custom_field).trim();
  const attrs = Array.isArray(v.attributes) ? v.attributes : [];
  const skuAttr = attrs.find(a => ['SELLER_SKU','SKU'].includes(String(a?.id || '').toUpperCase()));
  return String(skuAttr?.value_name || skuAttr?.value_id || '').trim();
}

async function updateUserProductStockSmart(cuenta, userProductId, targetQty) {
  const token = await getMeliAccessToken(cuenta);
  const stockUrl = `https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock`;
  const r = await fetch(stockUrl, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data?.message || data?.error || text || `No se pudo consultar stock de ${userProductId}`);
  const version = r.headers.get('x-version') || r.headers.get('X-Version') || '';
  const locations = Array.isArray(data?.locations) ? data.locations : [];
  const sellerWarehouses = locations.filter(x => String(x?.type || '') === 'seller_warehouse');
  const sellingAddresses = locations.filter(x => String(x?.type || '') === 'selling_address');

  if (sellerWarehouses.length) {
    if (!version) throw new Error(`Mercado Libre no devolvio x-version para stock de ${userProductId}.`);
    const totalCurrent = sellerWarehouses.reduce((a,x)=>a+Math.max(0,Number(x.quantity||0)),0);
    let remaining = Math.max(0, Number(targetQty)||0);
    const mapped = sellerWarehouses.map((x,i) => {
      let q;
      if (i === sellerWarehouses.length - 1) q = remaining;
      else if (totalCurrent > 0) q = Math.min(remaining, Math.round((Number(x.quantity||0) / totalCurrent) * Number(targetQty||0)));
      else q = i === 0 ? remaining : 0;
      remaining -= q;
      return { store_id: x.store_id, network_node_id: x.network_node_id, quantity: Math.max(0,q) };
    });
    const body = { locations: mapped };
    const rr = await fetch(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock/type/seller_warehouse`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json', 'x-version': version },
      body: JSON.stringify(body),
    });
    const tt = await rr.text();
    let jj = null; try { jj = tt ? JSON.parse(tt) : {}; } catch { jj = { raw: tt }; }
    if (!rr.ok) throw new Error(jj?.message || jj?.error || tt || `No se pudo actualizar stock multi-origen de ${userProductId}`);
    return { ok:true, mode:'user_product_seller_warehouse', user_product_id:userProductId, sent:body, response:jj };
  }

  // Stock tipo selling_address.
  // No lo bloqueamos por site de forma preventiva: algunas cuentas pueden tener el flujo
  // habilitado aunque la documentacion general limite su disponibilidad. Dejamos que
  // Mercado Libre decida y devolvemos el error real si el endpoint no esta habilitado.
  if (sellingAddresses.length) {
    if (!version) throw new Error(`Mercado Libre no devolvio x-version para stock de ${userProductId}.`);

    async function putSellingAddress(ver) {
      const rr = await fetch(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock/type/selling_address`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'x-version': String(ver),
        },
        body: JSON.stringify({ quantity: Math.max(0, Number(targetQty)||0) }),
      });
      const tt = await rr.text();
      let jj = null; try { jj = tt ? JSON.parse(tt) : {}; } catch { jj = { raw: tt }; }
      return { rr, jj, tt };
    }

    let attempt = await putSellingAddress(version);
    // Mercado Libre usa 409 cuando cambio la version del stock entre el GET y el PUT.
    // En ese caso refrescamos x-version una sola vez y reintentamos.
    if (attempt.rr.status === 409) {
      const refresh = await fetch(stockUrl, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
      const refreshText = await refresh.text();
      let refreshData = null; try { refreshData = refreshText ? JSON.parse(refreshText) : {}; } catch { refreshData = { raw: refreshText }; }
      if (!refresh.ok) throw new Error(refreshData?.message || refreshData?.error || refreshText || `No se pudo refrescar la version de stock de ${userProductId}`);
      const freshVersion = refresh.headers.get('x-version') || refresh.headers.get('X-Version') || '';
      if (!freshVersion) throw new Error(`Mercado Libre no devolvio x-version al refrescar stock de ${userProductId}.`);
      attempt = await putSellingAddress(freshVersion);
    }

    if (!attempt.rr.ok) {
      const msg = attempt.jj?.message || attempt.jj?.error || attempt.tt || `No se pudo actualizar stock selling_address de ${userProductId}`;
      const msgLower = String(msg || '').toLowerCase();

      // En MLU el endpoint selling_address puede estar bloqueado. En ese caso,
      // si la cuenta esta migrada a stock por deposito, Mercado Libre indica usar
      // seller_warehouse. Descubrimos los depositos reales de la cuenta y usamos
      // automaticamente el unico deposito activo cuando no hay ambiguedad.
      if (msgLower.includes('site is blocked') || msgLower.includes('blocked for modifications to the selling address')) {
        const userId = String(data?.user_id || '').trim();
        if (!userId) throw new Error(`selling_address bloqueado y Mercado Libre no devolvio user_id para buscar depositos (${userProductId}).`);

        let userInfo = {};
        try {
          const ur = await fetch(`https://api.mercadolibre.com/users/${encodeURIComponent(userId)}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
          });
          const ut = await ur.text();
          try { userInfo = ut ? JSON.parse(ut) : {}; } catch { userInfo = {}; }
        } catch {}
        const userTags = Array.isArray(userInfo?.tags) ? userInfo.tags.map(x=>String(x)) : [];

        const sr = await fetch(`https://api.mercadolibre.com/users/${encodeURIComponent(userId)}/stores/search?tags=stock_location`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        const st = await sr.text();
        let storesData = null; try { storesData = st ? JSON.parse(st) : {}; } catch { storesData = { raw: st }; }
        if (!sr.ok) throw new Error(`selling_address bloqueado. No se pudieron consultar los depositos de la cuenta: ${storesData?.message || storesData?.error || st || sr.status}`);

        const stores = (Array.isArray(storesData?.results) ? storesData.results : [])
          .filter(x => String(x?.status || 'active').toLowerCase() === 'active')
          .filter(x => String(x?.id || '').trim() && String(x?.network_node_id || '').trim());

        if (!stores.length) {
          const tagTxt = userTags.length ? ` Tags de cuenta: ${userTags.join(', ')}.` : '';
          throw new Error(`selling_address bloqueado en MLU y la cuenta no tiene ningun deposito stock_location activo para usar seller_warehouse.${tagTxt} Configuralo en Mercado Libre > Ventas > Preferencias de venta > Mis depositos.`);
        }
        if (stores.length > 1) {
          const list = stores.slice(0,6).map(x=>`${x.id}/${x.network_node_id}${x.description?' ('+x.description+')':''}`).join(', ');
          throw new Error(`selling_address bloqueado en MLU. La cuenta tiene ${stores.length} depositos activos (${list}). Para no mandar stock al deposito equivocado, hay que elegir el deposito destino en el vinculo.`);
        }

        const store = stores[0];
        const desiredQty = Math.max(0, Number(targetQty)||0);

        async function refreshStockVersion() {
          const gr = await fetch(stockUrl, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
          const gt = await gr.text();
          let gj = null; try { gj = gt ? JSON.parse(gt) : {}; } catch { gj = { raw: gt }; }
          if (!gr.ok) throw new Error(gj?.message || gj?.error || gt || `No se pudo refrescar stock de ${userProductId}`);
          return { version: gr.headers.get('x-version') || gr.headers.get('X-Version') || '', data: gj };
        }

        async function putWarehouse(ver) {
          const body = { locations:[{ store_id:String(store.id), network_node_id:String(store.network_node_id), quantity:desiredQty }] };
          const wr = await fetch(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock/type/seller_warehouse`, {
            method:'PUT',
            headers:{ 'Authorization':`Bearer ${token}`, 'Accept':'application/json', 'Content-Type':'application/json', 'x-version':String(ver||'') },
            body:JSON.stringify(body)
          });
          const wt = await wr.text();
          let wj = null; try { wj = wt ? JSON.parse(wt) : {}; } catch { wj = { raw:wt }; }
          return { wr, wt, wj, body };
        }

        let fresh = await refreshStockVersion();
        if (!fresh.version) throw new Error(`Mercado Libre no devolvio x-version para usar seller_warehouse en ${userProductId}.`);
        let wh = await putWarehouse(fresh.version);
        if (wh.wr.status === 409) {
          fresh = await refreshStockVersion();
          wh = await putWarehouse(fresh.version);
        }

        // Si el UP todavia no esta asociado al deposito, intentamos inicializar
        // la stock location existente del seller y luego repetimos el PUT.
        if (!wh.wr.ok) {
          const whMsg = String(wh.wj?.message || wh.wj?.error || wh.wt || '').toLowerCase();
          const canInit = whMsg.includes('stock-location') || whMsg.includes('stock location') || whMsg.includes('not found') || whMsg.includes('store is not configured');
          if (canInit) {
            const createBody = { store_id:String(store.id), network_node_id:String(store.network_node_id), quantity:desiredQty };
            const cr = await fetch(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock/type/seller_warehouse`, {
              method:'POST',
              headers:{ 'Authorization':`Bearer ${token}`, 'Accept':'application/json', 'Content-Type':'application/json' },
              body:JSON.stringify(createBody)
            });
            const ct = await cr.text();
            let cj = null; try { cj = ct ? JSON.parse(ct) : {}; } catch { cj = { raw:ct }; }
            if (cr.ok) {
              fresh = await refreshStockVersion();
              wh = await putWarehouse(fresh.version);
            } else {
              throw new Error(`selling_address bloqueado; seller_warehouse no estaba inicializado y Mercado Libre rechazo asociar el deposito ${store.id}: ${cj?.message || cj?.error || ct || cr.status}`);
            }
          }
        }

        if (!wh.wr.ok) {
          throw new Error(`selling_address bloqueado; seller_warehouse (${store.id}/${store.network_node_id}) tambien fue rechazado: ${wh.wj?.message || wh.wj?.error || wh.wt || wh.wr.status}`);
        }
        return {
          ok:true,
          mode:'user_product_seller_warehouse_fallback',
          user_product_id:userProductId,
          warehouse:{ store_id:String(store.id), network_node_id:String(store.network_node_id), description:store.description||'' },
          sent:wh.body,
          response:wh.wj,
          status:wh.wr.status
        };
      }

      throw new Error(`selling_address: ${msg}`);
    }
    return {
      ok:true,
      mode:'user_product_selling_address',
      user_product_id:userProductId,
      sent:{ quantity:Math.max(0, Number(targetQty)||0) },
      response:attempt.jj,
      status:attempt.rr.status
    };
  }
  if (locations.some(x => String(x?.type || '') === 'meli_facility')) {
    throw new Error(`El User Product ${userProductId} tiene stock Full administrado por Mercado Libre; ese stock no se puede incrementar desde la API.`);
  }
  throw new Error(`No se encontraron ubicaciones de stock editables para ${userProductId}.`);
}

async function smartUpdateLinkedPublication(cuenta, itemId, opts = {}) {
  const detail = await getMeliItemForSmartUpdate(cuenta, itemId);
  const variations = Array.isArray(detail?.variations) ? detail.variations : [];
  const result = { ok:true, item_id:itemId, detailMode: variations.length ? 'variations' : 'item', operations:[] };

  if (opts.price !== undefined && opts.price !== null && opts.price !== '') {
    const targetPrice = Number(opts.price);
    if (variations.length) {
      // Mercado Libre exige enviar todos los IDs al cambiar precio de una publicación con variaciones.
      const body = { variations: variations.map(v => ({ id: v.id, price: targetPrice })) };
      const r = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}`, { method:'PUT', body });
      result.operations.push({ field:'price', mode:'variations_all', sent:body, response:r });
    } else {
      const r = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}`, { method:'PUT', body:{ price: targetPrice } });
      result.operations.push({ field:'price', mode:'item', sent:{price:targetPrice}, response:r });
    }
  }

  if (opts.stock !== undefined && opts.stock !== null && opts.stock !== '') {
    const targetStock = Math.max(0, Number(opts.stock)||0);
    if (variations.length) {
      const wantedSku = String(opts.sku || '').trim().toLowerCase();
      let targetVariation = null;
      if (wantedSku) targetVariation = variations.find(v => getVariationSellerSku(v).toLowerCase() === wantedSku) || null;
      if (!targetVariation && variations.length === 1) targetVariation = variations[0];
      if (!targetVariation) {
        throw new Error(`La publicación ${itemId} tiene ${variations.length} variaciones. No puedo asignar el stock total ${targetStock} sin saber a qué variación corresponde. SKU buscado: ${opts.sku || 'sin SKU'}.`);
      }
      const body = { variations: [{ id: targetVariation.id, available_quantity: targetStock }] };
      const r = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}`, { method:'PUT', body });
      result.operations.push({ field:'stock', mode:'variation', variation_id:targetVariation.id, sent:body, response:r });
    } else {
      try {
        const r = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}`, { method:'PUT', body:{ available_quantity: targetStock } });
        result.operations.push({ field:'stock', mode:'item', sent:{available_quantity:targetStock}, response:r });
      } catch (e) {
        const msg = String(e?.message || e);
        if (detail?.user_product_id && /Cannot update item|available_quantity|stock|has_bids|not modifiable/i.test(msg)) {
          const up = await updateUserProductStockSmart(cuenta, detail.user_product_id, targetStock);
          result.operations.push({ field:'stock', mode:up.mode, response:up });
        } else {
          throw e;
        }
      }
    }
  }

  return result;
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


function variationSummary(v, index = 0) {
  const attrs = Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : (Array.isArray(v?.attributes) ? v.attributes : []);
  const label = attrs.map(a => `${a.name || a.id || 'Atributo'}: ${a.value_name || a.value_id || ''}`).filter(Boolean).join(' · ');
  return {
    id: String(v?.id || ''),
    sku: getVariationSellerSku(v),
    stock: Number(v?.available_quantity ?? 0) || 0,
    price: Number(v?.price ?? 0) || 0,
    label: label || `Variación ${index + 1}`,
    user_product_id: String(v?.user_product_id || ''),
    inventory_id: String(v?.inventory_id || ''),
    attributes: attrs.map(a => ({ id:a.id || '', name:a.name || a.id || '', value_id:a.value_id || '', value_name:a.value_name || a.value_id || '' }))
  };
}

async function getPublicationVariantsInfo(cuenta, itemId) {
  const detail = await getMeliItemForSmartUpdate(cuenta, itemId);
  let vars = [];

  // v3: para la pantalla de variantes no confiamos solo en detail.variations.
  // Mercado Libre puede devolver una version resumida segun attributes. Consultamos
  // el recurso especifico /variations y enriquecemos cada variante con su detalle real.
  try {
    const direct = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}/variations?include_attributes=all`);
    if (Array.isArray(direct) && direct.length) vars = direct;
  } catch (e) {
    vars = Array.isArray(detail?.variations) ? detail.variations : [];
  }

  if (vars.length) {
    const enriched = [];
    for (const v of vars) {
      let full = v;
      try {
        const vd = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}/variations/${encodeURIComponent(v.id)}?include_attributes=all`);
        if (vd && typeof vd === 'object') full = { ...v, ...vd };
      } catch (_) {}
      enriched.push(full);
    }
    vars = enriched;
  }

  return {
    cuenta: cuentaKey(cuenta),
    itemId: String(itemId || ''),
    title: String(detail?.title || ''),
    sku: String(detail?.seller_custom_field || ''),
    price: Number(detail?.price ?? 0) || 0,
    stock: Number(detail?.available_quantity ?? 0) || 0,
    hasVariations: vars.length > 0,
    variations: vars.length ? vars.map(variationSummary) : [{ id:'ROOT', sku:String(detail?.seller_custom_field || ''), stock:Number(detail?.available_quantity ?? 0)||0, price:Number(detail?.price ?? 0)||0, label:'Stock general (sin variantes)', user_product_id:String(detail?.user_product_id||''), inventory_id:String(detail?.inventory_id||''), attributes:[] }]
  };
}

function getLinkById(cache, linkId) {
  const links = normalizePublicationLinks(cache);
  if (linkId && links[linkId]) return links[linkId];
  return Object.values(links).find(l => String(l.id || '') === String(linkId || '')) || null;
}

function normalizedVariationLinks(link) {
  const rows = Array.isArray(link?.variationLinks) ? link.variationLinks : [];
  return rows.filter(x => x && x.masterVariationId && x.childVariationId).map(x => ({
    masterVariationId:String(x.masterVariationId), childVariationId:String(x.childVariationId),
    masterLabel:String(x.masterLabel||''), childLabel:String(x.childLabel||''),
    masterSku:String(x.masterSku||''), childSku:String(x.childSku||'')
  }));
}


async function sleepMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function readVariationStockConfirmed(cuenta, itemId, variationId) {
  if (String(variationId) === 'ROOT') {
    const item = await getMeliItemForSmartUpdate(cuenta, itemId);
    return Number(item?.available_quantity ?? 0);
  }
  try {
    const vd = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}/variations/${encodeURIComponent(variationId)}?include_attributes=all`);
    return Number(vd?.available_quantity ?? 0);
  } catch (_) {
    const item = await getMeliItemForSmartUpdate(cuenta, itemId);
    const v = (Array.isArray(item?.variations) ? item.variations : []).find(x => String(x?.id || '') === String(variationId));
    return Number(v?.available_quantity ?? 0);
  }
}

async function updateStockViaUserProductSellingCondition(cuenta, userProductId, targetQty, sourceItemId='') {
  const source = await getMeliItemForSmartUpdate(cuenta, sourceItemId);
  const sellerId = String(source?.seller_id || '').trim();
  if (!sellerId) throw new Error(`No pude obtener seller_id para buscar las condiciones de venta del User Product ${userProductId}.`);
  const search = await meliApi(cuenta, `/users/${encodeURIComponent(sellerId)}/items/search?user_product_id=${encodeURIComponent(userProductId)}&limit=50`);
  const ids = Array.isArray(search?.results) ? search.results.map(String).filter(Boolean) : [];
  if (!ids.length) throw new Error(`No encontré condiciones de venta asociadas al User Product ${userProductId}.`);
  const attempts=[];
  for (const id of ids) {
    try {
      await meliApi(cuenta, `/items/${encodeURIComponent(id)}`, { method:'PUT', body:{ available_quantity: Math.max(0,Number(targetQty)||0) } });
      let confirmed = null;
      for (let i=0;i<4;i++) {
        if (i) await sleepMs(700);
        const chk = await getMeliItemForSmartUpdate(cuenta, id);
        confirmed = Number(chk?.available_quantity ?? 0);
        if (confirmed === Math.max(0,Number(targetQty)||0)) {
          return { ok:true, mode:'user_product_selling_condition_item', user_product_id:userProductId, item_id:id, confirmed_quantity:confirmed, attempts };
        }
      }
      attempts.push(`${id}: Mercado Libre respondió OK pero confirmó stock ${confirmed}`);
    } catch(e) {
      attempts.push(`${id}: ${String(e?.message || e)}`);
    }
  }
  throw new Error(`No pude confirmar el stock ${targetQty} en ninguna condición de venta del User Product ${userProductId}. ${attempts.join(' | ')}`);
}

async function verifyChildVariationStock(cuenta, itemId, childVariationId, targetQty, userProductId='') {
  const wanted=Math.max(0,Number(targetQty)||0);
  for (let i=0;i<4;i++) {
    if (i) await sleepMs(700);
    try {
      const q=await readVariationStockConfirmed(cuenta,itemId,childVariationId);
      if (q===wanted) return { ok:true, confirmed_quantity:q, source:'item_variation' };
    } catch(_) {}
  }
  if (userProductId) {
    try {
      const token=await getMeliAccessToken(cuenta);
      const rr=await fetch(`https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
      const tt=await rr.text(); let jj={}; try{jj=tt?JSON.parse(tt):{}}catch{jj={raw:tt}}
      if(rr.ok){
        const locs=Array.isArray(jj?.locations)?jj.locations:[];
        const total=locs.reduce((a,x)=>a+Math.max(0,Number(x?.quantity||0)),0);
        if(total===wanted) return {ok:true,confirmed_quantity:total,source:'user_product_stock'};
      }
    } catch(_) {}
  }
  return { ok:false, confirmed_quantity:null };
}

async function updateChildVariationStock(cuenta, itemId, childVariation, qty) {
  const targetQty = Math.max(0, Number(qty)||0);
  const childVariationId = String(childVariation?.id || childVariation || '');
  const userProductId = String(childVariation?.user_product_id || '').trim();
  const errors = [];

  // V6: primero intentamos User Product cuando realmente hay un flujo de stock editable.
  // Si MLU devuelve selling_address bloqueado o no hay multi-origen activo, NO abortamos:
  // Mercado Libre indica que en ese caso el stock se actualiza por PUT /items.
  if (userProductId) {
    try {
      const up = await updateUserProductStockSmart(cuenta, userProductId, targetQty);
      const check = await verifyChildVariationStock(cuenta, itemId, childVariationId, targetQty, userProductId);
      if (check.ok) return { ...up, ...check, variation_id: childVariationId };
      errors.push('User Product respondió OK pero el stock no quedó confirmado en Mercado Libre.');
    } catch (e) {
      errors.push('User Product: ' + String(e?.message || e));
    }
  }

  // IMPORTANTE: al modificar una variacion Mercado Libre exige conservar los IDs de
  // TODAS las variaciones existentes. Si enviamos solo la variante destino, las omitidas
  // pueden interpretarse como eliminadas o provocar Validation error.
  try {
    let body;
    let mode;
    if (childVariationId === 'ROOT') {
      body = { available_quantity: targetQty };
      mode = 'item_available_quantity';
    } else {
      const freshItem = await getMeliItemForSmartUpdate(cuenta, itemId);
      const freshVariations = Array.isArray(freshItem?.variations) ? freshItem.variations : [];
      if (!freshVariations.length) {
        throw new Error(`La publicacion ${itemId} ya no devuelve variaciones al refrescarla.`);
      }
      const targetExists = freshVariations.some(v => String(v?.id || '') === childVariationId);
      if (!targetExists) {
        throw new Error(`La variante destino ${childVariationId} ya no existe en ${itemId}.`);
      }
      body = {
        variations: freshVariations.map(v => {
          const id = v.id;
          if (String(id) === childVariationId) return { id, available_quantity: targetQty };
          return { id };
        })
      };
      mode = 'variation_all_ids';
    }

    const r = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}`, { method:'PUT', body });
    const check = await verifyChildVariationStock(cuenta, itemId, childVariationId, targetQty, userProductId);
    if (check.ok) return { ok:true, mode, variation_id:childVariationId, sent:body, response:r, ...check };
    errors.push(`Item/variacion: Mercado Libre respondió OK pero no confirmó el stock ${targetQty}.`);
    if (userProductId) {
      try {
        const sc = await updateStockViaUserProductSellingCondition(cuenta, userProductId, targetQty, itemId);
        const check2 = await verifyChildVariationStock(cuenta, itemId, childVariationId, targetQty, userProductId);
        if (check2.ok || sc.confirmed_quantity === targetQty) return { ...sc, ...check2, variation_id:childVariationId };
      } catch(e2) { errors.push('Condición de venta User Product: '+String(e2?.message || e2)); }
    }
  } catch (e) {
    errors.push('Item/variacion: ' + String(e?.message || e));
  }

  // Ultimo intento: algunas publicaciones viejas no devuelven user_product_id en el
  // listado de variaciones, pero si en el detalle individual.
  if (childVariationId !== 'ROOT' && !userProductId) {
    try {
      const vd = await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}/variations/${encodeURIComponent(childVariationId)}?include_attributes=all`);
      const refreshedUp = String(vd?.user_product_id || '').trim();
      if (refreshedUp) {
        const up = await updateUserProductStockSmart(cuenta, refreshedUp, targetQty);
        const check = await verifyChildVariationStock(cuenta, itemId, childVariationId, targetQty, refreshedUp);
        if (check.ok) return { ...up, ...check, variation_id:childVariationId };
        try {
          const sc = await updateStockViaUserProductSellingCondition(cuenta, refreshedUp, targetQty, itemId);
          return { ...sc, variation_id:childVariationId };
        } catch(e2) { throw new Error(`User Product respondió sin confirmar stock. ${String(e2?.message || e2)}`); }
      }
    } catch (e) {
      errors.push('Variante/User Product: ' + String(e?.message || e));
    }
  }

  throw new Error(errors.join(' | ') || `No se pudo actualizar stock de la variante ${childVariationId}.`);
}

async function syncVariationStocksFromLink(link, masterInfo, childInfo) {
  const maps = normalizedVariationLinks(link);
  if (!maps.length) return { ok:false, skipped:true, message:'Hay variantes pero todavía no están vinculadas. Abrí “Ver variantes” y relacioná las que correspondan.', operations:[] };
  const operations=[];
  for (const map of maps) {
    const mv = masterInfo.variations.find(v => String(v.id) === String(map.masterVariationId));
    const cv = childInfo.variations.find(v => String(v.id) === String(map.childVariationId));
    if (!mv || !cv) {
      operations.push({ ok:false, masterVariationId:map.masterVariationId, childVariationId:map.childVariationId, message:'No se encontró una de las variantes vinculadas.' });
      continue;
    }
    if (Number(mv.stock) === Number(cv.stock)) {
      operations.push({ ok:true, skipped:true, masterVariationId:mv.id, childVariationId:cv.id, stock:mv.stock, message:'Stock ya sincronizado.' });
      continue;
    }
    try {
      const response = await updateChildVariationStock(childInfo.cuenta, childInfo.itemId, cv, mv.stock);
      operations.push({ ok:true, masterVariationId:mv.id, childVariationId:cv.id, fromStock:cv.stock, stock:mv.stock, response });
    } catch (e) {
      operations.push({ ok:false, masterVariationId:mv.id, childVariationId:cv.id, message:String(e?.message || e) });
    }
  }
  const errors=operations.filter(x=>x.ok===false);
  const detail = errors.map(x => `${x.childVariationId || '?'}: ${x.message || 'error'}`).join(' || ');
  const confirmed = operations.filter(x=>x.ok && !x.skipped).map(x=>`${x.childVariationId}: ${x.fromStock} → ${x.stock}`).join(', ');
  return { ok:errors.length===0, partial:errors.length>0, operations, message:errors.length ? `${errors.length} variante(s) no se pudieron sincronizar.${detail ? ' ' + detail : ''}` : `Stocks por variante sincronizados y confirmados${confirmed ? ': '+confirmed : '.'}` };
}

async function syncLinkedValuesFromTlcMaster(cache, username = 'sistema', options = {}) {
  const links = Object.values(normalizePublicationLinks(cache)).filter(link => link && link.active !== false);
  const results = [];
  let okCount = 0, errorCount = 0, skippedCount = 0;

  for (const link of links) {
    const masterId = String(link.masterId || '').trim();
    const childCuenta = cuentaKey(link.childCuenta);
    const childId = String(link.childId || '').trim();
    const masterItem = findPublicationInCache(cache, 'tlc', masterId);
    const childItem = findPublicationInCache(cache, childCuenta, childId);
    if (!masterItem || !childItem) {
      skippedCount++;
      results.push({ ok:false, skipped:true, masterId, childCuenta, childId, message:'No se encontró la maestra TLC o la vinculada en el cache actual.' });
      continue;
    }

    const priceMaster = Number(masterItem.price ?? 0);
    const priceChild = Number(childItem.price ?? 0);
    const needsPrice = Number.isFinite(priceMaster) && priceMaster > 0 && priceMaster !== priceChild;
    let priceResult = { ok:true, skipped:!needsPrice };
    let stockResult = { ok:true, skipped:true };

    try {
      // Precio: se sincroniza aunque el stock por variantes todavía no esté configurado.
      if (needsPrice) {
        try {
          const p = await smartUpdateLinkedPublication(childCuenta, childId, { price:priceMaster });
          priceResult = { ok:true, operations:p.operations || [] };
          childItem.price = priceMaster;
        } catch (e) {
          priceResult = { ok:false, message:String(e?.message || e) };
        }
      }

      const masterInfo = await getPublicationVariantsInfo('tlc', masterId);
      const childInfo = await getPublicationVariantsInfo(childCuenta, childId);
      const hasAnyVariations = masterInfo.hasVariations || childInfo.hasVariations;

      if (hasAnyVariations) {
        stockResult = await syncVariationStocksFromLink(link, masterInfo, childInfo);
      } else {
        const stockMaster = Number(masterInfo.stock ?? masterItem.stock ?? 0);
        const stockChild = Number(childInfo.stock ?? childItem.stock ?? 0);
        if (stockMaster === stockChild) stockResult = { ok:true, skipped:true, message:'Stock ya sincronizado.' };
        else {
          try {
            const s = await smartUpdateLinkedPublication(childCuenta, childId, { stock:stockMaster, sku:childItem.sku || link.sku || masterItem.sku || '' });
            stockResult = { ok:true, operations:s.operations || [] };
            childItem.stock = stockMaster; childItem.available_quantity = stockMaster;
          } catch (e) { stockResult = { ok:false, message:String(e?.message || e) }; }
        }
      }

      const anyOk = (needsPrice && priceResult.ok) || stockResult.ok;
      const anyError = priceResult.ok===false || stockResult.ok===false;
      if (anyError && !anyOk) errorCount++; else if (anyError) okCount++; else if (!needsPrice && stockResult.skipped) skippedCount++; else okCount++;
      childItem.lastLinkedSyncFromTlc = new Date().toISOString();
      results.push({
        ok: !anyError,
        partial: anyError && anyOk,
        masterId, childCuenta, childId,
        price: priceMaster,
        priceResult, stockResult,
        message: anyError ? [priceResult.ok===false?'Precio: '+priceResult.message:'', stockResult.ok===false?'Stock: '+stockResult.message:''].filter(Boolean).join(' | ') : 'Sincronización completada.'
      });
    } catch (e) {
      errorCount++;
      results.push({ ok:false, masterId, childCuenta, childId, message:String(e?.message || e) });
    }
  }

  cache.lastAutoLinkedSyncAt = new Date().toISOString();
  if (!options.silent || okCount || errorCount) cache.movements.push({ id:crypto.randomBytes(8).toString('hex'), at:new Date().toISOString(), type:options.source||'sync_linked_values', message:`Grupos sincronizados desde maestra TLC: ${okCount} ok, ${skippedCount} sin cambios, ${errorCount} errores.`, user:username });
  savePublicationsCache(cache);
  return { ok:errorCount===0, okCount, skippedCount, errorCount, results, message:`Grupos sincronizados desde maestra TLC: ${okCount} ok, ${skippedCount} sin cambios, ${errorCount} errores.` };
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
        linkMasterId: manualLink ? String(manualLink.masterId || manualLink.tlcId || '') : '',
        linkChildId: manualLink ? String(manualLink.childId || manualLink.topshopId || '') : '',
        linkChildCuenta: manualLink ? cuentaKey(manualLink.childCuenta || (manualLink.topshopId ? 'topshop' : 'tlc')) : '',
        variationLinksCount: manualLink ? normalizedVariationLinks(manualLink).length : 0,
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
    'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS',
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
//  ASISTENTE IA GENERAL — Centro de Control
//  Primera version: analiza y recomienda. No modifica precios, stock ni estados.
// ═══════════════════════════════════════════════
const ASSISTANT_DAILY_FILE = path.join(DATA_DIR, 'assistant-daily-control.json');

function assistantNum(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function assistantText(v) { return String(v ?? '').trim(); }
function assistantLower(v) { return assistantText(v).toLowerCase(); }

function assistantPick(item, names, fallback='') {
  for (const n of names) {
    if (item && item[n] !== undefined && item[n] !== null && assistantText(item[n]) !== '') return item[n];
  }
  return fallback;
}

function assistantSku(item) {
  return assistantText(assistantPick(item, ['sku','seller_sku','sellerSku','codigoTLC','codigo_tlc','custom_sku','reference']));
}

function assistantStock(item) {
  return assistantNum(assistantPick(item, ['available_quantity','stock','quantity','availableQuantity'], 0));
}

function assistantPrice(item) {
  return assistantNum(assistantPick(item, ['price','pvp','sale_price','salePrice'], 0));
}

function assistantStatus(item) {
  return assistantLower(assistantPick(item, ['status','estado'], ''));
}

function assistantIsPaused(item) {
  const st = assistantStatus(item);
  return st === 'paused' || st === 'pausada' || st === 'pause' || st.includes('paus');
}

function assistantIsActive(item) {
  const st = assistantStatus(item);
  return st === 'active' || st === 'activa' || st.includes('activ');
}

function assistantIsCatalog(item) {
  return Boolean(item && (item.catalog_listing || item.catalogListing || item.catalog_product_id || item.catalogProductId));
}

function assistantItemTitle(item) {
  return assistantText(assistantPick(item, ['title','titulo','name','articulo'], 'Sin titulo'));
}

function assistantItemId(item) {
  return assistantText(assistantPick(item, ['id','mlu','item_id','itemId'], ''));
}

function assistantFlattenPublications(cache) {
  const out = [];
  for (const cuenta of ['tlc','topshop']) {
    for (const raw of (cache[cuenta] || [])) {
      const item = { ...raw };
      const sku = assistantSku(item);
      const id = assistantItemId(item);
      const supplierKey = String(sku || id || '').trim().toUpperCase();
      const supplierLink = supplierKey ? (cache.supplierLinks || {})[supplierKey] : null;
      out.push({
        cuenta,
        id,
        sku,
        title: assistantItemTitle(item),
        status: assistantStatus(item),
        stock: assistantStock(item),
        price: assistantPrice(item),
        catalog: assistantIsCatalog(item),
        updatedAt: assistantText(assistantPick(item, ['last_updated','date_modified','updated_at','updatedAt'], '')),
        supplierUrl: supplierLink ? supplierLink.url || '' : '',
        raw: item,
      });
    }
  }
  return out;
}

function assistantFindPriceProduct(preciosDb, pub) {
  const sku = assistantLower(pub.sku);
  const title = assistantLower(pub.title);
  if (!preciosDb || !Array.isArray(preciosDb.products)) return null;
  if (sku) {
    const exact = preciosDb.products.find(p => assistantLower(p.codigoTLC) === sku || assistantLower(p.codigoProveedor) === sku || assistantLower(p.codigoFabrica) === sku);
    if (exact) return exact;
  }
  if (title) {
    return preciosDb.products.find(p => {
      const art = assistantLower(p.articulo);
      return art && (title.includes(art.slice(0, Math.min(18, art.length))) || art.includes(title.slice(0, Math.min(18, title.length))));
    }) || null;
  }
  return null;
}

function assistantProductMetrics(product, pub) {
  if (!product) return { linked: false, margin: null, gain: null, provider: '', cost: 0 };
  const pvp = pub.price || assistantNum(product.pvp);
  const metrics = preciosMetrics(product.precioProveedor, pvp, product.comisionMlPct, product.envioCostoFijo, product.acos, product.descuentoPromocion);
  return { linked: true, margin: metrics.margenFinal, gain: metrics.gananciaFinal, provider: assistantText(product.proveedor), cost: assistantNum(product.precioProveedor) };
}

function assistantLoadDailyControl() {
  ensureDataDir();
  if (!fs.existsSync(ASSISTANT_DAILY_FILE)) return { snapshots: [], updatedAt: null };
  try {
    const data = JSON.parse(fs.readFileSync(ASSISTANT_DAILY_FILE, 'utf8'));
    return { snapshots: Array.isArray(data.snapshots) ? data.snapshots : [], updatedAt: data.updatedAt || null };
  } catch { return { snapshots: [], updatedAt: null }; }
}

function assistantSaveDailyControl(snapshot) {
  ensureDataDir();
  const data = assistantLoadDailyControl();
  data.snapshots.push(snapshot);
  data.snapshots = data.snapshots.slice(-30);
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(ASSISTANT_DAILY_FILE, JSON.stringify(data, null, 2));
  return data;
}

function assistantBuildSnapshot() {
  const cache = loadPublicationsCache();
  const prices = loadPreciosDb();
  const state = loadInboxState();
  const pubs = assistantFlattenPublications(cache);
  const enriched = pubs.map(pub => {
    const product = assistantFindPriceProduct(prices, pub);
    const metrics = assistantProductMetrics(product, pub);
    return { ...pub, ...metrics };
  });
  const paused = enriched.filter(assistantIsPaused);
  const active = enriched.filter(assistantIsActive);
  const noStock = enriched.filter(p => p.stock <= 0);
  const lowMargin = enriched.filter(p => p.linked && p.margin !== null && p.margin < 20);
  const catalog = enriched.filter(p => p.catalog);
  const catalogToReview = catalog.filter(p => p.stock > 0 && assistantIsActive(p));
  const providerWeb = enriched.filter(p => p.supplierUrl);
  return {
    at: new Date().toISOString(),
    counts: {
      publications: enriched.length,
      active: active.length,
      paused: paused.length,
      noStock: noStock.length,
      lowMargin: lowMargin.length,
      catalog: catalog.length,
      catalogToReview: catalogToReview.length,
      providerWeb: providerWeb.length,
      inboxMessages: Object.keys(state.messages || {}).length,
      inboxQuestions: Object.keys(state.questions || {}).length,
      inboxClaims: Object.keys(state.claims || {}).length,
    },
    priorities: [
      { level: 'red', title: 'Catalogo para revisar', count: catalogToReview.length, detail: 'Publicaciones de catalogo activas con stock. En la proxima etapa se consulta price_to_win de MeLi.' },
      { level: 'orange', title: 'Pausadas', count: paused.length, detail: 'Publicaciones pausadas detectadas en cache.' },
      { level: 'yellow', title: 'Margen menor al 20%', count: lowMargin.length, detail: 'Publicaciones vinculadas a lista de precios con margen bajo.' },
      { level: 'blue', title: 'Proveedores con web', count: providerWeb.length, detail: 'Publicaciones con URL de proveedor cargada para control externo.' },
      { level: 'green', title: 'Sin stock', count: noStock.length, detail: 'Publicaciones con stock 0 o menor.' },
    ],
    lists: {
      paused: paused.slice(0, 120),
      pausedWithStock: paused.filter(p => p.stock > 0).slice(0, 80),
      pausedNoStock: paused.filter(p => p.stock <= 0).slice(0, 80),
      lowMargin: lowMargin.sort((a,b) => (a.margin || 0) - (b.margin || 0)).slice(0, 80),
      catalogToReview: catalogToReview.slice(0, 80),
      providerWeb: providerWeb.slice(0, 80),
    },
    safety: 'Solo lectura. No cambia precios, stock ni estados sin una etapa de confirmacion futura.',
  };
}

function assistantCompareNewPaused(currentSnapshot) {
  const data = assistantLoadDailyControl();
  const previous = data.snapshots.length ? data.snapshots[data.snapshots.length - 1] : null;
  if (!previous) return [];
  const prevIds = new Set((previous.lists?.paused || []).map(p => `${p.cuenta}:${p.id}`));
  return (currentSnapshot.lists?.paused || []).filter(p => !prevIds.has(`${p.cuenta}:${p.id}`));
}

function assistantCompactItem(p) {
  const margin = p.margin === null || p.margin === undefined ? 'sin costo vinculado' : `margen ${Number(p.margin).toFixed(1)}%`;
  return `• ${p.title} | ${p.cuenta} | ${p.id || p.sku || 'sin id'} | stock ${p.stock} | precio ${p.price || '-'} | ${margin}`;
}


function assistantNormalizeSearch(v) {
  return assistantLower(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function assistantAllEnrichedPublications() {
  const cache = loadPublicationsCache();
  const prices = loadPreciosDb();
  return assistantFlattenPublications(cache).map(pub => {
    const product = assistantFindPriceProduct(prices, pub);
    const metrics = assistantProductMetrics(product, pub);
    return { ...pub, ...metrics };
  });
}

function assistantPublicationForPriceProduct(product, pubs) {
  const keys = [product.codigoTLC, product.codigoProveedor, product.codigoFabrica]
    .map(assistantNormalizeSearch)
    .filter(Boolean);
  if (!keys.length) return null;
  return pubs.find(pub => {
    const pubKeys = [pub.sku, pub.id].map(assistantNormalizeSearch).filter(Boolean);
    return keys.some(k => pubKeys.includes(k));
  }) || null;
}

function assistantPriceItem(product, pub=null) {
  return {
    id: assistantText(product.id || product.codigoTLC || product.codigoProveedor),
    title: assistantText(product.articulo || 'Sin titulo'),
    sku: assistantText(product.codigoTLC || product.codigoProveedor || product.codigoFabrica),
    cuenta: pub ? assistantText(pub.cuenta) : '',
    stock: pub ? assistantNum(pub.stock) : null,
    price: assistantNum(product.pvp),
    margin: assistantNum(product.margenFinal !== undefined ? product.margenFinal : product.margenReal),
    gain: assistantNum(product.gananciaFinal !== undefined ? product.gananciaFinal : product.gananciaReal),
    provider: assistantText(product.proveedor),
    catalog: pub ? !!pub.catalog : null,
    updatedAt: pub ? assistantText(pub.updatedAt) : '',
    currency: assistantText(product.moneda || ''),
    cost: assistantNum(product.precioProveedor),
    source: 'precios',
  };
}

function assistantExtractArticleSearch(message) {
  const raw = assistantText(message);
  const text = assistantNormalizeSearch(raw);
  const m = text.match(/(?:articulos?|productos?)\s+(?:del\s+proveedor\s+|de\s+)([^,.;?]+?)(?=\s+(?:con|que|orden|y\s+orden|$)|$)/i);
  if (m && m[1]) return { kind: 'provider', term: m[1].trim() };
  const pm = text.match(/(?:proveedor)\s+([^,.;?]+?)(?=\s+(?:con|que|orden|$)|$)/i);
  if (pm && pm[1]) return { kind: 'provider', term: pm[1].trim() };
  if (/^[a-z0-9 ñ-]{2,50}$/i.test(text) && !/\b(margen|stock|pausad|catalog|activa|resumen|general|orden)\b/i.test(text)) {
    return { kind: 'text', term: text };
  }
  return null;
}

function assistantSearchPriceList(message) {
  const parsed = assistantExtractArticleSearch(message);
  if (!parsed) return null;

  const pricesDb = loadPreciosDb();
  const products = Array.isArray(pricesDb.products) ? pricesDb.products : [];
  const pubs = assistantAllEnrichedPublications();
  const term = assistantNormalizeSearch(parsed.term);

  let matches = [];
  if (parsed.kind === 'provider') {
    matches = products.filter(p => assistantNormalizeSearch(p.proveedor).includes(term));
  } else {
    matches = products.filter(p => {
      const hay = assistantNormalizeSearch([p.articulo, p.proveedor, p.codigoTLC, p.codigoProveedor, p.codigoFabrica].join(' '));
      return hay.includes(term);
    });
  }

  // Si el usuario escribió un proveedor en plural/variación y no hubo match, probar sin s final.
  if (!matches.length && term.endsWith('s')) {
    const singular = term.slice(0,-1);
    matches = products.filter(p => assistantNormalizeSearch([p.articulo, p.proveedor].join(' ')).includes(singular));
  }

  const items = matches.map(product => assistantPriceItem(product, assistantPublicationForPriceProduct(product, pubs)));
  return {
    title: parsed.kind === 'provider' ? `Artículos de ${parsed.term}` : `Resultados para ${parsed.term}`,
    intro: items.length ? `Encontré ${items.length} artículo(s) en Lista de Precios.` : `No encontré artículos que coincidan con "${parsed.term}".`,
    items,
  };
}

function assistantAnswer(message) {
  const text = assistantLower(message);

  const priceSearch = assistantSearchPriceList(message);
  if (priceSearch) {
    return {
      ok: true,
      title: priceSearch.title,
      answer: priceSearch.intro,
      items: priceSearch.items,
      count: priceSearch.items.length,
      source: 'precios',
    };
  }

  const snap = assistantBuildSnapshot();
  let title = 'Resumen general';
  let items = [];
  let intro = '';
  if (text.includes('pausad') && (text.includes('ayer') || text.includes('nueva'))) {
    title = 'Pausadas nuevas desde el ultimo control';
    items = assistantCompareNewPaused(snap);
    intro = items.length ? `Encontré ${items.length} pausada(s) nuevas desde el ultimo control guardado.` : 'No hay control previo o no encontré pausadas nuevas desde el ultimo control.';
  } else if (text.includes('pausad') && text.includes('stock')) {
    title = 'Pausadas con stock';
    items = snap.lists.pausedWithStock;
    intro = `Encontré ${items.length} pausada(s) con stock mayor a 0. Conviene revisar si se pueden reactivar.`;
  } else if (text.includes('pausad')) {
    title = 'Publicaciones pausadas';
    items = snap.lists.paused;
    intro = `Hay ${snap.counts.paused} publicaciones pausadas. Te muestro las primeras ${items.length}.`;
  } else if (text.includes('catalog')) {
    title = 'Catalogo para revisar';
    items = snap.lists.catalogToReview;
    intro = `Hay ${snap.counts.catalogToReview} publicaciones de catalogo activas con stock. En la proxima etapa se conecta price_to_win para saber cuales estamos perdiendo.`;
  } else if (text.includes('margen') || text.includes('rentabilidad')) {
    title = 'Margen bajo';
    items = snap.lists.lowMargin;
    intro = `Encontré ${items.length} publicaciones vinculadas con margen menor al 20%.`;
  } else if (text.includes('proveedor') || text.includes('web')) {
    title = 'Proveedores con web';
    items = snap.lists.providerWeb;
    intro = `Hay ${snap.counts.providerWeb} publicaciones con web de proveedor cargada. Falta configurar robots por proveedor para leer precio/stock externos.`;
  } else {
    intro = `Estado general: ${snap.counts.publications} publicaciones, ${snap.counts.active} activas, ${snap.counts.paused} pausadas, ${snap.counts.noStock} sin stock, ${snap.counts.lowMargin} con margen menor al 20%.`;
    items = [];
  }
  return {
    ok: true,
    title,
    answer: intro + (items.length ? '\n\n' + items.slice(0, 20).map(assistantCompactItem).join('\n') : ''),
    snapshot: snap,
    items,
  };
}


// ═══════════════════════════════════════════════
//  API AGENTE CHATGPT — V1 SOLO LECTURA
//  Protegida con AGENT_API_KEY. Nunca devuelve tokens de Mercado Libre.
// ═══════════════════════════════════════════════
function agentAuthorized(req) {
  const expected = String(process.env.AGENT_API_KEY || '').trim();
  if (!expected) return false;
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  const headerKey = String(req.headers['x-api-key'] || '').trim();
  const supplied = bearer || headerKey;
  if (!supplied) return false;
  try {
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function agentAccount(value) {
  const key = normalizeCuentaKey(value || 'tlc');
  if (!['tlc','topshop'].includes(key)) throw new Error('Cuenta invalida. Usa tlc o topshop.');
  return key;
}

async function handleAgentApi(req, res, u, pathName) {
  if (!agentAuthorized(req)) {
    jsonResp(res, 401, { ok:false, error:'No autorizado' });
    return;
  }
  if (req.method !== 'GET') {
    jsonResp(res, 405, { ok:false, error:'V1 del agente es solo lectura.' });
    return;
  }
  try {
    if (pathName === '/api/agent/health') {
      jsonResp(res, 200, { ok:true, service:'TELOCONSIGO Mercado Libre Agent API', version:'1.0-readonly', accounts:['tlc','topshop'] });
      return;
    }

    const cuenta = agentAccount(u.searchParams.get('cuenta') || 'tlc');
    const limit = Math.max(1, Math.min(Number(u.searchParams.get('limit') || 50), 100));
    const offset = Math.max(0, Number(u.searchParams.get('offset') || 0));

    if (pathName === '/api/agent/account') {
      const me = await meliApi(cuenta, '/users/me');
      jsonResp(res, 200, { ok:true, cuenta, seller:{ id:me?.id, nickname:me?.nickname, status:me?.status, site_id:me?.site_id } });
      return;
    }

    if (pathName === '/api/agent/questions') {
      const sellerId = await fetchMeliSellerId(cuenta);
      const status = String(u.searchParams.get('status') || 'UNANSWERED');
      const qs = new URLSearchParams({ seller_id:String(sellerId), status, limit:String(limit), offset:String(offset), 'sort.field':'date_created', 'sort.order':'DESC' });
      const data = await meliApi(cuenta, `/questions/search?${qs.toString()}`);
      jsonResp(res, 200, { ok:true, cuenta, ...data });
      return;
    }

    if (pathName === '/api/agent/claims') {
      const status = String(u.searchParams.get('status') || 'opened');
      const qs = new URLSearchParams({ stage:'claim', status, limit:String(limit), offset:String(offset), sort:'date_created,desc' });
      const data = await meliApi(cuenta, `/post-purchase/v1/claims/search?${qs.toString()}`);
      jsonResp(res, 200, { ok:true, cuenta, ...data });
      return;
    }

    if (pathName === '/api/agent/order') {
      const id = String(u.searchParams.get('id') || '').trim();
      if (!id) { jsonResp(res,400,{ok:false,error:'Falta id de venta.'}); return; }
      const data = await meliApi(cuenta, `/orders/${encodeURIComponent(id)}`);
      jsonResp(res, 200, { ok:true, cuenta, order:data });
      return;
    }

    if (pathName === '/api/agent/item') {
      const id = String(u.searchParams.get('id') || '').trim();
      if (!id) { jsonResp(res,400,{ok:false,error:'Falta id de publicacion.'}); return; }
      const data = await getMeliItemForSmartUpdate(cuenta, id);
      jsonResp(res, 200, { ok:true, cuenta, item:data });
      return;
    }

    if (pathName === '/api/agent/publications') {
      const q = String(u.searchParams.get('q') || '').trim().toLowerCase();
      const refresh = u.searchParams.get('refresh') === '1';
      const cache = loadPublicationsCache();
      if (refresh || !Array.isArray(cache[cuenta]) || !cache[cuenta].length) {
        cache[cuenta] = await fetchAllPublicationsDirect(cuenta, {});
        cache.updatedAt = new Date().toISOString();
        savePublicationsCache(cache);
      }
      let items = cache[cuenta] || [];
      if (q) items = items.filter(x => JSON.stringify([x.id,x.mlu,x.title,x.sku,x.seller_custom_field,x.status]).toLowerCase().includes(q));
      jsonResp(res, 200, { ok:true, cuenta, total:items.length, updatedAt:cache.updatedAt, items:items.slice(offset, offset+limit) });
      return;
    }

    jsonResp(res, 404, { ok:false, error:'Ruta del agente no encontrada.' });
  } catch (e) {
    console.error('Error API agente:', e.message);
    jsonResp(res, 500, { ok:false, error:e.message });
  }
}

// ═══════════════════════════════════════════════
//  MCP PARA CHATGPT — V3 LECTURA + ACCIONES CONTROLADAS
//  MCP Streamable HTTP sobre /mcp, protegido con AGENT_API_KEY Bearer.
//  Lectura amplia + escrituras que exigen confirm:true para evitar cambios accidentales.
// ═══════════════════════════════════════════════
const MCP_SERVER_NAME = 'teloconsigo-mercadolibre';
const MCP_SERVER_VERSION = '5.0.4';
const MCP_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];

const MCP_TOOLS = [
  { name:'meli_account', title:'Cuenta de Mercado Libre', description:'Obtiene datos basicos de la cuenta vendedora de Mercado Libre de TELOCONSIGO o TOP SHOP.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_questions', title:'Preguntas de Mercado Libre', description:'Lista preguntas de Mercado Libre. Por defecto devuelve preguntas sin responder.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},status:{type:'string',default:'UNANSWERED'},limit:{type:'integer',minimum:1,maximum:100,default:50},offset:{type:'integer',minimum:0,default:0}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_claims', title:'Reclamos de Mercado Libre', description:'Lista reclamos de posventa de Mercado Libre. Por defecto devuelve reclamos abiertos.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},status:{type:'string',default:'opened'},limit:{type:'integer',minimum:1,maximum:100,default:50},offset:{type:'integer',minimum:0,default:0}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_order', title:'Venta de Mercado Libre', description:'Consulta una venta de Mercado Libre por ID.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},id:{type:'string'}},required:['cuenta','id'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_item', title:'Publicacion de Mercado Libre', description:'Consulta una publicacion de Mercado Libre por ID MLU.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},id:{type:'string'}},required:['cuenta','id'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_publications', title:'Publicaciones de Mercado Libre', description:'Busca publicaciones de Mercado Libre por titulo, ID, SKU o texto. Usa q vacio para listar.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},q:{type:'string',default:''},limit:{type:'integer',minimum:1,maximum:100,default:50},offset:{type:'integer',minimum:0,default:0},refresh:{type:'boolean',default:false}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_question_context', title:'Contexto de una pregunta', description:'Obtiene la pregunta y TODO el contexto de la publicacion para preparar una respuesta: titulo, atributos, descripcion, fotos y preguntas/respuestas anteriores. Las fotos se devuelven tambien como contenido de imagen para que ChatGPT pueda analizarlas. IMPORTANTE: primero interpretar la intencion real de la pregunta y usar las fotos como evidencia valida cuando el dato sea claramente observable (por ejemplo geometria/forma del cuadro, color visible, presencia de componentes, cantidad visible o accesorios visibles), aunque no exista un atributo textual equivalente. No exigir que la frase del cliente aparezca literalmente en atributos. No usar fotos para inferir datos no verificables visualmente como medidas exactas, potencia, autonomia, capacidad de carga, material interno o compatibilidad tecnica. No inventar datos que no esten respaldados por este contexto. Para TLC la marca/firma es siempre TELOCONSIGO (una sola palabra); para TOP SHOP es TOP SHOP.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},question_id:{type:['string','number']},history_limit:{type:'integer',minimum:1,maximum:100,default:50}},required:['cuenta','question_id'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_messages_unread', title:'Mensajes de ventas pendientes', description:'Lista conversaciones posventa con mensajes pendientes de leer. No marca mensajes como leidos.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_message_thread', title:'Hilo de mensaje posventa', description:'Obtiene la conversacion completa de un pack sin marcarla como leida, junto con venta y publicaciones relacionadas cuando estan disponibles.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},pack_id:{type:['string','number']}},required:['cuenta','pack_id'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_send_message', title:'Responder mensaje posventa', description:'ENVIA un mensaje posventa al comprador. Solo ejecuta si confirm=true despues de mostrar el texto exacto al usuario.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},pack_id:{type:['string','number']},buyer_id:{type:['string','number']},text:{type:'string',minLength:1,maxLength:350},confirm:{type:'boolean'}},required:['cuenta','pack_id','buyer_id','text','confirm'],additionalProperties:false}, annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true} },
  { name:'meli_claim_context', title:'Contexto completo de reclamo', description:'Obtiene reclamo, mensajes, venta, publicacion y adjuntos detectados. Las imagenes adjuntas del reclamo se intentan devolver como contenido visual para analizarlas.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},claim_id:{type:['string','number']}},required:['cuenta','claim_id'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_send_claim_message', title:'Responder reclamo', description:'ENVIA un mensaje dentro de un reclamo. Solo ejecuta si confirm=true. No realiza reembolsos ni abre disputas.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},claim_id:{type:['string','number']},text:{type:'string',minLength:1},receiver_role:{type:'string',enum:['complainant','mediator','respondent'],default:'complainant'},confirm:{type:'boolean'}},required:['cuenta','claim_id','text','confirm'],additionalProperties:false}, annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true} },
  { name:'meli_support_summary', title:'Resumen de soporte Mercado Libre', description:'Revisa en una sola llamada preguntas sin responder, mensajes posventa sin leer y reclamos abiertos de TELOCONSIGO y TOP SHOP. Solo lectura.', inputSchema:{type:'object',properties:{},additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_recent_orders', title:'Ventas recientes', description:'Lista ventas recientes de una cuenta de Mercado Libre.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},limit:{type:'integer',minimum:1,maximum:50,default:20},offset:{type:'integer',minimum:0,default:0}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_claim_detail', title:'Detalle de reclamo', description:'Obtiene detalle y mensajes de un reclamo de Mercado Libre.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},claim_id:{type:['string','number']}},required:['cuenta','claim_id'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_answer_question', title:'Responder pregunta', description:'ENVIA una respuesta a una pregunta de Mercado Libre. Solo ejecuta si confirm=true. Antes de usarla, revisar el contexto completo (incluidas fotos), mostrar al usuario la respuesta exacta y obtener su confirmacion explicita. La firma se normaliza automaticamente: TLC=TELOCONSIGO (una sola palabra), TOP SHOP=TOP SHOP.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},question_id:{type:['string','number']},text:{type:'string',minLength:1},confirm:{type:'boolean',description:'Debe ser true despues de confirmacion explicita del usuario.'}},required:['cuenta','question_id','text','confirm'],additionalProperties:false}, annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true} },
  { name:'meli_sales', title:'Ventas por periodo', description:'Lista ventas de una cuenta por periodo y permite analizar facturacion, productos, estados y compradores. Solo lectura.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},date_from:{type:'string',description:'Fecha/hora ISO opcional'},date_to:{type:'string',description:'Fecha/hora ISO opcional'},limit:{type:'integer',minimum:1,maximum:50,default:50},offset:{type:'integer',minimum:0,default:0}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_account_metrics', title:'Metricas de cuenta', description:'Obtiene datos y reputacion actual de la cuenta vendedora para seguimiento operativo. Solo lectura.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_ads_campaigns', title:'Campanas Product Ads', description:'Consulta campanas y metricas actuales de Product Ads. Permite analizar inversion, ventas atribuidas, ROAS, ACOS, CTR, impresiones, clics y perdida de impresiones. Solo lectura.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},date_from:{type:'string',description:'YYYY-MM-DD opcional'},date_to:{type:'string',description:'YYYY-MM-DD opcional'},status:{type:'string',description:'active, paused o vacio'},limit:{type:'integer',minimum:1,maximum:100,default:50},offset:{type:'integer',minimum:0,default:0}},required:['cuenta'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_ads_adgroups', title:'Detalle Product Ads', description:'Obtiene Ad Groups, metricas y publicaciones asociadas de una campana Product Ads. Admite periodos de varios dias y devuelve producto, MLU y SKU cuando Mercado Libre los expone. Solo lectura.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},campaign_id:{type:['string','number']},date_from:{type:'string'},date_to:{type:'string'}},required:['cuenta','campaign_id'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_catalog_competition', title:'Competencia de Catalogo', description:'Revisa publicaciones de Catalogo y consulta price_to_win v2 para identificar cuales estan ganando, compartiendo primer lugar, perdiendo o listadas sin competir. Puede revisar TLC, TOP SHOP o ambas y devuelve precio para ganar, ganador, motivos y boosts/oportunidades. Solo lectura.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop','both'],default:'both'},only_losing:{type:'boolean',default:true,description:'Si true devuelve detalle solo de competing y listed; el resumen siempre incluye todos los estados.'},refresh:{type:'boolean',default:true,description:'Actualiza la lista de publicaciones antes del analisis para detectar correctamente las de Catalogo.'},max_items:{type:'integer',minimum:1,maximum:5000,default:5000}},additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'meli_prepare_publication', title:'Preparar publicacion desde link', description:'Prepara una publicacion de Mercado Libre desde un link de proveedor. El usuario indica moneda y precio; el stock se fija SIEMPRE en 50. Extrae datos/fotos, detecta categoria y atributos, busca posibles duplicados en TLC/TOP SHOP y guarda un borrador. NO publica.', inputSchema:{type:'object',properties:{url:{type:'string',minLength:8},currency:{type:'string',enum:['UYU','USD']},price:{type:'number',exclusiveMinimum:0},accounts:{type:'array',items:{type:'string',enum:['tlc','topshop']},minItems:1,maxItems:2}},required:['url','currency','price'],additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:true} },
  { name:'meli_publish_draft', title:'Publicar borrador preparado', description:'CREA la publicacion preparada en TELOCONSIGO, TOP SHOP o ambas. Stock siempre 50. Solo ejecuta con confirm=true despues de mostrar al usuario titulo, precio, moneda, fotos, categoria, cuentas y datos faltantes.', inputSchema:{type:'object',properties:{draft_id:{type:'string'},accounts:{type:'array',items:{type:'string',enum:['tlc','topshop']},minItems:1,maxItems:2},confirm:{type:'boolean'}},required:['draft_id','confirm'],additionalProperties:false}, annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true} },
  { name:'meli_update_publication', title:'Modificar publicacion', description:'Modifica campos permitidos de una publicacion: precio, stock, estado, titulo, descripcion, fotos y atributos (por ejemplo COLOR). Primero consulta la publicacion actual y devuelve el resultado campo por campo. Solo ejecuta si confirm=true. Mercado Libre puede bloquear ciertos cambios segun la publicacion/categoria/historial de ventas.', inputSchema:{type:'object',properties:{cuenta:{type:'string',enum:['tlc','topshop']},id:{type:'string'},price:{type:'number',minimum:0},stock:{type:'integer',minimum:0},status:{type:'string',enum:['active','paused']},sku:{type:'string'},title:{type:'string',minLength:1,maxLength:60},description:{type:'string',minLength:1,maxLength:50000},pictures:{type:'array',items:{type:'string',minLength:5},minItems:1,maxItems:12},attributes:{type:'array',items:{type:'object',properties:{id:{type:'string',minLength:1},value_id:{type:['string','number']},value_name:{type:'string'}},required:['id'],additionalProperties:false}},color:{type:'string',minLength:1,description:'Atajo para actualizar el atributo COLOR; por ejemplo Beige.'},confirm:{type:'boolean',description:'Debe ser true despues de confirmacion explicita del usuario.'}},required:['cuenta','id','confirm'],additionalProperties:false}, annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true} }
];

async function mcpTextResult(data) {
  const imageUrls = Array.isArray(data?._mcpImageUrls) ? data._mcpImageUrls : [];
  const structured = data && typeof data === 'object' ? {...data} : data;
  if (structured && typeof structured === 'object') delete structured._mcpImageUrls;
  const content = [{type:'text', text:JSON.stringify(structured)}];
  // MCP permite contenido image (base64). Esto hace visibles a ChatGPT las fotos de la publicacion.
  for (const url of imageUrls.slice(0, 8)) {
    try {
      const r = await fetch(url, {headers:{'User-Agent':'TELOCONSIGO-MCP/3.2'}});
      if (!r.ok) continue;
      const ct = String(r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (!ct.startsWith('image/')) continue;
      const ab = await r.arrayBuffer();
      if (ab.byteLength > 5 * 1024 * 1024) continue;
      content.push({type:'image', data:Buffer.from(ab).toString('base64'), mimeType:ct});
    } catch (_) {}
  }
  return { content, structuredContent:structured, isError:false };
}
function mcpErrorResult(message) {
  return { content:[{type:'text', text:String(message)}], isError:true };
}
async function mcpCallTool(name, args={}) {
  const cuenta = agentAccount(args.cuenta || 'tlc');
  const limit = Math.max(1, Math.min(Number(args.limit || 50), 100));
  const offset = Math.max(0, Number(args.offset || 0));
  if (name === 'meli_account') {
    const me = await meliApi(cuenta, '/users/me');
    return {ok:true,cuenta,seller:{id:me?.id,nickname:me?.nickname,status:me?.status,site_id:me?.site_id}};
  }
  if (name === 'meli_questions') {
    const sellerId = await fetchMeliSellerId(cuenta);
    const qs = new URLSearchParams({seller_id:String(sellerId),status:String(args.status||'UNANSWERED'),limit:String(limit),offset:String(offset),'sort.field':'date_created','sort.order':'DESC'});
    const data = await meliApi(cuenta, `/questions/search?${qs.toString()}`);
    return {ok:true,cuenta,...data};
  }
  if (name === 'meli_claims') {
    const qs = new URLSearchParams({stage:'claim',status:String(args.status||'opened'),limit:String(limit),offset:String(offset),sort:'date_created,desc'});
    const data = await meliApi(cuenta, `/post-purchase/v1/claims/search?${qs.toString()}`);
    return {ok:true,cuenta,...data};
  }
  if (name === 'meli_order') {
    const id=String(args.id||'').trim(); if(!id) throw new Error('Falta id de venta.');
    return {ok:true,cuenta,order:await meliApi(cuenta, `/orders/${encodeURIComponent(id)}`)};
  }
  if (name === 'meli_item') {
    const id=String(args.id||'').trim(); if(!id) throw new Error('Falta id de publicacion.');
    return {ok:true,cuenta,item:await getMeliItemForSmartUpdate(cuenta,id)};
  }
  if (name === 'meli_publications') {
    const q=String(args.q||'').trim().toLowerCase();
    const cache=loadPublicationsCache();
    if(args.refresh || !Array.isArray(cache[cuenta]) || !cache[cuenta].length){cache[cuenta]=await fetchAllPublicationsDirect(cuenta,{});cache.updatedAt=new Date().toISOString();savePublicationsCache(cache);}
    let items=cache[cuenta]||[];
    if(q) items=items.filter(x=>JSON.stringify([x.id,x.mlu,x.title,x.sku,x.seller_custom_field,x.status]).toLowerCase().includes(q));
    return {ok:true,cuenta,total:items.length,updatedAt:cache.updatedAt,items:items.slice(offset,offset+limit)};
  }
  if (name === 'meli_question_context') {
    const questionId=String(args.question_id||'').trim(); if(!questionId) throw new Error('Falta question_id.');
    const question=await meliApi(cuenta, `/questions/${encodeURIComponent(questionId)}`);
    const itemId=String(question?.item_id||'').trim();
    let item=null, description=null, history=null;
    if(itemId){
      item=await getMeliItemForSmartUpdate(cuenta,itemId);
      try { description=await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}/description`); } catch(e) { description={error:e.message}; }
      try {
        const sellerId=await fetchMeliSellerId(cuenta);
        const hlimit=Math.max(1,Math.min(Number(args.history_limit||50),100));
        const qs=new URLSearchParams({seller_id:String(sellerId),item_id:itemId,limit:String(hlimit),'sort.field':'date_created','sort.order':'DESC'});
        history=await meliApi(cuenta, `/questions/search?${qs.toString()}`);
      } catch(e) { history={error:e.message}; }
    }
    const brand = cuenta === 'tlc' ? 'TELOCONSIGO' : 'TOP SHOP';
    const pictureUrls = Array.isArray(item?.pictures)
      ? item.pictures.map(p => p?.secure_url || p?.url).filter(Boolean).slice(0, 10)
      : [];
    return {
      ok:true,cuenta,brand,question,item,description,history,picture_urls:pictureUrls,
      visual_reasoning_guidance:{
        priority:'Interpretar primero la intencion real de la pregunta del cliente y luego evaluar todas las fuentes disponibles, incluidas las fotos.',
        photos_are_evidence:true,
        use_photos_when:'El dato consultado sea claramente observable en la imagen, aunque no figure escrito en atributos o descripcion. Ejemplos: geometria o forma del cuadro, color visible, presencia/ausencia de un componente, cantidad de piezas visibles o accesorios visibles.',
        do_not_require_literal_match:'No buscar solamente las mismas palabras usadas por el cliente. Traducir la pregunta a la caracteristica visual o tecnica que realmente desea confirmar.',
        do_not_infer_from_photos:'No deducir medidas exactas, potencia, autonomia, capacidad de carga, material interno, compatibilidad tecnica ni otras propiedades que una foto no permita comprobar de forma confiable.',
        conflict_rule:'Si una foto clara contradice texto o atributos, no responder automaticamente: indicar la contradiccion para revision.',
        missing_rule:'Solo declarar que falta informacion despues de revisar texto, atributos, descripcion, historial y fotos.'
      },
      _mcpImageUrls:pictureUrls
    };
  }
  if (name === 'meli_messages_unread' || name === 'meli_unread_messages') {
    const data=await meliApi(cuenta, '/messages/unread?role=seller&tag=post_sale');
    return {ok:true,cuenta,...data};
  }
  if (name === 'meli_message_thread' || name === 'meli_message_context') {
    const packId=String(args.pack_id||'').trim(); if(!packId) throw new Error('Falta pack_id.');
    const sellerId=await fetchMeliSellerId(cuenta);
    const conversation=await meliApi(cuenta, `/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(sellerId)}?tag=post_sale&mark_as_read=false`);
    let order=null, items=[];
    const orderId=String(conversation?.messages?.[0]?.message_resources?.find?.(x=>x?.name==='packs')?.id || packId);
    try { order=await meliApi(cuenta, `/orders/${encodeURIComponent(orderId)}`); } catch(e) { order={error:e.message}; }
    const itemIds=[];
    for(const oi of (order?.order_items||[])){ const id=oi?.item?.id; if(id && !itemIds.includes(id)) itemIds.push(id); }
    for(const id of itemIds.slice(0,10)){ try { items.push(await getMeliItemForSmartUpdate(cuenta,id)); } catch(e){ items.push({id,error:e.message}); } }
    return {ok:true,cuenta,pack_id:packId,conversation,order,items,mark_as_read:false};
  }
  if (name === 'meli_send_message') {
    if(args.confirm !== true) throw new Error('CONFIRMACION_REQUERIDA: muestra primero el mensaje exacto al usuario y vuelve a llamar con confirm=true solo si lo aprueba.');
    const packId=String(args.pack_id||'').trim(), buyerId=String(args.buyer_id||'').trim(), text=String(args.text||'').trim();
    if(!packId || !buyerId || !text) throw new Error('pack_id, buyer_id y text son obligatorios.');
    if(text.length>350) throw new Error('El mensaje supera el limite de 350 caracteres de Mercado Libre.');
    const sellerId=await fetchMeliSellerId(cuenta);
    const response=await meliApi(cuenta, `/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(sellerId)}?tag=post_sale`, {method:'POST',body:{from:{user_id:String(sellerId)},to:{user_id:buyerId},text}});
    return {ok:true,cuenta,action:'send_post_sale_message',pack_id:packId,buyer_id:buyerId,text,response};
  }
  if (name === 'meli_claim_context') {
    const claimId=String(args.claim_id||'').trim(); if(!claimId) throw new Error('Falta claim_id.');
    const claim=await meliApi(cuenta, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
    let messages=[], order=null, items=[], returnDetail=null;
    try { messages=await meliApi(cuenta, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/messages`); } catch(e) { messages={error:e.message}; }
    const orderId=String(claim?.resource_id||'').trim();
    if(orderId){ try { order=await meliApi(cuenta, `/orders/${encodeURIComponent(orderId)}`); } catch(e){ order={error:e.message}; } }
    for(const oi of (order?.order_items||[]).slice(0,10)){ const id=oi?.item?.id; if(id){ try{ items.push(await getMeliItemForSmartUpdate(cuenta,id)); }catch(e){items.push({id,error:e.message});} } }
    const attachmentIds=[];
    const walk=(v)=>{ if(!v)return; if(Array.isArray(v)){v.forEach(walk);return;} if(typeof v==='object'){ for(const [k,x] of Object.entries(v)){ if(/attachment|filename/i.test(k)){ if(typeof x==='string' && x) attachmentIds.push(x); if(Array.isArray(x)) x.forEach(y=>{if(typeof y==='string')attachmentIds.push(y); else walk(y)}); } walk(x); } } };
    walk(messages);
    const attachmentInfo=[]; const imageUrls=[];
    for(const aid of [...new Set(attachmentIds)].slice(0,10)){
      try { const info=await meliApi(cuenta, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/attachments/${encodeURIComponent(aid)}`); attachmentInfo.push({id:aid,info}); if(String(info?.type||'').startsWith('image/')) imageUrls.push(`https://api.mercadolibre.com/post-purchase/v1/claims/${encodeURIComponent(claimId)}/attachments/${encodeURIComponent(aid)}/download`); } catch(e){ attachmentInfo.push({id:aid,error:e.message}); }
    }
    try { returnDetail=await meliApi(cuenta, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/returns`); } catch(e) { returnDetail={available:false,error:e.message}; }
    return {ok:true,cuenta,claim,messages,order,items,attachments:attachmentInfo,return_detail:returnDetail,_mcpImageUrls:imageUrls};
  }
  if (name === 'meli_send_claim_message') {
    if(args.confirm !== true) throw new Error('CONFIRMACION_REQUERIDA: muestra primero el mensaje exacto al usuario y vuelve a llamar con confirm=true solo si lo aprueba.');
    const claimId=String(args.claim_id||'').trim(), text=String(args.text||'').trim(); if(!claimId||!text) throw new Error('claim_id y text son obligatorios.');
    const receiverRole=String(args.receiver_role||'complainant');
    const response=await meliApi(cuenta, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/actions/send-message`, {method:'POST',body:{receiver_role:receiverRole,message:text,attachments:[]}});
    return {ok:true,cuenta,action:'send_claim_message',claim_id:claimId,receiver_role:receiverRole,text,response};
  }
  if (name === 'meli_support_summary') {
    const accounts={};
    for(const c of ['tlc','topshop']){
      const sellerId=await fetchMeliSellerId(c);
      const q=new URLSearchParams({seller_id:String(sellerId),status:'UNANSWERED',limit:'50',offset:'0','sort.field':'date_created','sort.order':'DESC'});
      let questions, unread_messages, claims;
      try{questions=await meliApi(c, `/questions/search?${q.toString()}`);}catch(e){questions={error:e.message};}
      try{unread_messages=await meliApi(c, '/messages/unread?role=seller&tag=post_sale');}catch(e){unread_messages={error:e.message};}
      try{claims=await meliApi(c, '/post-purchase/v1/claims/search?stage=claim&status=opened&limit=50&offset=0&sort=date_created%2Cdesc');}catch(e){claims={error:e.message};}
      accounts[c]={brand:c==='tlc'?'TELOCONSIGO':'TOP SHOP',questions,unread_messages,claims};
    }
    return {ok:true,read_only:true,accounts};
  }
  if (name === 'meli_sales') {
    const sellerId=await fetchMeliSellerId(cuenta);
    const pageLimit=Math.min(Number(limit)||50,50);
    const requestedOffset=Math.max(Number(offset)||0,0);
    const fromMs=args.date_from ? Date.parse(String(args.date_from)) : NaN;
    const toMs=args.date_to ? Date.parse(String(args.date_to)) : NaN;
    const hasDateFilter=Number.isFinite(fromMs)||Number.isFinite(toMs);

    const normalizeOrderDate=(v)=>{
      if(!v) return '';
      const d=new Date(String(v));
      if(Number.isNaN(d.getTime())) return String(v);
      // La documentacion de ML indica que el filtro de orders usa precision de hora.
      d.setUTCMinutes(0,0,0);
      return d.toISOString();
    };
    const apiErrors=[];
    const tryOrders=async(qs,label)=>{
      try { return await meliApi(cuenta, `/orders/search?${qs.toString()}`); }
      catch(e){ apiErrors.push({strategy:label,error:e.message}); return null; }
    };

    // Estrategia 1: busqueda oficial por vendedor + rango de fechas.
    let data=null;
    const directQs=new URLSearchParams({seller:String(sellerId),sort:'date_desc',limit:String(pageLimit),offset:String(requestedOffset)});
    if(args.date_from) directQs.set('order.date_created.from', normalizeOrderDate(args.date_from));
    if(args.date_to) directQs.set('order.date_created.to', normalizeOrderDate(args.date_to));
    data=await tryOrders(directQs,'seller_date_range');

    let fallbackUsed=false;
    let rows=[];
    if(data){
      rows=Array.isArray(data?.results)?data.results:[];
    } else {
      fallbackUsed=true;
      const collected=[];
      const fetchSize=50;
      const maxPages=20;

      // Estrategia 2: paginar por vendedor sin filtros de fecha y filtrar localmente.
      // Estrategia 3: si ML aplica una policy distinta a la busqueda general, pedir paid y
      // cancelled por separado (ambos filtros estan documentados) y luego unir/deduplicar.
      const modes=[
        {label:'seller_recent',status:''},
        {label:'seller_paid',status:'paid'},
        {label:'seller_cancelled',status:'cancelled'}
      ];
      let anyModeWorked=false;
      for(const mode of modes){
        const modeRows=[];
        let modeWorked=false;
        for(let page=0; page<maxPages; page++){
          const qs=new URLSearchParams({seller:String(sellerId),sort:'date_desc',limit:String(fetchSize),offset:String(page*fetchSize)});
          if(mode.status) qs.set('order.status',mode.status);
          const chunk=await tryOrders(qs,`${mode.label}_page_${page}`);
          if(!chunk) break;
          modeWorked=true; anyModeWorked=true;
          const chunkRows=Array.isArray(chunk?.results)?chunk.results:[];
          if(!chunkRows.length) break;
          modeRows.push(...chunkRows);
          if(Number.isFinite(fromMs)){
            const times=chunkRows.map(o=>Date.parse(String(o?.date_created||o?.date_closed||''))).filter(Number.isFinite);
            const oldest=times.length?Math.min(...times):NaN;
            if(Number.isFinite(oldest) && oldest < fromMs) break;
          }
          if(chunkRows.length<fetchSize) break;
        }
        if(modeWorked) collected.push(...modeRows);
        // Si la busqueda general funciono, no duplicamos con status separados.
        if(mode.label==='seller_recent' && modeWorked) break;
      }

      if(!anyModeWorked){
        return {ok:false,cuenta,read_only:true,error:'MELI_ORDERS_UNAUTHORIZED',authorization_required:true,message:'Mercado Libre permite acceder a la cuenta pero rechazo todas las variantes documentadas de /orders/search para este token. Es necesario reautorizar la cuenta TLC o revisar la aplicacion OAuth asociada; no existe un bypass seguro por codigo.',seller_id:sellerId,attempts:apiErrors};
      }

      const dedup=new Map();
      for(const o of collected){ if(o?.id!=null) dedup.set(String(o.id),o); }
      const filtered=[...dedup.values()].filter(o=>{
        const t=Date.parse(String(o?.date_created||o?.date_closed||''));
        if(!Number.isFinite(t)) return !hasDateFilter;
        if(Number.isFinite(fromMs) && t<fromMs) return false;
        if(Number.isFinite(toMs) && t>toMs) return false;
        return true;
      }).sort((a,b)=>Date.parse(String(b?.date_created||b?.date_closed||0))-Date.parse(String(a?.date_created||a?.date_closed||0)));
      rows=filtered.slice(requestedOffset,requestedOffset+pageLimit);
      data={paging:{total:filtered.length,offset:requestedOffset,limit:pageLimit},results:rows};
    }

    const summary={orders:rows.length,total_amount:0,paid:0,cancelled:0,currencies:{}};
    for(const o of rows){ const amount=Number(o?.total_amount||0); summary.total_amount+=amount; const cur=String(o?.currency_id||''); if(cur)summary.currencies[cur]=(summary.currencies[cur]||0)+amount; if(o?.status==='paid')summary.paid++; if(String(o?.status||'').includes('cancel'))summary.cancelled++; }
    return {ok:true,cuenta,read_only:true,summary,fallback_used:fallbackUsed,api_attempt_errors:apiErrors.length?apiErrors:undefined,...data};
  }
  if (name === 'meli_account_metrics') {
    const me=await meliApi(cuenta, '/users/me');
    return {ok:true,cuenta,read_only:true,metrics:{id:me?.id,nickname:me?.nickname,site_id:me?.site_id,status:me?.status,points:me?.points,seller_reputation:me?.seller_reputation,transactions:me?.seller_reputation?.transactions,tags:me?.tags}};
  }
  if (name === 'meli_ads_campaigns') {
    const adv=await meliApi(cuenta, '/advertising/advertisers?product_id=PADS', {headers:{'Api-Version':'1','Content-Type':'application/json'}});
    const advertisers=Array.isArray(adv?.advertisers)?adv.advertisers:(Array.isArray(adv)?adv:[]);
    if(!advertisers.length) return {ok:true,cuenta,read_only:true,advertisers:[],campaigns:[],note:'Mercado Libre no devolvio advertiser PADS para esta cuenta.'};
    const advertiser=advertisers.find(a=>String(a.site_id||'').toUpperCase()==='MLU')||advertisers[0];
    const site=String(advertiser.site_id||'MLU'), advertiserId=advertiser.advertiser_id||advertiser.id;
    const qs=new URLSearchParams({limit:String(limit),offset:String(offset)});
    if(args.date_from)qs.set('date_from',String(args.date_from)); if(args.date_to)qs.set('date_to',String(args.date_to)); if(args.status)qs.set('filters[status]',String(args.status));
    // En campaigns/search solo pedimos las metricas admitidas por ese endpoint.
    // Las metricas de competitividad (impression_share y variantes) pertenecen al
    // detalle de una campana, no al search agregado. Ademas ML exige ambas fechas
    // cuando se solicitan metricas, por eso una consulta sin fechas lista campanas sin metrics.
    if(args.date_from && args.date_to){
      qs.set('metrics','clicks,prints,ctr,cost,cpc,acos,organic_units_quantity,organic_units_amount,organic_items_quantity,direct_items_quantity,indirect_items_quantity,advertising_items_quantity,cvr,roas,sov,direct_units_quantity,indirect_units_quantity,units_quantity,direct_amount,indirect_amount,total_amount');
    }
    const campaigns=await meliApi(cuenta, `/advertising/${encodeURIComponent(site)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/campaigns/search?${qs.toString()}`, {headers:{'api-version':'2'}});
    return {ok:true,cuenta,read_only:true,advertiser,campaigns};
  }
  if (name === 'meli_ads_adgroups') {
    const campaignId=String(args.campaign_id||'').trim(); if(!campaignId)throw new Error('Falta campaign_id.');
    const adv=await meliApi(cuenta, '/advertising/advertisers?product_id=PADS', {headers:{'Api-Version':'1','Content-Type':'application/json'}});
    const advertisers=Array.isArray(adv?.advertisers)?adv.advertisers:(Array.isArray(adv)?adv:[]);
    const advertiser=advertisers.find(a=>String(a.site_id||'').toUpperCase()==='MLU')||advertisers[0];
    if(!advertiser)throw new Error('La cuenta no devolvio advertiser PADS.');
    const site=String(advertiser.site_id||'MLU'), advertiserId=advertiser.advertiser_id||advertiser.id;
    const metrics='CLICKS,PRINTS,COST,CPC,CTR,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,INDIRECT_UNITS_QUANTITY,UNITS_QUANTITY,DIRECT_ITEMS_QUANTITY,INDIRECT_ITEMS_QUANTITY,ADVERTISING_ITEMS_QUANTITY,ORGANIC_UNITS_QUANTITY,ORGANIC_UNITS_AMOUNT,ORGANIC_ITEMS_QUANTITY,ACOS,TACOS,SOV,CVR,ROAS';

    // V5.0.2: usamos el search de Ad Groups por advertiser, que admite rangos de varios dias
    // sin exigir filters[ad_group_ids] y devuelve detalle + metricas del grupo.
    const qs=new URLSearchParams({limit:'800',offset:'0','filters[campaigns]':campaignId,metrics,metrics_summary:'true'});
    if(args.date_from)qs.set('date_from',String(args.date_from));
    if(args.date_to)qs.set('date_to',String(args.date_to));
    const search=await meliApi(cuenta, `/advertising/${encodeURIComponent(site)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/ad_groups/search?${qs.toString()}`, {headers:{'api-version':'2'}});
    const groups=Array.isArray(search?.results)?search.results:[];

    // Relaciona cada Ad Group con sus publicaciones reales. El endpoint /ads devuelve item_id,
    // titulo y user_product; luego /items/{id} aporta SKU/seller_custom_field cuando existe.
    const enriched=[];
    for(const g of groups){
      const gid=String(g?.id||g?.ad_group_id||'').trim();
      let ads=[];
      if(gid){
        try{
          const aq=new URLSearchParams();
          if(args.date_from)aq.set('date_from',String(args.date_from));
          if(args.date_to)aq.set('date_to',String(args.date_to));
          aq.set('metrics',metrics.toLowerCase());
          const adData=await meliApi(cuenta, `/advertising/${encodeURIComponent(site)}/product_ads/ad_groups/${encodeURIComponent(gid)}/ads?${aq.toString()}`, {headers:{'api-version':'2'}});
          ads=Array.isArray(adData?.results)?adData.results:[];
        }catch(e){ ads=[{_error:e.message}]; }
      }
      const products=[];
      for(const ad of ads.slice(0,20)){
        if(ad?._error){products.push(ad);continue;}
        const itemId=String(ad?.item_id||'').trim();
        let item=null;
        if(/^MLU\d+$/i.test(itemId)){
          try{item=await meliApi(cuenta, `/items/${encodeURIComponent(itemId)}`);}catch{}
        }
        const attrs=Array.isArray(item?.attributes)?item.attributes:[];
        const skuAttr=attrs.find(a=>String(a?.id||'').toUpperCase()==='SELLER_SKU');
        const sku=String(item?.seller_custom_field||skuAttr?.value_name||skuAttr?.value_id||ad?.seller_sku||'').trim();
        products.push({item_id:itemId||null,title:ad?.title||item?.title||null,sku:sku||null,user_product_id:ad?.user_product_id||null,user_product_name:ad?.user_product_name||null,status:ad?.status||null,price:ad?.price??item?.price??null,permalink:item?.permalink||ad?.permalink||null,metrics:ad?.metrics||null});
      }
      enriched.push({...g,products});
    }
    return {ok:true,cuenta,read_only:true,campaign_id:campaignId,advertiser:{advertiser_id:advertiserId,site_id:site},paging:search?.paging||null,metrics_summary:search?.metrics_summary||null,ad_groups:enriched};
  }

  if (name === 'meli_catalog_competition') {
    const requested=String(args.cuenta||'both').toLowerCase();
    const accounts=requested==='both'?['tlc','topshop']:[agentAccount(requested)];
    const onlyLosing=args.only_losing!==false;
    const refresh=args.refresh!==false;
    const maxItems=Math.max(1,Math.min(Number(args.max_items||5000),5000));
    const cache=loadPublicationsCache();
    const report={ok:true,read_only:true,source:'GET /items/{MLU}/price_to_win?siteId=MLU&version=v2',accounts:{},summary:{catalog_checked:0,winning:0,sharing_first_place:0,competing:0,listed:0,other:0,errors:0},items:[],truncated:false};
    for(const c of accounts){
      try{
        if(refresh || !Array.isArray(cache[c]) || !cache[c].length || !cache[c].some(x=>Object.prototype.hasOwnProperty.call(x,'catalog_listing'))){
          cache[c]=await fetchAllPublicationsDirect(c,{}); cache.updatedAt=new Date().toISOString(); savePublicationsCache(cache);
        }
        const candidates=(cache[c]||[]).filter(x=>x && (x.catalog_listing || x.catalog_product_id) && String(x.status||'').toLowerCase()!=='closed');
        const selected=candidates.slice(0,maxItems);
        if(candidates.length>selected.length) report.truncated=true;
        const acc={catalog_found:candidates.length,checked:selected.length,winning:0,sharing_first_place:0,competing:0,listed:0,other:0,errors:0};
        const concurrency=8;
        for(let i=0;i<selected.length;i+=concurrency){
          const chunk=selected.slice(i,i+concurrency);
          const rows=await Promise.all(chunk.map(async pub=>{
            try{
              const d=await meliApi(c, `/items/${encodeURIComponent(pub.id||pub.mlu)}/price_to_win?siteId=MLU&version=v2`);
              const st=String(d?.status||'other'); acc[st]=(acc[st]||0)+1; report.summary[st]=(report.summary[st]||0)+1;
              const current=Number(d?.current_price ?? pub.price ?? 0)||0;
              const ptw=d?.price_to_win==null?null:Number(d.price_to_win);
              const diff=ptw==null?null:Number((current-ptw).toFixed(2));
              const diffPct=(ptw!=null && current>0)?Number((((current-ptw)/current)*100).toFixed(2)):null;
              return {cuenta:c,item_id:String(d?.item_id||pub.id||pub.mlu||''),title:pub.title||null,sku:pub.sku||null,catalog_product_id:d?.catalog_product_id||pub.catalog_product_id||null,status:st,visit_share:d?.visit_share??null,current_price:current,currency_id:d?.currency_id||pub.currency_id||'UYU',price_to_win:ptw,price_reduction_needed:diff,price_reduction_percent:diffPct,competitors_sharing_first_place:d?.competitors_sharing_first_place??null,reason:Array.isArray(d?.reason)?d.reason:[],boosts:Array.isArray(d?.boosts)?d.boosts:[],opportunities:Array.isArray(d?.boosts)?d.boosts.filter(b=>b?.status==='opportunity'):[],winner:d?.winner?{item_id:d.winner.item_id||null,price:d.winner.price??null,currency_id:d.winner.currency_id||null,boosts:Array.isArray(d.winner.boosts)?d.winner.boosts:[]}:null};
            }catch(e){acc.errors++;report.summary.errors++;return {cuenta:c,item_id:String(pub.id||pub.mlu||''),title:pub.title||null,sku:pub.sku||null,error:String(e?.message||e)};}
          }));
          for(const row of rows){if(row.error || !onlyLosing || row.status==='competing' || row.status==='listed') report.items.push(row);}
        }
        report.summary.catalog_checked+=selected.length; report.accounts[c]=acc;
      }catch(e){report.accounts[c]={error:String(e?.message||e)};report.summary.errors++;}
    }
    report.items.sort((a,b)=>{const rank={competing:0,listed:1,sharing_first_place:2,winning:3};return (rank[a.status]??9)-(rank[b.status]??9) || (Number(b.price_reduction_percent)||0)-(Number(a.price_reduction_percent)||0);});
    report.updatedAt=cache.updatedAt||new Date().toISOString();
    return report;
  }

  if (name === 'meli_prepare_publication') {
    const url=String(args.url||'').trim(); const price=Number(args.price); const currency=String(args.currency||'UYU').toUpperCase(); const accounts=(Array.isArray(args.accounts)&&args.accounts.length?args.accounts:['tlc','topshop']).map(normalizeCuentaKey).filter((v,i,a)=>['tlc','topshop'].includes(v)&&a.indexOf(v)===i);
    if(!/^https?:\/\//i.test(url))throw new Error('Falta un link valido del producto.'); if(!(price>0))throw new Error('Falta precio valido.'); if(!['UYU','USD'].includes(currency))throw new Error('Moneda valida: UYU o USD.');
    const pageResp=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 TLC-Publicador-V5/1.0'}}); if(!pageResp.ok)throw new Error(`No se pudo leer el link del proveedor (${pageResp.status}).`);
    const buf=Buffer.from(await pageResp.arrayBuffer()); const contentType=pageResp.headers.get('content-type')||''; const charset=(contentType.match(/charset=([^;]+)/i)?.[1]||'').toLowerCase(); let html=buf.toString('utf8'); if(charset&&!charset.includes('utf')&&(charset.includes('iso')||charset.includes('latin')||charset.includes('windows')))html=new TextDecoder('latin1').decode(buf);
    let scraped=parsePublicadorHtml(html,url); const meliIds=extractMeliIdsFromUrlOrHtml(url,html); if(meliIds.itemId||meliIds.catalogId||meliIds.userProductId){const imgs=await fetchMeliItemImagesFromPublicApi(meliIds.itemId,meliIds.catalogId,accounts[0]||'tlc',meliIds.userProductId);if(imgs.length)scraped={...scraped,images:mergePublicadorImages(scraped.images||[],imgs,url)};}
    const ai=await generatePublicadorContent({...scraped,url}); const category=await detectPublicadorCategory(ai.titulo_meli||scraped.scrapedTitle); const allAttributes=addSyntheticSpecialRequirements(await getPublicadorCategoryAttributes(category.categoryId),category); const requiredAttributes=allAttributes.filter(isPublicadorRequiredAttr);
    const draft={id:crypto.randomUUID?crypto.randomUUID():crypto.randomBytes(16).toString('hex'),status:'preview',source:'mcp_v5',url,price,currency,stock:50,accounts,createdAt:new Date().toISOString(),...scraped,...ai,...category,requiredAttributes,allAttributes}; draft.stock=50; draft.meliPayload=buildPublicadorPayload(draft); draft.meliPayload.available_quantity=50;
    const duplicateCandidates={}; const terms=[draft.model,draft.brand,draft.titulo_meli].filter(Boolean).join(' ').toLowerCase();
    for(const c of ['tlc','topshop']){try{const pubs=await fetchAllPublicationsDirect(c,{}); duplicateCandidates[c]=(pubs||[]).filter(x=>{const hay=JSON.stringify([x.id,x.title,x.sku,x.seller_custom_field]).toLowerCase(); const tokens=terms.split(/\s+/).filter(t=>t.length>=4); return tokens.length&&tokens.filter(t=>hay.includes(t)).length>=Math.min(2,tokens.length);}).slice(0,10);}catch(e){duplicateCandidates[c]=[{error:e.message}];}}
    const data=loadPublicadorDrafts(); data.drafts=data.drafts||[]; data.drafts.unshift(draft); savePublicadorDrafts(data);
    const missing=requiredAttributes.filter(a=>!draft.meliPayload?.attributes?.some(x=>String(x.id)===String(a.id)&&String(x.value_name||x.value_id||'').trim())).map(a=>({id:a.id,name:a.name||a.id}));
    return {ok:true,read_only:true,draft_id:draft.id,stock_rule:50,preview:{title:draft.titulo_meli,description:draft.descripcion_meli,price,currency,stock:50,accounts,category:{id:draft.categoryId,name:draft.categoryName},brand:draft.brand,model:draft.model,images:(draft.images||[]).slice(0,8),required_missing:missing,possible_duplicates:duplicateCandidates},image_review_guidance:'Revisar las fotos antes de publicar. Si son insuficientes, de baja calidad o conviene crear/mejorar imagenes, hacerlo antes de llamar a meli_publish_draft.'};
  }
  if (name === 'meli_publish_draft') {
    if(args.confirm!==true)throw new Error('CONFIRMACION_REQUERIDA: mostrar primero la vista previa completa y publicar solo despues de confirmacion explicita.');
    const id=String(args.draft_id||'').trim(); if(!id)throw new Error('Falta draft_id.'); const data=loadPublicadorDrafts(); const draft=(data.drafts||[]).find(d=>String(d.id)===id); if(!draft)throw new Error('No se encontro el borrador preparado.');
    draft.stock=50; draft.accounts=(Array.isArray(args.accounts)&&args.accounts.length?args.accounts:draft.accounts||['tlc','topshop']).map(normalizeCuentaKey).filter((v,i,a)=>['tlc','topshop'].includes(v)&&a.indexOf(v)===i); if(!draft.accounts.length)throw new Error('Selecciona al menos una cuenta.');
    if(!String(draft.gtin||draft.GTIN||'').trim()){draft.noGtinGenericFallback=true;draft.forceGenericNoGtin=true;}
    const payload=buildPublicadorPayload(draft); payload.available_quantity=50; if(!payload.family_name||String(payload.family_name).trim().length<8)throw new Error('Titulo incompleto.'); if(!payload.category_id||payload.category_id==='MLU1574')throw new Error('Categoria no valida.'); if(!payload.price||Number(payload.price)<=0)throw new Error('Precio invalido.'); if(!Array.isArray(payload.pictures)||!payload.pictures.length)throw new Error('Falta al menos una foto.');
    const results=[];
    for(const c of draft.accounts){try{const token=await getMeliAccessToken(c); let p=await preparePublicadorPicturesForAccount(payload,token); p.available_quantity=50; let r=await fetch('https://api.mercadolibre.com/items',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(cleanMeliCreatePayload(p))}); let raw=await r.text(); let response={};try{response=raw?JSON.parse(raw):{};}catch{response={raw};}
      if((!r.ok||!response?.id)&&errorNeedsEmptyGtinReasonRetry(response)){p=forceGenericBrandNoGtinPayload(p);p.available_quantity=50;r=await fetch('https://api.mercadolibre.com/items',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(cleanMeliCreatePayload(p))});raw=await r.text();try{response=raw?JSON.parse(raw):{};}catch{response={raw};}}
      if((!r.ok||!response?.id)&&errorNeedsFashionGridRetry(response)){try{const grid=await createFashionSizeChartForPayload(c,token,p,draft);if(grid?.payload){grid.payload.available_quantity=50;r=await fetch('https://api.mercadolibre.com/items',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(cleanMeliCreatePayload(grid.payload))});raw=await r.text();try{response=raw?JSON.parse(raw):{};}catch{response={raw};}p=grid.payload;}}catch(gridErr){response._grid_error=gridErr.message;}}
      if(r.ok&&response?.id){const descriptionResult=await postMeliItemDescription(token,response.id,p?.description?.plain_text||payload?.description?.plain_text);results.push({cuenta:c,ok:true,itemId:response.id,permalink:response.permalink||null,descriptionResult});}else{const causes=Array.isArray(response?.cause)?response.cause.map(x=>[x.code,x.message].filter(Boolean).join(': ')):[];results.push({cuenta:c,ok:false,status:r.status,error:response?.message||response?.error||'Mercado Libre rechazo la publicacion',detail:causes.join(' | '),response});}
    }catch(e){results.push({cuenta:c,ok:false,error:e.message});}}
    const okCount=results.filter(x=>x.ok).length; draft.status=okCount===draft.accounts.length?'published':(okCount?'partial_error':'publish_error'); draft.updatedAt=new Date().toISOString(); draft.publishedAt=okCount?new Date().toISOString():draft.publishedAt||null; draft.publishResults=results; const di=(data.drafts||[]).findIndex(d=>String(d.id)===id); if(di>=0)data.drafts[di]=draft; savePublicadorDrafts(data);
    return {ok:okCount>0,complete:okCount===draft.accounts.length,draft_id:id,stock:50,okCount,total:draft.accounts.length,results};
  }
  if (name === 'meli_recent_orders') {
    const sellerId=await fetchMeliSellerId(cuenta);
    const qs=new URLSearchParams({seller:String(sellerId),sort:'date_desc',limit:String(Math.min(limit,50)),offset:String(offset)});
    return {ok:true,cuenta,...await meliApi(cuenta, `/orders/search?${qs.toString()}`)};
  }
  if (name === 'meli_claim_detail') {
    const claimId=String(args.claim_id||'').trim(); if(!claimId) throw new Error('Falta claim_id.');
    const claim=await meliApi(cuenta, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
    let messages=null;
    try { messages=await meliApi(cuenta, `/post-purchase/v1/claims/${encodeURIComponent(claimId)}/messages`); } catch(e) { messages={error:e.message}; }
    return {ok:true,cuenta,claim,messages};
  }
  if (name === 'meli_answer_question') {
    if(args.confirm !== true) throw new Error('CONFIRMACION_REQUERIDA: muestra primero la respuesta exacta al usuario y vuelve a llamar con confirm=true solo si la aprueba.');
    const questionId=Number(args.question_id); let text=String(args.text||'').trim();
    if(!Number.isFinite(questionId) || !text) throw new Error('question_id y text son obligatorios.');
    const brand = cuenta === 'tlc' ? 'TELOCONSIGO' : 'TOP SHOP';
    // Normaliza variantes de la marca para evitar firmas como "Te lo Consigo".
    text = text.replace(/\bTe\s+lo\s+Consigo\b/gi, 'TELOCONSIGO');
    const hasBrand = cuenta === 'tlc' ? /\bTELOCONSIGO\b/i.test(text) : /\bTOP\s+SHOP\b/i.test(text);
    if (!hasBrand) text = `${text.replace(/\s+$/,'')} Saludos, ${brand}.`;
    const response=await meliApi(cuenta, '/answers', {method:'POST',body:{question_id:questionId,text}});
    return {ok:true,cuenta,brand,action:'answer_question',question_id:questionId,text,response};
  }
  if (name === 'meli_update_publication') {
    if(args.confirm !== true) throw new Error('CONFIRMACION_REQUERIDA: muestra el cambio exacto al usuario y vuelve a llamar con confirm=true solo si lo aprueba.');
    const id=String(args.id||'').trim(); if(!id) throw new Error('Falta id de publicacion.');
    const hasPrice=args.price!==undefined && args.price!==null;
    const hasStock=args.stock!==undefined && args.stock!==null;
    const hasStatus=args.status!==undefined && args.status!==null && String(args.status).trim();
    const hasTitle=args.title!==undefined && String(args.title||'').trim();
    const hasDescription=args.description!==undefined && String(args.description||'').trim();
    const hasPictures=Array.isArray(args.pictures) && args.pictures.length>0;
    const hasAttributes=(Array.isArray(args.attributes) && args.attributes.length>0) || (args.color!==undefined && String(args.color||'').trim());
    if(!hasPrice && !hasStock && !hasStatus && !hasTitle && !hasDescription && !hasPictures && !hasAttributes) throw new Error('Indica al menos un campo para modificar.');

    const before=await getMeliItemForSmartUpdate(cuenta,id);
    let beforeDescription=null;
    if(hasDescription) { try { beforeDescription=await meliApi(cuenta, `/items/${encodeURIComponent(id)}/description`); } catch(e) { beforeDescription={error:e.message}; } }
    const results={};
    const errors={};
    async function tryField(field, fn) { try { results[field]=await fn(); } catch(e) { errors[field]=String(e?.message||e); } }

    // Precio/stock conserva la logica inteligente ya validada para variantes y vinculadas.
    if(hasPrice || hasStock) await tryField('price_stock', ()=>smartUpdateLinkedPublication(cuenta,id,{price:hasPrice?args.price:undefined,stock:hasStock?args.stock:undefined,sku:args.sku}));
    if(hasStatus) await tryField('status', ()=>meliApi(cuenta, `/items/${encodeURIComponent(id)}`, {method:'PUT',body:{status:String(args.status)}}));
    if(hasTitle) await tryField('title', ()=>meliApi(cuenta, `/items/${encodeURIComponent(id)}`, {method:'PUT',body:{title:String(args.title).trim()}}));

    if(hasAttributes) {
      const requestedAttrs=[];
      const seen=new Set();
      for(const a of (Array.isArray(args.attributes)?args.attributes:[])) {
        const aid=String(a?.id||'').trim().toUpperCase(); if(!aid || seen.has(aid)) continue;
        const out={id:aid};
        if(a.value_id!==undefined && a.value_id!==null && String(a.value_id).trim()) out.value_id=String(a.value_id).trim();
        if(a.value_name!==undefined && a.value_name!==null && String(a.value_name).trim()) out.value_name=String(a.value_name).trim();
        if(out.value_id===undefined && out.value_name===undefined) continue;
        requestedAttrs.push(out); seen.add(aid);
      }
      if(args.color!==undefined && String(args.color||'').trim()) {
        const color={id:'COLOR',value_name:String(args.color).trim()};
        const ix=requestedAttrs.findIndex(a=>a.id==='COLOR');
        if(ix>=0) requestedAttrs[ix]=color; else requestedAttrs.push(color);
      }
      if(requestedAttrs.length) await tryField('attributes', ()=>meliApi(cuenta, `/items/${encodeURIComponent(id)}`, {method:'PUT',body:{attributes:requestedAttrs}}));
    }

    if(hasPictures) {
      const pics=args.pictures.map(x=>String(x||'').trim()).filter(Boolean).map(x=>/^https?:\/\//i.test(x)?{source:x}:{id:x});
      await tryField('pictures', ()=>meliApi(cuenta, `/items/${encodeURIComponent(id)}`, {method:'PUT',body:{pictures:pics}}));
    }
    if(hasDescription) await tryField('description', ()=>meliApi(cuenta, `/items/${encodeURIComponent(id)}/description`, {method:'PUT',body:{plain_text:String(args.description)}}));

    const after=await getMeliItemForSmartUpdate(cuenta,id);
    let afterDescription=null;
    if(hasDescription) { try { afterDescription=await meliApi(cuenta, `/items/${encodeURIComponent(id)}/description`); } catch(e) { afterDescription={error:e.message}; } }
    const requested={price:hasPrice?args.price:undefined,stock:hasStock?args.stock:undefined,status:hasStatus?String(args.status):undefined,sku:args.sku||undefined,title:hasTitle?String(args.title).trim():undefined,description:hasDescription?String(args.description):undefined,pictures:hasPictures?args.pictures:undefined,attributes:Array.isArray(args.attributes)?args.attributes:undefined,color:args.color||undefined};
    return {ok:Object.keys(errors).length===0,partial:Object.keys(results).length>0 && Object.keys(errors).length>0,cuenta,action:'update_publication',item_id:id,before:{title:before?.title,price:before?.price,available_quantity:before?.available_quantity,status:before?.status,attributes:before?.attributes,pictures:before?.pictures,description:beforeDescription},requested,results,errors,after:{title:after?.title,price:after?.price,available_quantity:after?.available_quantity,status:after?.status,attributes:after?.attributes,pictures:after?.pictures,description:afterDescription}};
  }
  throw new Error(`Herramienta MCP desconocida: ${name}`);
}

function mcpProtocolFor(req, requested) {
  const r = String(requested || req.headers['mcp-protocol-version'] || '').trim();
  if (MCP_PROTOCOLS.includes(r)) return r;
  return '2025-06-18';
}

function mcpSend(res, status, payload, protocol, req) {
  const accept = String(req.headers.accept || '');
  const common = {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Expose-Headers':'Mcp-Session-Id, MCP-Protocol-Version',
    'MCP-Protocol-Version': protocol || '2025-06-18',
    'Cache-Control':'no-cache, no-transform',
  };
  // Streamable HTTP permite JSON o SSE. Si el cliente pide exclusivamente SSE,
  // respondemos como un evento message; si acepta JSON, usamos JSON directo.
  const wantsSse = accept.includes('text/event-stream') && !accept.includes('application/json');
  if (wantsSse) {
    res.writeHead(status, {...common,'Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive'});
    res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    return;
  }
  res.writeHead(status, {...common,'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(payload));
}

async function mcpProcessMessage(req, body) {
  const id = body?.id ?? null;
  const method = body?.method;
  const protocol = mcpProtocolFor(req, body?.params?.protocolVersion);
  if (!body || body.jsonrpc !== '2.0' || !method) {
    return {protocol, status:400, payload:{jsonrpc:'2.0',id,error:{code:-32600,message:'Solicitud JSON-RPC invalida'}}};
  }
  if (method === 'initialize') {
    return {protocol,status:200,payload:{jsonrpc:'2.0',id,result:{
      protocolVersion:protocol,
      capabilities:{tools:{listChanged:true}},
      serverInfo:{name:MCP_SERVER_NAME,version:MCP_SERVER_VERSION},
      instructions:'Servidor MCP V5 de TELOCONSIGO y TOP SHOP. Para crear publicaciones desde un link usar meli_prepare_publication: moneda y precio los indica el usuario y stock siempre 50; revisar fotos y si conviene mejorarlas antes de publicar. meli_publish_draft crea la publicacion solo con confirmacion explicita. Para ventas usar meli_sales; para publicidad usar meli_ads_campaigns y meli_ads_adgroups. Para revisar publicaciones que ganan o pierden en Catalogo usar meli_catalog_competition.  Para una revision general usar meli_support_summary. Para mensajes posventa usar meli_messages_unread y meli_message_thread sin marcar como leido; meli_send_message solo con confirmacion explicita. Para reclamos usar meli_claim_context; meli_send_claim_message solo con confirmacion explicita y nunca implica reembolso o disputa. Para responder preguntas, usar meli_question_context. PRIMERO interpretar la intencion real de la pregunta del cliente; no limitarse a buscar coincidencias literales. Revisar titulo, atributos, descripcion, fotos y preguntas/respuestas anteriores. Las fotos son evidencia valida cuando la respuesta sea claramente observable visualmente (por ejemplo geometria/forma del cuadro, color visible, componentes o accesorios visibles), aunque el dato no figure escrito. No inferir desde fotos medidas exactas, potencia, autonomia, capacidad de carga, material interno, compatibilidad tecnica u otros datos no verificables visualmente. Solo decir que falta informacion despues de revisar tambien las fotos. Si foto y texto se contradicen, informar la contradiccion y no afirmar el dato. No inventar informacion. Firma de TLC: TELOCONSIGO, siempre una sola palabra. Firma de TOP SHOP: TOP SHOP. Las herramientas que modifican Mercado Libre exigen confirm=true y deben usarse solo despues de mostrar el cambio exacto y recibir confirmacion explicita del usuario.'
    }}};
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return {protocol,status:202,payload:null,notification:true};
  }
  if (method === 'ping') return {protocol,status:200,payload:{jsonrpc:'2.0',id,result:{}}};
  if (method === 'tools/list') return {protocol,status:200,payload:{jsonrpc:'2.0',id,result:{tools:MCP_TOOLS}}};
  if (method === 'resources/list') return {protocol,status:200,payload:{jsonrpc:'2.0',id,result:{resources:[]}}};
  if (method === 'prompts/list') return {protocol,status:200,payload:{jsonrpc:'2.0',id,result:{prompts:[]}}};
  if (method === 'tools/call') {
    const name=body?.params?.name; const args=body?.params?.arguments || {};
    try { const data=await mcpCallTool(name,args); return {protocol,status:200,payload:{jsonrpc:'2.0',id,result:await mcpTextResult(data)}}; }
    catch(e){ return {protocol,status:200,payload:{jsonrpc:'2.0',id,result:mcpErrorResult(e.message)}}; }
  }
  return {protocol,status:200,payload:{jsonrpc:'2.0',id,error:{code:-32601,message:`Metodo MCP no encontrado: ${method}`}}};
}

async function handleMcp(req,res) {
  // Permite que validadores comprueben que el endpoint existe sin exponer datos.
  if (req.method === 'HEAD') {
    res.writeHead(200, {'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache'}); res.end(); return;
  }
  if (!agentAuthorized(req)) {
    res.writeHead(401, {
      'Content-Type':'application/json; charset=utf-8',
      'Access-Control-Allow-Origin':'*',
      'WWW-Authenticate':'Bearer realm="TELOCONSIGO MCP"',
      'Cache-Control':'no-store'
    });
    res.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'No autorizado'},id:null}));
    return;
  }
  // GET es opcional en Streamable HTTP. Este servidor no mantiene un stream SSE persistente.
  if (req.method === 'GET') {
    res.writeHead(405, {'Allow':'POST, OPTIONS','Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32000,message:'SSE GET no disponible; usa POST Streamable HTTP.'},id:null}));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, {'Allow':'POST, OPTIONS','Access-Control-Allow-Origin':'*'}); res.end(); return;
  }
  try {
    const body=await readBody(req);
    // Compatibilidad defensiva con JSON-RPC batch.
    if (Array.isArray(body)) {
      const out=[]; let protocol='2025-06-18';
      for (const msg of body) {
        const r=await mcpProcessMessage(req,msg); protocol=r.protocol || protocol;
        if (!r.notification && r.payload) out.push(r.payload);
      }
      if (!out.length) { res.writeHead(202, {'Access-Control-Allow-Origin':'*','MCP-Protocol-Version':protocol}); res.end(); return; }
      mcpSend(res,200,out,protocol,req); return;
    }
    const r=await mcpProcessMessage(req,body);
    if (r.notification) { res.writeHead(202, {'Access-Control-Allow-Origin':'*','MCP-Protocol-Version':r.protocol}); res.end(); return; }
    mcpSend(res,r.status,r.payload,r.protocol,req);
  } catch(e) {
    console.error('Error MCP:', e);
    mcpSend(res,500,{jsonrpc:'2.0',id:null,error:{code:-32603,message:'Error interno MCP'}},'2025-06-18',req);
  }
}

// ═══════════════════════════════════════════════
//  SERVIDOR
// ═══════════════════════════════════════════════
const server = http.createServer((req, res) => {

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathName = u.pathname;
  // Login desactivado temporalmente: todas las rutas operan como admin local.
  const session = { username: 'admin', name: 'Admin', role: 'admin', permissions: ['all'] };


  // Diagnostico publico y seguro del MCP: no expone tokens ni datos de Mercado Libre.
  // Permite confirmar exactamente que version y herramientas esta sirviendo Railway.
  if (req.method === 'GET' && pathName === '/api/mcp-tools') {
    jsonResp(res, 200, {
      ok: true,
      server: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      toolCount: MCP_TOOLS.length,
      tools: MCP_TOOLS.map(t => t.name),
      generatedAt: new Date().toISOString()
    }, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    return;
  }

  // Servidor MCP para el complemento de ChatGPT.
  if (pathName === '/mcp') {
    handleMcp(req, res);
    return;
  }

  // API privada para ChatGPT / integraciones externas.
  if (pathName.startsWith('/api/agent/')) {
    handleAgentApi(req, res, u, pathName);
    return;
  }

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

  // ── ASISTENTE IA GENERAL — Centro de Control ───────────────
  if (pathName === '/api/assistant/summary') {
    try {
      const snapshot = assistantBuildSnapshot();
      jsonResp(res, 200, { ok: true, snapshot, newPaused: assistantCompareNewPaused(snapshot) });
    } catch (e) {
      jsonResp(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && pathName === '/api/assistant/daily-control') {
    try {
      const snapshot = assistantBuildSnapshot();
      const saved = assistantSaveDailyControl(snapshot);
      jsonResp(res, 200, { ok: true, savedAt: saved.updatedAt, snapshot });
    } catch (e) {
      jsonResp(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && pathName === '/api/assistant/chat') {
    (async () => {
      try {
        const body = await readBody(req);
        const message = String(body.message || '').trim();
        if (!message) { jsonResp(res, 400, { ok: false, error: 'Falta mensaje.' }); return; }
        jsonResp(res, 200, assistantAnswer(message));
      } catch (e) {
        jsonResp(res, 500, { ok: false, error: e.message });
      }
    })();
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


  // ── LISTA DE PRECIOS ──────────────────────────────────
  if (pathName === '/api/precios' || pathName.startsWith('/api/precios/')) {
    handlePreciosApi(req, res, pathName, session);
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

  // ── BANDEJA MELI DIRECTA ────────────────────────
  // /api/inbox?cuenta=tlc&action=questions|messages_unread|claims|answer|messages_pack|send_message
  if (pathName === '/api/inbox') {
    (async () => {
      try {
        const cuenta = u.searchParams.get('cuenta') || 'tlc';
        const action = u.searchParams.get('action') || 'questions';
        const sellerIds = { tlc: '221081730', topshop: '817844649' };
        const sellerId = sellerIds[cuenta] || sellerIds.tlc;
        const limit = u.searchParams.get('limit') || '50';
        const offset = u.searchParams.get('offset') || '0';
        const body = req.method === 'POST' ? await readBody(req) : {};
        const token = await getMeliAccessToken(cuenta);

        let method = 'GET';
        let url = '';
        let apiBody = null;

        if (action === 'questions') {
          const status = u.searchParams.get('status') || 'UNANSWERED';
          url = `https://api.mercadolibre.com/questions/search?seller_id=${sellerId}&status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}&sort.field=date_created&sort.order=DESC`;
        } else if (action === 'question_detail') {
          const questionId = u.searchParams.get('question_id') || body.question_id;
          url = `https://api.mercadolibre.com/questions/${encodeURIComponent(questionId)}`;
        } else if (action === 'answer') {
          method = 'POST';
          url = 'https://api.mercadolibre.com/answers';
          apiBody = { question_id: Number(body.question_id || u.searchParams.get('question_id')), text: body.text || u.searchParams.get('text') || '' };
        } else if (action === 'messages_unread') {
          url = `https://api.mercadolibre.com/messages/unread?role=seller&tag=post_sale&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
        } else if (action === 'messages_pack') {
          const packId = u.searchParams.get('pack_id') || body.pack_id;
          const mark = String(u.searchParams.get('mark_as_read') || body.mark_as_read || 'false');
          url = `https://api.mercadolibre.com/messages/packs/${encodeURIComponent(packId)}/sellers/${sellerId}?tag=post_sale&mark_as_read=${encodeURIComponent(mark)}`;
        } else if (action === 'send_message') {
          method = 'POST';
          const packId = body.pack_id || u.searchParams.get('pack_id');
          const buyerId = String(body.buyer_id || u.searchParams.get('buyer_id') || '');
          url = `https://api.mercadolibre.com/messages/packs/${encodeURIComponent(packId)}/sellers/${sellerId}?tag=post_sale`;
          apiBody = { from: { user_id: String(sellerId) }, to: { user_id: buyerId }, text: body.text || u.searchParams.get('text') || '' };
        } else if (action === 'claims') {
          const status = u.searchParams.get('status') || 'opened';
          url = `https://api.mercadolibre.com/post-purchase/v1/claims/search?stage=claim&status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}&sort=date_created,desc`;
        } else if (action === 'claim_detail') {
          const claimId = u.searchParams.get('claim_id') || body.claim_id;
          url = `https://api.mercadolibre.com/post-purchase/v1/claims/${encodeURIComponent(claimId)}`;
        } else if (action === 'claim_messages') {
          const claimId = u.searchParams.get('claim_id') || body.claim_id;
          url = `https://api.mercadolibre.com/post-purchase/v1/claims/${encodeURIComponent(claimId)}/messages`;
        } else if (action === 'order_detail') {
          const orderId = u.searchParams.get('order_id') || body.order_id;
          url = `https://api.mercadolibre.com/orders/${encodeURIComponent(orderId)}`;
        } else {
          jsonResp(res, 400, { error: { message: `Accion desconocida: ${action}` } });
          return;
        }

        console.log(`[MELI INBOX DIRECT ${cuenta.toUpperCase()}] (${session.username}) ${method} ${action} -> ${url.substring(0, 180)}...`);
        const opts = { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } };
        if (apiBody) {
          opts.headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(apiBody);
        }
        const r = await fetch(url, opts);
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); }
        catch { data = { error: { message: 'Mercado Libre devolvio respuesta no JSON', raw: text.slice(0, 400) } }; }
        audit(session, 'meli_inbox_direct_api', { cuenta, method, status: r.status, action, params: Object.fromEntries(u.searchParams.entries()) });
        jsonResp(res, r.status, data);
      } catch (e) {
        console.error('Error MeLi INBOX directo:', e.message);
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



          if (postAction === 'get_variations') {
            const linkId = String(body.linkId || '').trim();
            const link = getLinkById(cache, linkId);
            if (!link) { jsonResp(res, 404, { error:'No se encontró el vínculo.' }); return; }
            const master = await getPublicationVariantsInfo('tlc', link.masterId);
            const child = await getPublicationVariantsInfo(link.childCuenta, link.childId);
            jsonResp(res, 200, { ok:true, linkId:link.id, master, child, variationLinks:normalizedVariationLinks(link) });
            return;
          }

          if (postAction === 'save_variation_links') {
            const linkId = String(body.linkId || '').trim();
            const link = getLinkById(cache, linkId);
            if (!link) { jsonResp(res, 404, { error:'No se encontró el vínculo.' }); return; }
            const master = await getPublicationVariantsInfo('tlc', link.masterId);
            const child = await getPublicationVariantsInfo(link.childCuenta, link.childId);
            const requested = Array.isArray(body.variationLinks) ? body.variationLinks : [];
            const clean=[];
            for (const row of requested) {
              const mv=master.variations.find(v=>String(v.id)===String(row.masterVariationId));
              const cv=child.variations.find(v=>String(v.id)===String(row.childVariationId));
              if (!mv || !cv) continue;
              clean.push({ masterVariationId:String(mv.id), childVariationId:String(cv.id), masterLabel:mv.label, childLabel:cv.label, masterSku:mv.sku||'', childSku:cv.sku||'' });
            }
            link.variationLinks=clean;
            link.variationLinksUpdatedAt=new Date().toISOString();
            link.variationLinksUpdatedBy=session.username;
            cache.publicationLinks[link.id]=link;
            cache.movements.push({ id:crypto.randomBytes(8).toString('hex'), at:new Date().toISOString(), type:'variation_links', message:`Se guardaron ${clean.length} vínculo(s) de variantes para ${link.masterId} → ${link.childId}.`, user:session.username });
            savePublicationsCache(cache);
            jsonResp(res, 200, { ok:true, linkId:link.id, variationLinks:clean, publications:buildFlatPublications(cache), linked:buildLinkedPublications(cache) });
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
  console.log('  TELOCONSIGO + TOP SHOP — Panel v104 REPARADO BANDEJA + PUBLICADOR');
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
