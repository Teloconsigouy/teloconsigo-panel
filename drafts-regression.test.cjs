const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Execute the real storage functions only; never start the server or contact MeLi.
const sourcePath = process.env.DRAFT_SOURCE || path.join(__dirname, 'start.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('function defaultPublicadorDrafts() {');
const end = source.indexOf('\nfunction decodeHtmlEntities(', start);
assert.ok(start >= 0 && end > start, 'storage functions found in server source');

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meli-drafts-test-'));
  const file = path.join(dir, 'drafts.json');
  const ctx = vm.createContext({ fs, PUBLICADOR_DRAFTS_FILE: file, ensureDataDir() {} });
  vm.runInContext(source.slice(start, end), ctx);
  try { run(ctx); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

for (const count of [0, 1, 299, 300, 301]) {
  test(`prepare, reload and update with ${count} existing drafts`, () => withStore(ctx => {
    const old = Array.from({ length: count }, (_, i) => ({ id: `old-${i}`, status: 'preview' }));
    ctx.savePublicadorDrafts({ drafts: old });
    const data = ctx.loadPublicadorDrafts();
    const draft = { id: 'new-lona', status: 'preview', sku: '1857-0 PM' };
    data.drafts.unshift(draft);
    ctx.savePublicadorDrafts(data);
    // prepare_publication saves again after computing requirements.
    draft.requiredMissing = [];
    ctx.savePublicadorDrafts(data);
    const loaded = ctx.loadPublicadorDrafts();
    assert.equal(loaded.drafts[0]?.id, draft.id, 'new draft remains recoverable');
    assert.equal(loaded.drafts.length, Math.min(count + 1, 300));
    assert.deepEqual(Array.from(loaded.drafts.slice(1), d => d.id), old.slice(0, 299).map(d => d.id));
    const found = loaded.drafts.find(d => d.id === draft.id);
    found.price = 1690;
    found.accounts = ['topshop'];
    ctx.savePublicadorDrafts(loaded);
    const persisted = ctx.loadPublicadorDrafts().drafts.find(d => d.id === draft.id);
    assert.equal(persisted.price, 1690);
    assert.deepEqual(Array.from(persisted.accounts), ['topshop']);
  }));
}

test('retained publication results survive subsequent saves', () => withStore(ctx => {
  const published = { id: 'published-draft', status: 'published', publishResults: [{ cuenta: 'topshop', ok: true, itemId: 'MLU-TEST' }] };
  const drafts = [published, ...Array.from({ length: 299 }, (_, i) => ({ id: `old-${i}` }))];
  ctx.savePublicadorDrafts({ drafts });
  const data = ctx.loadPublicadorDrafts();
  data.drafts.unshift({ id: 'another-new-draft', status: 'preview' });
  ctx.savePublicadorDrafts(data);
  const loaded = ctx.loadPublicadorDrafts().drafts.find(d => d.id === published.id);
  assert.equal(loaded.status, 'published');
  assert.equal(loaded.publishResults[0].itemId, 'MLU-TEST');
}));
