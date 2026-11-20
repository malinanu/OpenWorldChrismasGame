/**
 * Builds animations/Frostvale_Combat.glb: the melee, guard, hit-reaction and knock-down clips
 * used by the boxing ring and the sword arena. It is loaded only when someone fights, so the
 * start-up download stays small.
 *
 *   node tools/build-combat-clips.mjs <KayKit-Adventurers-1.0 Knight.glb>
 *
 * The clips come from KayKit's free Adventurers 1.0 pack (CC0). Its skeleton has the same bone
 * names and proportions as the Rig_Medium characters used here, so the clips are grafted onto
 * our rig by bone name (the pack's IK helper bones are skipped). Download the source with:
 *   https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb
 * Lie_StandUp comes from the Rig_Medium_Simulation pack already in the repo.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = 'public/assets/models/animations';
const OUT = join(ROOT, 'Frostvale_Combat.glb');
const KNIGHT = process.argv[2];
if (!KNIGHT) {
  console.error('Usage: node tools/build-combat-clips.mjs <path to KayKit Adventurers 1.0 Knight.glb>');
  process.exit(1);
}

/** Clip names in each source file. */
const CLIPS = {
  [KNIGHT]: [
    '1H_Melee_Attack_Slice_Diagonal',
    '1H_Melee_Attack_Stab',
    '1H_Melee_Attack_Chop',
    '2H_Melee_Attack_Chop',
    '2H_Melee_Attack_Slice',
    '2H_Melee_Attack_Stab',
    'Unarmed_Melee_Attack_Punch_A',
    'Unarmed_Melee_Attack_Punch_B',
    'Blocking',
    'Block_Hit',
    'Hit_A',
    'Hit_B',
    'Death_A',
    'Death_A_Pose',
    'Unarmed_Idle',
    '2H_Melee_Idle',
  ],
  [join(ROOT, 'Rig_Medium_Simulation.glb')]: ['Lie_StandUp'],
};

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const base = await io.read(join(ROOT, 'Rig_Medium_MovementBasic.glb'));
const root = base.getRoot();
for (const a of root.listAnimations()) a.dispose(); // keep our rig, none of its clips
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const copyAcc = (a) =>
  base.createAccessor(a.getName()).setType(a.getType()).setArray(a.getArray().slice()).setNormalized(a.getNormalized()).setBuffer(root.listBuffers()[0]);

const have = new Set();
for (const [file, wanted] of Object.entries(CLIPS)) {
  const src = await io.read(file);
  for (const anim of src.getRoot().listAnimations()) {
    const name = anim.getName();
    if (!wanted.includes(name) || have.has(name)) continue;
    have.add(name);
    const out = base.createAnimation(name);
    for (const ch of anim.listChannels()) {
      const target = byName.get(ch.getTargetNode()?.getName());
      if (!target) continue; // IK / control helper bones
      const s = ch.getSampler();
      const sampler = base.createAnimationSampler().setInput(copyAcc(s.getInput())).setOutput(copyAcc(s.getOutput())).setInterpolation(s.getInterpolation());
      out.addSampler(sampler).addChannel(base.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
  }
}
const missing = Object.values(CLIPS).flat().filter((n) => !have.has(n));
if (missing.length) throw new Error(`Clips not found: ${missing.join(', ')}`);
// Only the skeleton's node names matter to three.js; drop the preview mesh.
for (const node of root.listNodes()) {
  node.setMesh(null);
  node.setSkin(null);
}
await base.transform(prune(), resample({ tolerance: 1e-4 }), dedup());
base.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(OUT, base);
console.log(`clips: ${[...have].join(' ')}\n-> ${OUT} ${((await stat(OUT)).size / 1e3).toFixed(0)} KB`);
