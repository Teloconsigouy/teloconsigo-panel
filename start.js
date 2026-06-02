// ═══════════════════════════════════════════════
//  TELOCONSIGO + TOP SHOP — Panel de Control
//  v4 — con login y administración de usuarios
// ═══════════════════════════════════════════════

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT = 8080;


// ═══════════════════════════════════════════════
//  ESTADOS PERSISTENTES DE BANDEJA
//  Guarda leído/no leído, pendientes, descartados y reclamos en JSON.
// ═══════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'inbox-state.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json');
const PUBLICATIONS_CACHE_FILE = path.join(DATA_DIR, 'publications-cache.json');

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

function normalizePublication(raw, cuenta) {
  const id = raw.id || raw.mlu || raw.item_id || raw.itemId || raw.meli_id || raw.meliId || '';
  const sku = raw.sku || raw.SKU || raw.seller_sku || raw.sellerSku || raw.custom_sku || '';
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
  const accountKey = String(cuenta || '').toLowerCase().replace(/\s+/g, '').includes('top') ? 'topshop' : 'tlc';
  const webhook = PUBLICATIONS_EDIT_WEBHOOKS[accountKey];
  if (!webhook) throw new Error('No hay webhook de edicion configurado para ' + accountKey);

  const r = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let text = '';
  let data = null;
  try { text = await r.text(); } catch {}
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!r.ok) {
    const msg = data?.error?.message || data?.message || text || ('n8n edit status ' + r.status);
    throw new Error(msg);
  }

  if (data && data.ok === false) {
    throw new Error(data.message || data.error || 'n8n devolvio ok=false al editar');
  }

  // n8n puede responder HTTP 200 aunque Mercado Libre haya devuelto error,
  // porque el nodo HTTP usa ignoreResponseCode. No marcamos exito en esos casos.
  const status = Number(data?.status || data?.statusCode || data?.raw?.status || 0);
  if (data && (data.error || status >= 400 || data.raw?.error)) {
    throw new Error(data.message || data.error || data.raw?.message || data.raw?.error || 'Mercado Libre rechazo la modificacion');
  }

  return data || { ok: true };
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

function publicationIdKey(cuenta, id) {
  return `${String(cuenta || '').toLowerCase().replace(/\s+/g,'').includes('top') ? 'topshop' : 'tlc'}::${String(id || '').trim()}`;
}

function linkIdFromPair(tlcId, topshopId) {
  return `${publicationIdKey('tlc', tlcId)}__${publicationIdKey('topshop', topshopId)}`;
}

function getManualLinkFor(cache, cuenta, id) {
  const links = cache.publicationLinks || {};
  const key = publicationIdKey(cuenta, id);
  for (const link of Object.values(links)) {
    if (!link || link.active === false) continue;
    if (publicationIdKey('tlc', link.tlcId) === key || publicationIdKey('topshop', link.topshopId) === key) {
      return link;
    }
  }
  return null;
}

