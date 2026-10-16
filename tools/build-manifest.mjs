// Lists every model id under public/assets/models so you can copy ids into
// public/world/frostvale.json. Usage: npm run manifest
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'public/assets/models';
const manifest = {};
for (const pack of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  manifest[pack.name] = readdirSync(join(root, pack.name))
    .filter((f) => f.endsWith('.gltf') || f.endsWith('.glb'))
    .map((f) => (f.endsWith('.gltf') ? f.slice(0, -5) : f))
    .sort();
}
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest).reduce((n, l) => n + l.length, 0);
console.log(`Wrote ${join(root, 'manifest.json')} — ${total} models in ${Object.keys(manifest).length} packs`);
