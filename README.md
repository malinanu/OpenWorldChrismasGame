# 🎄 Frostvale: a Christmas open-world web game

> A cozy, low-poly open-world Christmas game that runs in the browser with **three.js**. Explore a snowy village and forest, find **6 Christmas mini-games** hidden around the world, win a golden ornament from each, and use all six to light the Great Tree on Christmas Eve.

| | |
|---|---|
| **Genre** | Cozy open-world / mini-game collection |
| **Perspective** | 3rd-person, orbit-follow camera |
| **Platform** | Web browser (desktop first, mobile-friendly) |
| **Rendering** | three.js (WebGL 2) |
| **Language / tooling** | TypeScript + Vite |
| **Physics** | Rapier (`@dimforge/rapier3d-compat`, WASM) |
| **Art style** | KayKit low-poly, one gradient-atlas texture per pack |
| **Target release** | Before 24 December 2026 |
| **Working title** | *Frostvale* (rename freely) |

---

## ✅ Current status (vertical slice)

| Area | State |
|---|---|
| Vite + TS + three.js + Rapier project | ✅ |
| All 10 asset packs imported (`public/assets/`) | ✅ glTF straight from the zips (not optimised yet) |
| Player: KayKit *Rogue (Hooded)* + idle/walk/run/jump/cheer clips on a Rapier kinematic capsule | ✅ |
| Orbit-follow camera (pointer lock, wheel zoom, pulls in when something blocks the view) | ✅ |
| Snowy heightmap terrain, trodden paths, frozen lake, rim of hills | ✅ |
| Instanced, snow-covered forest (~880 trees/rocks/bushes) placed from seeded JSON rules | ✅ |
| Town square, village street, train station, workshop, cellar entrance, game parlour | ✅ first-pass dressing |
| Snowfall, zone beacons, lantern glow + pooled point lights | ✅ |
| Game zones, discovery, "Press E", intro and results cards, map (M), pause (Esc) | ✅ |
| Save to `localStorage` (ornaments, stars, discovered zones, position) | ✅ |
| Great Tree ornaments + fireworks finale | ✅ basic version |
| **Game 1: Snowball Showdown** | ✅ playable |
| Games 2–6 | ⏳ zones exist and say "coming soon" |
| Audio, touch controls, settings menu, GLB/KTX2 optimisation | ⏳ |

Run it with `npm install && npm run dev`, then open http://localhost:5173.

---

## 📑 Table of contents