function buildLinkedPublications(cache) {
  const rows = [];
  const links = cache.publicationLinks || {};
  const tlcById = new Map((cache.tlc || []).map(item => [String(item.id || item.mlu || ''), item]));
  const topById = new Map((cache.topshop || []).map(item => [String(item.id || item.mlu || ''), item]));

  for (const link of Object.values(links)) {
    if (!link || link.active === false) continue;
    const tlc = tlcById.get(String(link.tlcId || '')) || null;
    const topshop = topById.get(String(link.topshopId || '')) || null;
    const sku = link.sku || tlc?.sku || topshop?.sku || '';
    const supplier = sku ? (cache.supplierLinks[String(sku).toUpperCase()] || {}) : {};
    rows.push({
      tlc,
      topshop,
      sku,
      linked: true,
      linkId: link.id || linkIdFromPair(link.tlcId, link.topshopId),
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
  const links = Object.values(cache.publicationLinks || {}).filter(link => link && link.active !== false);
  const tlcById = new Map((cache.tlc || []).map(item => [String(item.id || item.mlu || ''), item]));
  const topById = new Map((cache.topshop || []).map(item => [String(item.id || item.mlu || ''), item]));
  const results = [];
  let okCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const link of links) {
    const tlcId = String(link.tlcId || '').trim();
    const topshopId = String(link.topshopId || '').trim();
    const tlcItem = tlcById.get(tlcId);
    const topItem = topById.get(topshopId);
    if (!tlcItem || !topItem) {
      skippedCount++;
      results.push({ ok: false, skipped: true, tlcId, topshopId, message: 'No se encontro TLC o TOP SHOP en el cache actual.' });
      continue;
    }
    const stockMaster = Number(tlcItem.stock ?? tlcItem.available_quantity ?? 0);
    const stockTopShop = Number(topItem.stock ?? topItem.available_quantity ?? 0);
    const priceMaster = Number(tlcItem.price ?? 0);
    const priceTopShop = Number(topItem.price ?? 0);
    const currencyMaster = String(tlcItem.currency_id || tlcItem.currency || 'UYU').trim() || 'UYU';
    const currencyTopShop = String(topItem.currency_id || topItem.currency || 'UYU').trim() || 'UYU';
    if (!Number.isFinite(stockMaster) || !Number.isFinite(priceMaster) || priceMaster <= 0) {
      skippedCount++;
      results.push({ ok: false, skipped: true, tlcId, topshopId, message: 'Stock o precio maestro TLC invalido.' });
      continue;
    }
    const needsStock = stockMaster !== stockTopShop;
    const needsPrice = priceMaster !== priceTopShop;
    const needsCurrency = currencyMaster !== currencyTopShop;
    if (!needsStock && !needsPrice && !needsCurrency) {
      skippedCount++;
      results.push({ ok: true, skipped: true, tlcId, topshopId, stock: stockMaster, price: priceMaster, currency_id: currencyMaster, message: 'Ya estaba sincronizado.' });
      continue;
    }
    const payload = { id: topshopId, mlu: topshopId, source: options.source || 'sync_linked_values_tlc_master', tlcMasterId: tlcId };
    if (needsStock) { payload.stock = stockMaster; payload.available_quantity = stockMaster; }
    if (needsPrice) payload.price = priceMaster;
    if (needsCurrency) payload.currency_id = currencyMaster;
    try {
      let meli;
      try {
        meli = await updatePublicationOnMeli('topshop', payload);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if ((payload.currency_id || payload.stock !== undefined) && payload.price !== undefined && /has_bids|Cannot update item|cannot update item|currency|moneda/i.test(msg)) {
          meli = await updatePublicationOnMeli('topshop', { id: topshopId, mlu: topshopId, price: priceMaster, source: 'sync_linked_values_price_fallback', tlcMasterId: tlcId });
          meli = { ...(meli || {}), ok: true, partial: true, warning: 'Mercado Libre rechazo stock/moneda. Se reintento solo precio.' };
        } else {
          throw err;
        }
      }
      if (!meli || !meli.partial) {
        if (needsStock) { topItem.stock = stockMaster; topItem.available_quantity = stockMaster; }
        if (needsCurrency) topItem.currency_id = currencyMaster;
      }
      if (needsPrice) topItem.price = priceMaster;
      topItem.lastLinkedSyncFromTlc = new Date().toISOString();
      okCount++;
      results.push({ ok: true, partial: !!(meli && meli.partial), warning: meli && meli.warning, tlcId, topshopId, stock: stockMaster, price: priceMaster, currency_id: currencyMaster });
    } catch (e) {
      errorCount++;
      results.push({ ok: false, tlcId, topshopId, message: e.message });
    }
  }
  cache.lastAutoLinkedSyncAt = new Date().toISOString();
  if (!options.silent || okCount || errorCount) {
    cache.movements.push({
      id: crypto.randomBytes(8).toString('hex'),
      at: new Date().toISOString(),
      type: options.source || 'sync_linked_values',
      message: `Vinculados sincronizados desde TLC: ${okCount} ok, ${skippedCount} sin cambios, ${errorCount} errores.`,
      user: username,
    });
  }
  savePublicationsCache(cache);
  return { ok: errorCount === 0, okCount, skippedCount, errorCount, results, message: `Vinculados sincronizados desde TLC: ${okCount} ok, ${skippedCount} sin cambios, ${errorCount} errores.` };
}

let AUTO_LINKED_SYNC_RUNNING = false;
async function runAutoLinkedSync() {
  if (AUTO_LINKED_SYNC_RUNNING) return;
  AUTO_LINKED_SYNC_RUNNING = true;
  try {
    const cache = loadPublicationsCache();
    const count = Object.values(cache.publicationLinks || {}).filter(link => link && link.active !== false).length;
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
  const session = validateSession(getCookieToken(req));

  // ───────────────────────────────────────────────
  //  RUTAS PÚBLICAS (sin login)
  // ───────────────────────────────────────────────

  // PING
  if (pathName === '/api/ping') {
    jsonResp(res, 200, { ok: true });
    return;
  }

  // LOGIN
  if (req.method === 'POST' && pathName === '/api/login') {
    (async () => {
      const body = await readBody(req);
      const { username, password } = body;
      const user = checkPassword(username, password);
      if (!user) {
        jsonResp(res, 401, { error: 'Usuario o contraseña incorrectos' });
        return;
      }
      const token = createSession(user);
      audit({ username: user.username, name: user.name, role: user.role }, 'login', { ok: true });
      jsonResp(res, 200, {
        ok: true,
        user: publicUser(user),
      }, {
        'Set-Cookie': `auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*24*60*60}`,
      });
    })();
    return;
  }

  // LOGOUT
  if (req.method === 'POST' && pathName === '/api/logout') {
    const token = getCookieToken(req);
    if (session) audit(session, 'logout', {});
    if (token) SESSIONS.delete(token);
    jsonResp(res, 200, { ok: true }, {
      'Set-Cookie': 'auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    });
    return;
  }

  // CHECK SESIÓN ACTUAL
  if (pathName === '/api/me') {
    if (!session) { jsonResp(res, 401, { error: 'No autenticado' }); return; }
    jsonResp(res, 200, { user: session });
    return;
  }

  // Permitir login.html sin sesión
  if (pathName === '/login.html' || pathName === '/login') {
    serveStatic(res, 'login.html');
    return;
  }

  // ───────────────────────────────────────────────
  //  TODO LO DE ABAJO REQUIERE LOGIN
  // ───────────────────────────────────────────────
  if (!session) {
    // Si pide HTML o es la raíz → redirigir a login
    if (pathName === '/' || pathName.endsWith('.html')) {
      res.writeHead(302, { 'Location': '/login.html' });
      res.end();
      return;
    }
    // Si pide API → 401
    jsonResp(res, 401, { error: 'No autenticado' });
    return;
  }


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
                const items = await fetchAllPublicationsFromN8n(cuenta, {});
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
              message: errors.length ? 'Sincronizacion parcial: una o mas cuentas no respondieron desde n8n.' : 'Publicaciones sincronizadas desde n8n.',
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


          if (postAction === 'link_publications') {
            const tlcId = String(body.tlcId || body.tlc || '').trim();
            const topshopId = String(body.topshopId || body.topshop || '').trim();
            if (!tlcId || !topshopId) { jsonResp(res, 400, { error: 'Falta tlcId o topshopId' }); return; }
            const tlcItem = (cache.tlc || []).find(x => String(x.id || x.mlu || '') === tlcId);
            const topItem = (cache.topshop || []).find(x => String(x.id || x.mlu || '') === topshopId);
            if (!tlcItem || !topItem) { jsonResp(res, 404, { error: 'No se encontro una de las publicaciones para vincular' }); return; }
            const linkId = linkIdFromPair(tlcId, topshopId);
            cache.publicationLinks[linkId] = {
              id: linkId,
              tlcId,
              topshopId,
              sku: String(body.sku || tlcItem.sku || topItem.sku || '').trim(),
              active: true,
              createdAt: cache.publicationLinks[linkId]?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              updatedBy: session.username,
            };
            cache.movements.push({
              id: crypto.randomBytes(8).toString('hex'),
              at: new Date().toISOString(),
              type: 'link_publications',
              sku: cache.publicationLinks[linkId].sku,
              message: `Se vincularon ${tlcId} y ${topshopId}.`,
              user: session.username,
            });
            savePublicationsCache(cache);
            audit(session, 'publications_link', { tlcId, topshopId });
            jsonResp(res, 200, { ok: true, link: cache.publicationLinks[linkId], publications: buildFlatPublications(cache), linked: buildLinkedPublications(cache) });
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
            jsonResp(res, 200, { ok: true, item: cache.localEdits[key], meli: meliResult });
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
  const autoMs = Number(process.env.PUBLICATIONS_LINKED_AUTO_SYNC_MS || 300000);
  if (autoMs > 0) setInterval(runAutoLinkedSync, autoMs);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TELOCONSIGO + TOP SHOP — Panel v4 (con login)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  ✓ Servidor activo: http://localhost:${PORT}`);
  console.log(`  ✓ TELOCONSIGO:     ${WEBHOOKS.tlc}`);
  console.log(`  ✓ ADS TOP SHOP:    ${WEBHOOKS.topshop}`);
  console.log(`  ✓ INBOX TLC:       ${INBOX_WEBHOOKS.tlc}`);
  console.log(`  ✓ INBOX TOP SHOP:  ${INBOX_WEBHOOKS.topshop}`);
  console.log(`  ✓ PUB TLC:         ${PUBLICATIONS_WEBHOOKS.tlc}`);
  console.log(`  ✓ PUB TOP SHOP:    ${PUBLICATIONS_WEBHOOKS.topshop}`);
  console.log('');
  console.log('  Abrí http://localhost:8080 en Chrome');
  console.log('');
  console.log('  Para detener: Ctrl+C');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
