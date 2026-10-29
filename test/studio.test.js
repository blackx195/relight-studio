import test from 'node:test';
import assert from 'node:assert/strict';
import { gridLayout, DEFAULT_LAYOUT, lightPosition, normalizedLights, shuffle, snapshotRecipe, unwrapMcp, creationId } from '../src/core.js';
import { parseRpcText } from '../src/magnific.js';
import { processItem, runPool } from '../src/pipeline.js';

const items = Array.from({ length: 7 }, (_, i) => ({ id: i, width: 200 + i * 50, height: 400 - i * 20 }));
test('grid never drops overflow images and increases rows', () => { const g = gridLayout(items, DEFAULT_LAYOUT); assert.equal(g.slots.length, 7); assert.equal(g.rows, 3); assert.equal(g.expanded, true); });
test('portrait / landscape images preserve aspect ratio and remain in cells', () => { const g = gridLayout(items, { ...DEFAULT_LAYOUT, width: 900, height: 1600 }); g.slots.forEach((r, i) => { assert.ok(Math.abs(r.width / r.height - items[i].width / items[i].height) < 1e-8); assert.ok(r.x >= r.cell.x); assert.ok(r.y >= r.cell.y); assert.ok(r.x + r.width <= r.cell.x + r.cell.width + 1e-6); assert.ok(r.y + r.height <= r.cell.y + r.cell.height + 1e-6); }); });
test('extreme spacing is clamped without negative dimensions', () => { const g = gridLayout(items, { ...DEFAULT_LAYOUT, width: 100, height: 100, columns: 4, gapX: 2000, gapY: 2000, padding: 500 }); for (const r of g.slots) { assert.ok(r.width > 0); assert.ok(r.height > 0); } });
test('X/Y position offset is applied in canvas pixels', () => { const a = gridLayout(items, DEFAULT_LAYOUT).slots[0], b = gridLayout(items, { ...DEFAULT_LAYOUT, offsetX: -30, offsetY: 80 }).slots[0]; assert.ok(Math.abs(b.x - a.x + 30) < 1e-8); assert.ok(Math.abs(b.y - a.y - 80) < 1e-8); });
test('axis convention: front +Z, right +X, top +Y', () => { assert.deepEqual(lightPosition({ azimuth: 0, elevation: 0 }, 1), [0, 0, 1]); assert.ok(Math.abs(lightPosition({ azimuth: 90, elevation: 0 }, 1)[0] - 1) < 1e-8); assert.ok(Math.abs(lightPosition({ azimuth: 0, elevation: 90 }, 1)[1] - 1) < 1e-8); });
test('UI 270° maps to API -90° and neutral light omits gel color', () => { const lights = normalizedLights([{ azimuth: 270, elevation: -90, intensity: 10, type: 'neutral', color: '#ffffff' }]); assert.deepEqual(lights[0], { azimuth: -90, elevation: -90, intensity: 10, type: 'neutral' }); });
test('batch recipe does not change when controls change', () => { const lights = [{ azimuth: 45, elevation: 30, intensity: 5, type: 'gel', color: '#ffaa55' }]; const recipe = snapshotRecipe(lights, '2k', 'project'); lights[0].intensity = 9; assert.equal(recipe.lights[0].intensity, 5); assert.equal(recipe.folderReference, 'project'); });
test('shuffle is a permutation without mutating input', () => { const result = shuffle(items, () => 0); assert.notDeepEqual(result, items); assert.equal(items[0].id, 0); assert.deepEqual(result.map(x => x.id).sort(), items.map(x => x.id).sort()); });
test('structured and text MCP results and errors are handled', () => { assert.deepEqual(unwrapMcp({ structuredContent: { ok: 1 } }), { ok: 1 }); assert.deepEqual(unwrapMcp({ content: [{ type: 'text', text: '{"ok":2}' }] }), { ok: 2 }); assert.throws(() => unwrapMcp({ isError: true, content: [{ type: 'text', text: 'out of credits' }] }), /out of credits/); assert.equal(creationId({ creations: [{ identifier: 'abc' }] }), 'abc'); });
test('SSE parser picks the matching response and accepts CRLF', () => { const stream = 'event: message\r\ndata: {"jsonrpc":"2.0","method":"ping"}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":42,"result":{"ok":true}}\r\n\r\n'; assert.equal(parseRpcText(stream, 42).result.ok, true); });
test('pipeline uploads original then relights then removes background, with fixed recipe', async () => {
  const calls = [], checkpoints = [], item = { original: new Blob(['original']), recipe: null };
  const recipe = { lights: [{ azimuth: 20, elevation: 30, intensity: 5, type: 'neutral' }], resolution: '2k', folderReference: 'folder' };
  const client = { upload: async (file, folder) => { assert.equal(file, item.original); assert.equal(folder, 'folder'); return 'source'; }, call: async (tool, args) => { calls.push([tool, args]); return { creation: { identifier: tool === 'images_relight' ? 'relit' : 'cutout' } }; }, waitFor: async id => 'https://example.com/' + id, download: async () => new Blob(['result'], { type: 'image/png' }) };
  await processItem(item, recipe, client, async () => checkpoints.push({ relight: item.relightId, cutout: item.cutoutId, uncertain: item.uncertain }), () => {});
  assert.equal(calls[0][1].creationIdentifier, 'source'); assert.equal(calls[1][1].creationIdentifier, 'relit'); assert.equal(calls[1][1].folderReference, 'folder'); assert.ok(checkpoints.some(c => c.relight === 'relit' && !c.uncertain)); assert.equal(item.output.type, 'image/png');
});
test('resume reuses task IDs and does not repeat paid operations', async () => {
  let submitted = 0; const item = { sourceId: 'source', relightId: 'relit', cutoutId: 'cutout', recipe: { lights: [] } };
  await processItem(item, {}, { call: async () => { submitted++; }, waitFor: async id => 'https://example.com/' + id, download: async () => new Blob(['result']) }, async () => {}, () => {});
  assert.equal(submitted, 0);
});
test('ambiguous paid submission is checkpointed rather than silently retried', async () => {
  const item = { sourceId: 'source', recipe: { lights: [] } }; let submissions = 0;
  await assert.rejects(() => processItem(item, {}, { call: async () => { submissions++; throw new Error('network'); } }, async () => {}, () => {}), /network/);
  assert.equal(submissions, 1); assert.equal(item.uncertain, 'relight');
});
test('bounded concurrency and one failure do not block other images', async () => {
  let active = 0, maximum = 0;
  const results = await runPool([1, 2, 3, 4], 2, async id => { maximum = Math.max(maximum, ++active); await new Promise(r => setTimeout(r, 5)); active--; if (id === 2) throw new Error('one failure'); return id; });
  assert.equal(maximum, 2); assert.equal(results[1].status, 'rejected'); assert.equal(results[3].value, 4);
});
test('stop leaves unstarted images untouched', async () => { let stop = false, count = 0; const result = await runPool([1, 2, 3], 1, async id => { count++; stop = true; return id; }, () => stop); assert.equal(count, 1); assert.equal(result.length, 1); });