1. [Game concept](#-game-concept)
2. [Core gameplay loop](#-core-gameplay-loop)
3. [The world map](#️-the-world-map)
4. [The 6 Christmas mini-games](#-the-6-christmas-mini-games)
5. [Asset inventory](#-asset-inventory)
6. [Still missing](#️-still-missing)
7. [Tech stack](#️-tech-stack)
8. [Getting started](#-getting-started)
9. [Project structure](#-project-structure)
10. [Technical architecture](#-technical-architecture)
11. [Asset pipeline](#-asset-pipeline)
12. [VFX with the Brackeys bundle](#-vfx-with-the-brackeys-bundle)
13. [Performance budget](#-performance-budget)
14. [Controls](#-controls)
15. [Deployment](#-deployment)
16. [Roadmap to Christmas](#-roadmap-to-christmas)
17. [Licensing & credits](#-licensing--credits)

---

## 🎅 Game concept

The village of **Frostvale** has lost its Christmas spirit. The six golden ornaments that light the **Great Tree** in the town square have been scattered, and a festive challenge somewhere in the world guards each one.

The player arrives by toy train, explores freely, finds each challenge, plays it, and earns its ornament. When all six are hung on the tree, the village lights up for a fireworks-and-snow finale.

**Design pillars**

- **Explore, don't grind**: no combat or fail states in the overworld. Walking around should feel good on its own.
- **Bite-sized games**: each mini-game takes 1–4 minutes and can be replayed for a better star rating.
- **One coherent look**: every model comes from KayKit, so the whole world shares one palette and scale.
- **Instant to play**: opens from a link, loads in seconds, no install.

---

## 🔁 Core gameplay loop

```
 ┌──────────────────────────────────────────────────────────┐
 │  EXPLORE world  →  SPOT a glowing game zone (VFX beacon)  │
 │        ↑                          ↓                       │
 │  RETURN to world          WALK INTO trigger zone          │
 │  (same spot)               "Press E to play"              │
 │        ↑                          ↓                       │
 │  EARN ornament + stars  ←  PLAY mini-game (1–4 min)       │
 └──────────────────────────────────────────────────────────┘
           6 ornaments collected  →  Great Tree finale
```

**Progression**

- Each mini-game awards **1–3 stars** based on score. 1 star earns the ornament.
- Total stars (max 18) unlock cosmetic rewards: hats, a sled, extra snow effects.
- A **map overlay** shows discovered zones; undiscovered ones appear only as a sparkle.
- Progress is saved to `localStorage` after every mini-game (and the player's position every few seconds).

---

## 🗺️ The world map

A compact, hand-built map (300 × 300 units) with six zones around a central hub, so every game is under a minute's walk away. Keeping it small also keeps the download light.

```
                 [3] Toy Train Station (0, -70)
                        │
   [5] Krampus'   ──  Pine Forest  ──  [4] Elf Workshop
       Cellar (-49,-37)  │                 (48,-36)
                    ★ TOWN SQUARE ★
                    (Great Tree hub,
                     spawn point)
                         │
   [2] Gingerbread ── Village Street ── [6] Game Parlour
       Bakery (-48,32)   │                 (48,32)
                 [1] Snowball Field
                   (frozen lake, 0,60)
```

| Zone | Look & feel | Built from |
|---|---|---|
| **Town Square (hub)** | Giant decorated tree, lanterns, presents, snowmen, stools | Holiday Bits |
| **Village Street** | Gingerbread houses along trodden paths, lanterns | Holiday Bits (`gingerbread_house`, `gingerbread_house_decorated`) |
| **Pine Forest** | Snow-covered trees, rocks, bushes | Forest Nature Pack + snow shader |
| **Frozen Lake** | Flat icy area with snowmen | Holiday Bits + ice material |
| **Train Station** | Track line with locomotive, tenders and wagon | Holiday Bits toy train + tracks |

The level layout lives in **`public/world/frostvale.json`**: explicit props (model id + positions, rotation, scale, collider type, snow amount, light colour) plus **scatter rules** (models, count, ring radius, clearance from zones and paths, seed) for the forest. You can edit the world without touching code. Run `npm run manifest` to list every model id.

---

## 🎁 The 6 Christmas mini-games

Each mini-game uses assets you already have, so no extra modelling is needed.

### 1. ❄️ Snowball Showdown (*Frozen Lake*), ✅ playable
**Type:** target shooter (60 seconds)
Snowmen pop up across the frozen lake. Aim the **snowball cannon** with the mouse and knock them down before time runs out. Golden snowmen are worth 3 points; hitting a present costs 2.
**Assets:** Holiday Bits (snowball cannon, snowballs, snowball piles, snowmen, presents), Forest (backdrop), Brackeys VFX (snow puff, sparkle)
**Tech:** Rapier rigid-body snowballs on a ballistic arc to the cursor's raycast hit, pooled particle bursts
**Stars:** 1★ 10 pts · 2★ 20 pts · 3★ 30 pts

### 2. 🍪 Gingerbread Bakery Rush (*Village Street*)
**Type:** cooking / order fulfilment (3 minutes)
Customers order cookies, hot chocolate and treats. Grab ingredients, prepare them at stations (chop → mix → bake), plate them and serve before the order timer runs out.
**Assets:** Restaurant Bits (kitchen counters, stoves, ovens, food in raw/cooked/chopped states, plates) · Holiday Bits (cookie, gingerbread man, milk, hot chocolate, candy cane, decorated plates)
**Tech:** fixed top-down camera, click-to-interact via `Raycaster`, model swap per food state
**Stars:** based on orders served and tips earned

### 3. 🚂 Santa's Express (*Toy Train Station*)
**Type:** track-switching puzzle (5 levels)
Presents must reach the right houses. Rotate track pieces and flip switches so the toy train delivers each colour of present to the matching chimney.
**Assets:** Holiday Bits (locomotive, tenders, wagon, `tracks_straight/curve/crossing/split_left/split_right`, presents in 5 colours)
**Tech:** grid-based logic (no physics); the train follows a `CatmullRomCurve3` built from the solved path
**Stars:** based on moves used and delivery time

### 4. 🔨 Elf Workshop (*Pine Forest edge*)
**Type:** crafting / memory (3 rounds)
A blueprint flashes on the workbench showing a toy recipe (e.g. 2 wood + 1 iron + 1 fabric). Pick the right materials and tools from memory and assemble the toy before the shift bell.
**Assets:** RPG Tools Bits (hammer, saw, wrenches, anvil, blueprint, lantern) · Resource Bits (wood, stone, iron, copper, gold, textiles) · `Hammering` / `Sawing` clips from Character Animations
**Tech:** click-to-pick, HTML overlay for the recipe card
**Stars:** based on correct toys built

### 5. 🕯️ Krampus' Cellar (*under the old mill*)
**Type:** short dungeon maze / stealth (2–4 minutes)
Krampus has stolen a sack of presents and hidden it below ground. Navigate a small maze, avoid spike traps and patrolling lantern light, open chests to collect presents, and escape.
**Assets:** Dungeon Pack (walls, floors, stairs, doors, chests, barrels, `floor_tile_big_spikes`, banners, torches) · Brackeys VFX (fire flipbook, smoke, glow)
**Tech:** reuses the player controller; patrol "vision cone" = angle + distance check plus a raycast for line of sight
**Stars:** based on presents collected and escape time

### 6. 🎲 Advent Dice Race (*Game Parlour*)
**Type:** board game vs. 3 AI elves (5 minutes)
A Christmas board game on a table. Roll dice and move your pawn along a 24-square advent track; squares give bonus moves, gifts, or "snow drifts" (lose a turn). First to square 24 wins.
**Assets:** Board Game Bits (D6/D8/D20 dice, pawns, meeples, tokens, coins, flags, tiles) · Holiday Bits (presents and candy as decoration)
**Tech:** physics dice roll in Rapier; read the top face from the die's final rotation
**Stars:** 1st place = 3★ · 2nd = 2★ · 3rd = 1★

---

## 📦 Asset inventory

All ten packs are imported. Only the `.gltf`/`.glb` files (plus their `.bin` buffers and atlas `.png`) are kept, under `public/assets/models/<pack>/`. The original zips are not committed.

| Folder | Source zip | What's in it (free tier) | Used for |
|---|---|---|---|
| `holiday/` | `KayKit_Holiday_Bits_1.0_FREE` | 98 models: presents A–F + spheres in 5 colours, Christmas tree (plain/lights/decorated + base), toy train (locomotive, tenders, wagon) and 6 track pieces, snowmen, snowball, snowball pile, snowball cannon, **gingerbread houses** (plain/decorated), gingerbread man, cookie, milk, hot chocolate, candy cane, lanterns, wreath, mistletoe, bells, plates, chairs, footstools, carpets | **Core theme**: hub, village, games 1, 2, 3 |
| `forest/` | `KayKit_Forest_Nature_Pack_1.0_FREE` | 105 models: trees (4 kinds + bare), bushes, rocks, grass | Pine forest, world dressing |
| `dungeon/` | `KayKit_Dungeon_Pack_1.1_FREE` | 211 models: walls, floors, stairs, doors, chests, barrels, tables, crates, spike tiles, banners, torches, candles | Game 5, workshop, parlour, cellar entrance |
| `restaurant/` | `KayKit_Restaurant_Bits_1.0_FREE` | 144 models: kitchen counters, stoves, ovens, fridges, food by ingredient and state (raw/cooked/chopped), plates, crates | Game 2 |
| `rpg_tools/` | `KayKit_RPGToolsBits_1.0_FREE` | 49 models: hammer, saw, axe, pickaxe, wrenches, mallet, anvil, lantern, torches, blueprint, maps | Game 4 |
| `resources/` | `KayKit_ResourceBits_1.0_FREE` | 76 models: wood, stone, iron, copper, silver, gold, textiles, fuel, pallets | Game 4, world props |
| `boardgame/` | `KayKit_BoardGameBits_1.0_FREE` | 162 models: dice (D4–D20), pawns, meeples, tokens, coins, flags, tiles, dominoes, player cards | Game 6 |
| `characters/` | `KayKit_Adventurers_2.0_FREE` | Barbarian, Knight, Mage, Ranger, Rogue, Rogue (Hooded), rigged on `Rig_Medium` | Player (Rogue Hooded), future NPCs |
| `animations/` | `KayKit_Character_Animations_1.1` | `Rig_Medium` clips: MovementBasic, General, Simulation, Tools | Player + NPC animation |
| `textures/vfx/` | `brackeys_vfx_bundle` | 7 hand-picked textures, resized (see [VFX](#-vfx-with-the-brackeys-bundle)) | Snow, sparkles, glow, puffs, fire |

> **Corrections to the original plan:** the free Holiday Bits zip has whole gingerbread **houses**, not modular gingerbread walls/floors. The village uses those houses. Of the Character Animations, `CombatMelee`, `CombatRanged`, `Special` and `MovementAdvanced` were left out to save ~3.6 MB; add them back from the zip if a game needs them.

---

## ⚠️ Still missing

| Need | Recommended source | Notes |
|---|---|---|
| **Music & SFX** | CC0 sources (Kenney audio packs, freesound.org with the CC0 filter) | Ship as `.ogg` with an `.mp3` fallback |
| **UI font** | Fredoka (OFL) | Loaded from Google Fonts for now; self-host as `.woff2` before release |
| **NPCs (elves, villagers, Krampus)** | Reuse the Adventurers with tinted materials + Holiday Bits props on the `handslot.l/r` bones | Keeps the download small |

The snow ground is generated in code (heightmap + vertex colours), so no terrain asset is needed.

---

## 🛠️ Tech stack

| Concern | Choice | Why |
|---|---|---|
| Renderer | **three.js** (`WebGLRenderer`) | Mature, huge ecosystem, native glTF support |
| Language | **TypeScript** | Safer refactors across 6 mini-games |
| Build / dev server | **Vite** | Instant HMR, static output, handles WASM and asset hashing |
| Model loading | `GLTFLoader` (later + `MeshoptDecoder` / `KTX2Loader`) | Compressed meshes and GPU textures once optimised |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | Fast WASM physics: character controller, dice, snowballs |
| Character controller | Rapier `KinematicCharacterController` | Handles slopes, steps, sliding along walls |
| Animation | `THREE.AnimationMixer` | Idle / walk / run / jump / cheer cross-fades |
| Audio | `THREE.AudioListener` + `PositionalAudio` (or Howler.js) | 3D-positioned chimney crackle, train whistle |
| UI / HUD | Plain HTML + CSS overlay above the canvas | Easy to style, accessible, no extra library |
| Input | Keyboard/mouse + Gamepad API (touch joystick later) | One `Input` module mapped to actions |
| Save | `localStorage` (JSON) | No backend required |
| Asset optimisation | **glTF-Transform** CLI | Merge, dedupe, compress to `.glb` |

---

## 🚀 Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + static site in dist/
npm run preview    # serve the production build locally
npm run manifest   # list every model id → public/assets/models/manifest.json
```

A debug handle is exposed as `window.frostvale` (`engine`, `overworld`, `scenes`, `gameState`, `hud`). For example, `frostvale.scenes.enter('snowball-showdown')` jumps straight into a game, and `localStorage.clear()` resets progress.

---

## 📁 Project structure

```
├── index.html                  # <canvas> + HUD overlay root
├── vite.config.ts              # base: './' for sub-folder hosting
├── tools/build-manifest.mjs    # lists model ids
├── public/
│   ├── assets/
│   │   ├── models/<pack>/      # KayKit glTF + .bin + atlas png (one folder per zip)
│   │   └── textures/vfx/       # selected Brackeys textures
│   └── world/frostvale.json    # world placement data
└── src/
    ├── main.ts                 # bootstrap: physics init, loading, title, loop
    ├── core/
    │   ├── Engine.ts           # renderer, resize, quality, render loop
    │   ├── SceneManager.ts     # world ↔ mini-game switching
    │   ├── AssetLoader.ts      # cached GLTF/texture loading + progress
    │   ├── Physics.ts          # Rapier init + fixed-step world wrapper
    │   ├── Input.ts            # actions: move, look, jump, interact, fire…
    │   ├── EventBus.ts         # tiny typed pub/sub
    │   └── Save.ts             # localStorage persistence
    ├── game/
    │   ├── Overworld.ts        # world + player + camera + zones + finale
    │   ├── GameState.ts        # ornaments, stars, discovered zones
    │   ├── Player.ts           # character + controller + animation
    │   ├── FollowCamera.ts
    │   └── GameZone.ts         # trigger area + beacon for each mini-game
    ├── world/
    │   ├── World.ts            # builds world from frostvale.json
    │   ├── Terrain.ts          # heightmap, paths, lake, trimesh collider
    │   ├── Instancing.ts       # InstancedMesh per model
    │   └── Lighting.ts         # sun, hemisphere, fog, sky dome
    ├── vfx/
    │   ├── Snowfall.ts         # camera-following GPU snow
    │   ├── Beacon.ts           # zone sparkle column
    │   └── Burst.ts            # pooled particle bursts (puffs, sparkles, fireworks)
    ├── shaders/snow.ts         # onBeforeCompile snow-on-top patch
    ├── minigames/
    │   ├── MiniGame.ts         # contract + star helper
    │   ├── registry.ts         # titles, blurbs, thresholds, factories
    │   └── snowball-showdown/
    └── ui/
        ├── hud.ts              # loading, title, prompt, tracker, cards, map
        └── styles.css
```

---

## 🧩 Technical architecture

### Scene flow

One `WebGLRenderer` and one canvas for the whole game. The **world scene stays in memory** while a mini-game runs, so returning is instant and the player reappears exactly where they left.

```
Title card → World ──(enter zone + press E → intro card)──► MiniGame (own THREE.Scene + camera)
                ▲                                                  │
                └──── results card → resume world, cheer ◄─────────┘
```

### Mini-game contract

Every mini-game implements the same interface (`src/minigames/MiniGame.ts`), so the world never needs to know how a game works internally:

```ts
export interface MiniGame {
  readonly id: MiniGameId;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  load(): Promise<void>;     // load assets, build the scene
  start(): void;             // reset and begin a round
  update(dt: number): void;
  dispose(): void;           // free what the game created (shared models stay cached)
  quit(): void;              // Esc: ends the round with 0 stars
  readonly finished: Promise<MiniGameResult>;
}
```

To add a game, implement the interface and add `create: (ctx) => new MyGame(ctx)` to its entry in `src/minigames/registry.ts`. The zone, intro card, results card, save and ornament all work automatically.

### Game zones

A zone is a beacon VFX plus a circular trigger. With only six round zones, a distance check each frame is simpler and cheaper than a Rapier sensor plus event queue.

### Game state & saving

Stored as JSON under `localStorage["frostvale.save.v1"]` (see `src/core/Save.ts`): ornaments, best stars, best score, discovered zones, player position, finale flag and settings. Reads and writes are wrapped in try/catch, since private browsing can block storage.

### Collisions

Visual meshes are never used for physics: tree trunks and lanterns get cylinders, other props get boxes sized from the model's bounding box, and the terrain is a trimesh built from the same heightmap as the visual. Invisible walls sit inside the hill rim as a safety net.

---

## 🔄 Asset pipeline

Today the game loads the KayKit `.gltf` files straight from `public/assets/models/`, which works fine for development. Before release:

1. **Optimise** with glTF-Transform:
   ```bash
   gltf-transform optimize in.gltf out.glb --compress meshopt --texture-compress webp
   ```
2. **Bundle by zone, not by file**: pack the models a zone needs into one `.glb` (e.g. `village.glb`) to cut HTTP requests, and pull meshes out by node name at runtime.
3. **Materials**: KayKit imports as `MeshStandardMaterial`. One material instance per atlas lets meshes batch well.
4. **Snow**: `src/shaders/snow.ts` patches `MeshStandardMaterial` via `onBeforeCompile` to blend towards white where the world-space normal faces up. Each prop in the world JSON has a `snow` amount from 0 to 1.
5. **Loading**: `AssetLoader` caches by URL and reports progress to the loading screen. Mini-games load lazily when entered.

---

## ✨ VFX with the Brackeys bundle

Seven textures were picked from the 73 MB bundle and resized (≈ 550 KB total):

| File | From | Used for |
|---|---|---|
| `snowflake.png` (64²) | `particles/alpha/circle_05_a` | Falling snow (`Snowfall.ts`, one `THREE.Points`, wraps around the camera) |
| `sparkle.png` (128²) | `particles/alpha/star_06_a` | Zone beacons, golden-snowman hits, fireworks |
| `glow.png` (128²) | `particles/alpha/light_03_a` | Lantern halos, beacon glow |
| `smoke.png` (128²) | `particles/alpha/smoke_04_a` | Snow puffs on impact |
| `spark.png` (128²) | `particles/alpha/spark_02_a` | Spare |
| `fire_8x8.png` (512²) | `flipbooks/fire_01_8x8` | Torch / fire flipbook (Game 5) |
| `star_explosion_6x5.png` | `predrawn/star_explosion_6x5` | Results / finale burst (to wire up) |

**Planned:** chimney smoke, flipbook torches, confetti on the results screen, and optional `UnrealBloomPass` on the "high" quality setting.

---

## 📊 Performance budget

| Metric | Target |
|---|---|
| Initial download (to playable world) | < 15 MB |
| Each mini-game (lazy-loaded) | < 3 MB |
| Draw calls (world) | < 150 |
| Triangles on screen | < 300k |
| Frame rate | 60 fps desktop · 30+ fps mid-range mobile |
| Shadow-casting lights | 1 (the sun) |

**Already in place:** `InstancedMesh` for every repeated model · fog hides the far edge · pixel ratio capped by a quality setting (low/medium/high) · only 4 real `PointLight`s, reassigned to the nearest lanterns each frame · game time pauses when the tab is hidden.
**Still to do:** the JS bundle is ~1.8 MB gzipped (mostly Rapier's inlined WASM). Lazy-load each mini-game with `import()`.

---

## 🎮 Controls

| Action | Keyboard & mouse | Gamepad |
|---|---|---|
| Move | W A S D / arrows | Left stick |
| Camera | Mouse (click to lock pointer), wheel to zoom | Right stick |
| Sprint | Shift | LB / L1 |
| Jump | Space | A / Cross |
| Interact / play | E or Enter | X / Square |
| Map | M | Select / Back |
| Pause / quit mini-game | Esc or P | Start |

Snowball Showdown: move the mouse to aim, click (or hold) to throw. Touch controls are planned for week 8.

---

## 🌐 Deployment

The build output (`dist/`) is a fully static site, and `base: './'` makes it work from a sub-folder.

- **itch.io**: zip `dist/` and upload it as an HTML5 game.
- **Cloudflare Pages / GitHub Pages / any static host**: deploy `dist/` and serve `.gltf`, `.bin` and `.png` with long-cache headers.

---

## 📅 Roadmap to Christmas

It's mid-October 2026, so there are about **9 weeks** left. Weeks 1–3 are done in this first slice.

| Week | Dates (2026) | Milestone |
|---|---|---|
| ~~1~~ | 19–25 Oct | ~~Vite + TS + three.js setup, Rapier, player + follow camera, character + animations~~ ✅ |
| ~~2~~ | 26 Oct–1 Nov | ~~Terrain + snow shader, world JSON loader, instanced forest, town square, snowfall, loading screen~~ ✅ |
| ~~3~~ | 2–8 Nov | ~~`GameZone`, `SceneManager`, `GameState` + save, HUD, **Game 1**~~ ✅ (first deploy still to do) |
| 4 | 9–15 Nov | Game 6 (Advent Dice Race) + Game 3 (Santa's Express) |
| 5 | 16–22 Nov | Game 2 (Gingerbread Bakery Rush) |
| 6 | 23–29 Nov | Game 4 (Elf Workshop) + Game 5 (Krampus' Cellar) |
| 7 | 30 Nov–6 Dec | Asset optimisation (GLB), VFX polish, audio, finale cutscene |
| 8 | 7–13 Dec | Touch controls, settings menu, browser testing (Chrome, Firefox, Safari), perf tuning |
| 9 | 14–20 Dec | Bug fixing, itch.io page, final deploy: **release ~20 Dec** |

**Cut list if time runs short:** drop touch controls (desktop-only) → cut bloom → reduce Santa's Express to 3 levels → make Krampus' Cellar a single room.

---

## 📜 Licensing & credits

| Asset | Author | License |
|---|---|---|
| KayKit Holiday Bits, Forest Nature Pack, Dungeon Pack, Restaurant Bits, RPG Tools Bits, Resource Bits, Board Game Bits, Adventurers, Character Animations | Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com), [itch.io](https://kaylousberg.itch.io)) | CC0 1.0. Credit not required but appreciated. License files are in each `public/assets/models/<pack>/` folder. |
| Brackeys' VFX Bundle | Repackaged by Brackeys. Particles by [Picster](https://github.com/RPicster/Godot-particle-and-vfx-textures) and [Kenney](https://kenney.nl/assets/particle-pack); flipbooks by Thomas Iché; pre-drawn sheets by [CodeManu](https://codemanu.itch.io/vfx-free-pack) | CC0 (see `public/assets/textures/vfx/LICENSE.txt`) |
| Fredoka font | Milena Brandão, Hafontia | SIL Open Font License |
| three.js, Rapier, Vite | Respective authors | MIT / Apache-2.0 |
| Game code | _Your name / company_ | _Choose: MIT, proprietary, etc._ |

KayKit asks that you don't resell unmodified copies of the assets or claim them as your own. Shipping them inside a game is fine. A web game serves its model files publicly, which is normal and allowed for CC0 assets.

---

*Made with ❄️ and ☕ for Christmas 2026 by 3logiq 😛*
