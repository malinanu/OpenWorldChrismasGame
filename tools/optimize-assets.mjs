/**
 * Shrinks the 3D assets for faster loading (run once after adding/updating models:
 * `npm run optimize-assets`). Safe to re-run: compressed files are decoded and re-encoded.
 *
 * 1. Every .gltf / character .glb: vertex-cache reorder, normals/skin weights quantized, and
 *    EXT_meshopt_compression on all buffers (three.js decodes it with MeshoptDecoder).
 *    Positions and UVs stay float so geometry space (wind sway, UV atlases) is unchanged.
 * 2. animations/Frostvale_Clips.glb: only the clips the game plays, merged from the
 *    KayKit animation packs onto one rig, with redundant keyframes removed.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = 'public/assets/models';
const CLIPS = {
  'Rig_Medium_MovementBasic.glb': ['Idle_A', 'Walking_A', 'Walking_B', 'Running_A', 'Jump_Idle', 'Jump_Start', 'Jump_Land'],
  'Rig_Medium_General.glb': ['Idle_A', 'Cheering', 'Waving', 'Interact'],
  'Rig_Medium_Simulation.glb': ['Idle_A', 'Cheering', 'Waving', 'Interact'],
};
const CLIPS_OUT = 'animations/Frostvale_Clips.glb';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

async function compress(doc) {
  await doc.transform(
    dedup(),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ pattern: /^(NORMAL|TANGENT|JOINTS_\d+|WEIGHTS_\d+)$/, quantizeNormal: 8 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}

const size = async (f) => (await stat(f)).size;
let before = 0;
let after = 0;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// --- 1. Models ---------------------------------------------------------------
for await (const file of walk(ROOT)) {
  const isGltf = file.endsWith('.gltf');
  const isChar = file.endsWith('.glb') && file.includes('/characters/');
  if (!isGltf && !isChar) continue;
  const bin = isGltf ? file.replace(/\.gltf$/, '.bin') : null;
  const b0 = (await size(file)) + (bin ? await size(bin).catch(() => 0) : 0);
  const doc = await io.read(file);
  await compress(doc);
  if (isGltf) {
    // Keep the pack's shared texture as an external file so every model reuses one download.
    const { json, resources } = await io.writeJSON(doc);
    for (const [uri, data] of Object.entries(resources)) {
      if (uri.endsWith('.bin')) await writeFile(join(file, '..', uri), data);
    }
    await writeFile(file, JSON.stringify(json));
  } else {
    await io.write(file, doc);
  }
  const b1 = (await size(file)) + (bin ? await size(bin).catch(() => 0) : 0);
  before += b0;
  after += b1;
}
console.log(`models: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);

// --- 2. Animation clips --------------------------------------------------------
const base = await io.read(join(ROOT, 'animations/Rig_Medium_MovementBasic.glb'));
const root = base.getRoot();
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const have = new Set();
const copyAcc = (a) =>
  base.createAccessor(a.getName()).setType(a.getType()).setArray(a.getArray().slice()).setNormalized(a.getNormalized()).setBuffer(root.listBuffers()[0]);
for (const [pack, wanted] of Object.entries(CLIPS)) {
  const src = pack === 'Rig_Medium_MovementBasic.glb' ? base : await io.read(join(ROOT, 'animations', pack));
  for (const anim of src.getRoot().listAnimations()) {
    const name = anim.getName();
    if (!wanted.includes(name) || have.has(name)) continue;
    have.add(name);
    if (src === base) continue;
    const out = base.createAnimation(name);
    for (const ch of anim.listChannels()) {
      const target = byName.get(ch.getTargetNode()?.getName());
      if (!target) continue;
      const s = ch.getSampler();
      const sampler = base.createAnimationSampler().setInput(copyAcc(s.getInput())).setOutput(copyAcc(s.getOutput())).setInterpolation(s.getInterpolation());
      out.addSampler(sampler).addChannel(base.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
  }
}
for (const anim of root.listAnimations()) if (!have.has(anim.getName())) anim.dispose();
// Only the skeleton's node names matter to three.js; drop the preview mesh.
for (const node of root.listNodes()) {
  node.setMesh(null);
  node.setSkin(null);
}
await base.transform(prune(), resample({ tolerance: 1e-4 }), dedup());
base.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(join(ROOT, CLIPS_OUT), base);
console.log(`clips: ${[...have].join(' ')} -> ${CLIPS_OUT} ${((await size(join(ROOT, CLIPS_OUT))) / 1e3).toFixed(0)} KB`);
