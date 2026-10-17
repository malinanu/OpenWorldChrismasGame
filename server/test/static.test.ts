import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.ts';

// A fake build: the page, a fingerprinted bundle, a model and a dotfile.
const dir = mkdtempSync(join(tmpdir(), 'frostvale-static-'));
mkdirSync(join(dir, 'assets/models'), { recursive: true });
mkdirSync(join(dir, '.well-known'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Frostvale</title>' + ' '.repeat(2000));
writeFileSync(join(dir, 'assets/index-AbCdEf12.js'), 'console.log("game");'.repeat(200));
writeFileSync(join(dir, 'assets/models/tree.glb'), Buffer.alloc(64));
writeFileSync(join(dir, 'sw.js'), '// sw');
// Like the Rapier physics engine: gzipped at build time, unpacked by the game itself.
writeFileSync(join(dir, 'assets/rapier3d-0123abcd.wasm.bin'), gzipSync(Buffer.alloc(8000, 7)));
writeFileSync(join(dir, '.well-known/secret'), 'no');

let s: Awaited<ReturnType<typeof startServer>>;
before(async () => (s = await startServer({ STATIC_DIR: dir })));
after(async () => s.stop());

test('serves the game with the right caching, compression and types; API still wins', async () => {
  const page = await fetch(`${s.base}/`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Frostvale/);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal(page.headers.get('content-encoding'), 'gzip');

  const js = await fetch(`${s.base}/assets/index-AbCdEf12.js`);
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const glb = await fetch(`${s.base}/assets/models/tree.glb`);
  assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(glb.headers.get('cache-control'), 'public, max-age=86400');

  const wasm = await fetch(`${s.base}/assets/rapier3d-0123abcd.wasm.bin`, { headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(wasm.headers.get('content-encoding'), null, 'pre-gzipped files are sent as-is');
  assert.deepEqual(Buffer.from(await wasm.arrayBuffer()), gzipSync(Buffer.alloc(8000, 7)));

  assert.equal((await fetch(`${s.base}/sw.js`)).headers.get('cache-control'), 'no-cache');
  assert.notEqual((await fetch(`${s.base}/.well-known/secret`)).status, 200);
  assert.equal((await fetch(`${s.base}/nope.html`)).status, 404);
  assert.deepEqual(await (await fetch(`${s.base}/api/health`)).json(), { ok: true });
});
