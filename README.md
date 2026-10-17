# 🎄 Frostvale: a Christmas open-world web game

> A cozy, low-poly open-world Christmas game that runs in the browser with **three.js**. Explore a snowy village and forest, find **6 Christmas mini-games** hidden around the world, win a golden ornament from each, and use all six to light the Great Tree on Christmas Eve.

| | |
|---|---|
| **Genre** | Cozy open-world / mini-game collection |
| **Perspective** | 3rd-person, orbit-follow camera |
| **Platform** | Web browser, **mobile-first** (phones in portrait or landscape), also desktop with mouse/keyboard or gamepad |
| **Rendering** | three.js (WebGL 2) |
| **Language / tooling** | TypeScript + Vite |
| **Physics** | Rapier (`@dimforge/rapier3d-compat`, WASM) |
| **Art style** | KayKit low-poly, one gradient-atlas texture per pack |
| **Target release** | Before 24 December 2026 |
| **Working title** | *Frostvale* (rename freely) |

---

## ✅ Current status

| Area | State |
|---|---|
| Vite + TS + three.js + Rapier project | ✅ |
| All 10 asset packs imported (`public/assets/`) | ✅ glTF straight from the zips (not optimised yet) |
| **Mobile-first controls**: floating joystick, drag-to-look, jump/map/pause buttons, tappable "▶ Play" prompt, big thumb-side action button and ✕ quit in mini-games | ✅ |
| Portrait **and** landscape: every camera reframes on rotate; safe-area (notch) padding; phone-sized HUD | ✅ |
| Installable: web manifest + icons; "Add to Home Screen" launches full-screen (also on iPhone); fullscreen on Android | ✅ |
| Graphics presets (Fast / Balanced / Pretty) in the pause menu; phones default to Balanced | ✅ |
| Player: KayKit *Rogue (Hooded)* + idle/walk/run/jump/cheer clips on a Rapier kinematic capsule | ✅ |
| Orbit-follow camera (pointer lock or touch drag, wheel zoom, pulls in when something blocks the view) | ✅ |
| 450 m snowy world (Poly Haven *Snow 02* texture), frozen lake, rim of hills | ✅ |
| **Village street plan**: cobblestone Main Street, Market Lane, Mill Lane and outer lanes, lanterns, signposts at every crossroads, roads on the map | ✅ |
| "How to play" steps on every mini-game intro card | ✅ |
| Footprints in the snow behind the player (fade after ~1 min) | ✅ |
| Wind: trees and bushes sway, each with its own phase | ✅ |
| Camera pulls back when running and swings back behind you after you stop dragging it | ✅ |
| `?stats` performance overlay (FPS / CPU / GPU) for testing on real devices | ✅ |
| Instanced, snow-covered forest (~880 trees/rocks/bushes) placed from seeded JSON rules | ✅ |
| Town square, village street, train station, workshop, cellar entrance, game parlour | ✅ first-pass dressing |
| Snowfall, zone beacons, lantern glow + pooled point lights | ✅ |
| Game zones, discovery, "Press E", intro and results cards, map (M), pause (Esc) | ✅ |
| Save to `localStorage` (ornaments, stars, discovered zones, position) | ✅ |
| Great Tree ornaments + fireworks finale | ✅ basic version |
| **Game 1: Snowball Showdown** | ✅ playable |
| **Game 2: Cookie Catch** (drag the bowl, catch treats) — replaced the Bakery Rush after playtesting | ✅ playable |
| **Game 3: Santa's Express** (5 solver-checked levels) | ✅ playable |
| **Game 4: Elf Workshop** (memorise blueprints, 9 toys) | ✅ playable |
| **Game 5: Krampus' Cellar** (tap-to-walk stealth, guided) — simplified after playtesting | ✅ playable |
| **Game 6: Advent Dice Race** (physics dice vs. 3 AI elves) | ✅ playable |
| Staging deploys to CloudPanel on every push to `staging` | ✅ |
| Audio, GLB/KTX2 optimisation | ⏳ |

Run it with `npm install && npm run dev`, then open http://localhost:5173. To try it on your phone, run `npm run dev -- --host` and open the printed network address on a phone on the same Wi-Fi.

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
- **Mobile first**: designed for a phone held in either orientation and played with thumbs. Everything also works with mouse/keyboard and gamepad, but no feature may require them.

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

A village-sized map (450 × 450 m) laid out like a real village:
- **Main Street** runs north–south through the Great Tree plaza.
- **Market Lane** and **Mill Lane** cross it.
- **Outer lanes** close the grid into loops.

Gingerbread houses line the streets. Every game sits at the end of a street, and cobblestones, lanterns and signposts at each crossroads lead the way.

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

Roads are Catmull-Rom curves through a few control points (`roads` in the JSON). `src/world/Roads.ts` turns them into a draped cobblestone mesh (procedural texture), lanterns every ~28 m, and signposts. The signposts use one texture atlas, so all of them cost two draw calls. `tools/layout-world.py` regenerates the street plan, the village houses and the zone positions, and checks that nothing sits on a road.

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

### 2. 🍪 Cookie Catch (*Village bakery*), ✅ playable
*Replaced "Gingerbread Bakery Rush", which playtesters found confusing. It keeps the same zone and save id (`gingerbread-bakery`).*
**Type:** one-finger catch game (60 seconds)
Treats rain down from the bakery: drag anywhere (or use ← →) to move the bowl.
- **Points:** 🍪 cookie / 🍬 candy cane +1 · 🧑‍🎄 gingerbread man +2 · 🎁 present +3.
- **Avoid:** ⚫ coal, −2.
- **Bonus:** a ✨ golden cookie pulls every treat into the bowl for 3 s.
- **Pace:** fall speed, spawn rate and the amount of coal ramp up gently.

**Assets:** Holiday Bits (cookie, candy cane, gingerbread man, present, gingerbread house, tree) · Restaurant Bits (bowl, tinted wicker) · Resource Bits (stone chunks, tinted as coal)
**Stars:** 15 / 35 / 55 points

### 3. 🚂 Santa's Express (*Toy Train Station*), ✅ playable
**Type:** track-switching puzzle (5 levels)
Presents must reach the right houses. Tap the glowing track pieces to turn them, then send the toy train; each present in the queue must reach the house of its colour. Wrong houses, derailments and loops count as mishaps.
**Assets:** Holiday Bits (locomotive, empty tender carrying the present, wagon, `tracks_straight/curve/crossing/straight_station`, decorated gingerbread houses, presents in 5 colours)
**Tech:** pure grid logic in `logic.ts` (no physics). Levels are text grids in `levels.ts`, and `npm run check-levels` brute-forces each one to prove it is solvable and compute its par (fewest taps). The train follows a polyline of straight segments and quarter arcs traced through the tiles. In portrait the camera views the board from the station's side, so the board runs up the screen.
**Stars:** each level scores 3 (no mishaps, at or under par), 2 (≤1 mishap, ≤ par + 4) or 1; game stars at 5 / 10 / 14 of 15

### 4. 🔨 Elf Workshop (*Pine Forest edge*), ✅ playable
**Type:** crafting / memory (9 blueprints, 2½-minute shift)
A blueprint flashes up with a toy's parts and the one tool it needs. Memorise it, tap the parts on the bench (tap a tray chip to undo), then tap 🔨 Build. Blueprints grow from 3 to 5 items and show for less time as the shift goes on. Built toys pile up as presents on the shelf.
**Assets:** Resource Bits (wood, stone, iron, copper, gold, textiles) · RPG Tools Bits (hammer, saw, wrench, anvil, lantern) · Dungeon (workbench, banners, walls) · Holiday presents
**Tech:** the blueprint is an HTML card with a countdown; parts are world-pinned labels, so they're thumb-sized on a phone.
**Stars:** toys built, at 3 / 6 / 9.

### 5. 🕯️ Krampus' Cellar (*under the old mill*), ✅ playable
*Simplified after playtesting.*
**Type:** guided stealth maze (2½-minute limit)
Tap a floor tile and your hooded hero walks there.
- **Guidance:** ✨ glowing dots and a bobbing arrow lead to the next chest, then to the stairs. Three one-time tips explain tapping, the red lantern light, and chests.
- **Guards:** 2 slow guards. Their lanterns light up to 3 tiles ahead, drawn in red. They stand still for the first 4 s.
- **Getting spotted:** costs 3 s and a short freeze, then you hop back to the last tile outside the light. No restart.
- **Goal:** rescue 4 presents and escape for a speed bonus of up to +2. 🗺️ Overview shows the whole cellar.

**Assets:** Dungeon Pack (floors, low walls, chests, stairs, torches, props) · Adventurers (Rogue player, red-tinted Barbarian guards, with walk/idle clips)
**Stars:** 2 / 4 / 6

### 6. 🎲 Advent Dice Race (*Game Parlour*), ✅ playable
**Type:** board game vs. 3 AI elves (2–4 minutes)
Race Jingle, Tinsel and Sprinkle round a 24-door advent track. 🎁 squares give 2 bonus steps, 🍬 candy canes roll again, ❄️ snow drifts make you miss a turn. First to door 23 wins.
**Assets:** Board Game Bits (coloured `D6_A` dice, `pawn_B` pawns, coloured tiles) · Holiday Bits (presents, snowball piles, candy canes, trees as square markers and decoration)
**Tech:** each roll is a real Rapier rigid body thrown into the board's centre; once it rests, the face is read from which local axis points up (KayKit D6: +X=2, −X=5, +Y=6, −Y=1, +Z=3, −Z=4)
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
| `textures/snow/` | Poly Haven [Snow 02](https://polyhaven.com/a/snow_02), 1K | Diffuse (brightened), Normal (GL), packed AO/Rough/Metal, converted to WebP (≈ 475 KB total) | Ground in the world and all mini-games |

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
| Input | Pointer Events (mouse + touch in one path), keyboard, Gamepad API, on-screen controls | One `Input` module mapped to actions |
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
npm run check-levels  # prove every Santa's Express level is solvable, print par
```

Add `?stats` to the URL (e.g. `http://192.168.1.20:5173/?stats` on your phone) for a live FPS / CPU / GPU overlay. It's lazy-loaded, so normal players never download it.

A debug handle is exposed as `window.frostvale` (`engine`, `overworld`, `scenes`, `gameState`, `hud`, `input`). For example, `frostvale.scenes.enter('snowball-showdown')` jumps straight into a game, and `localStorage.clear()` resets progress.

---

## 📁 Project structure

```
├── index.html                  # <canvas> + HUD overlay root
├── vite.config.ts              # base: './' for sub-folder hosting
├── tools/
│   ├── build-manifest.mjs      # lists model ids
│   └── check-levels.mjs        # Santa's Express solver check
├── public/
│   ├── manifest.webmanifest    # installable web app (Add to Home Screen)
│   ├── icons/                  # app icons rendered from the game's tree model
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
    │   ├── Lighting.ts         # sun, hemisphere, fog, sky dome
    │   └── SnowGround.ts       # textured snow material + world-space UVs
    ├── vfx/
    │   ├── Snowfall.ts         # camera-following GPU snow
    │   ├── SnowTrail.ts        # footprint ribbon behind the player
    │   ├── Beacon.ts           # zone sparkle column
    │   └── Burst.ts            # pooled particle bursts (puffs, sparkles, fireworks)
    ├── shaders/snow.ts         # onBeforeCompile patch: snow on upward faces + wind sway
    ├── minigames/
    │   ├── MiniGame.ts         # contract + star helper
    │   ├── registry.ts         # titles, blurbs, thresholds, lazy factories
    │   ├── snowball-showdown/
    │   ├── gingerbread-bakery/
    │   ├── santas-express/     # logic.ts (pure puzzle rules), levels.ts, SantasExpress.ts
    │   ├── elf-workshop/
    │   ├── krampus-cellar/
    │   └── advent-dice-race/
    └── ui/
        ├── hud.ts              # loading, title, prompt, tracker, cards, map, action/quit buttons
        ├── touch.ts            # joystick, drag-to-look, jump/map/pause buttons
        ├── worldLabels.ts      # tappable HTML labels pinned to 3D positions
        └── styles.css          # mobile-first: phone styles are the base, desktop is the media query
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

Games report only a score; the scene manager turns it into stars using the thresholds in the registry. To add a game, implement the interface and add `create: async (ctx) => new (await import('./my-game/MyGame')).MyGame(ctx)` to its entry in `src/minigames/registry.ts`. The dynamic import keeps each game out of the initial download. The zone, intro card, quit button, results card, save and ornament all work automatically.

**Mobile rules for every mini-game:**
- Read taps through `input.pointer` + `input.justPressed('fire')` (mouse clicks arrive the same way).
- Put the main action on `hud.setAction(...)`, the big thumb-side button, rather than a key.
- Reframe the camera when `camera.aspect` changes, so portrait and landscape both work.
- Never require hover, right-click, or a key with no on-screen equivalent.

### Game zones

A zone is a beacon VFX plus a circular trigger. With only six round zones, a distance check each frame is simpler and cheaper than a Rapier sensor plus event queue.

### Game state & saving

Stored as JSON under `localStorage["frostvale.save.v1"]` (see `src/core/Save.ts`): ornaments, best stars, best score, discovered zones, player position, finale flag and settings. Reads and writes are wrapped in try/catch, since private browsing can block storage.

### Collisions

Visual meshes are never used for physics: tree trunks and lanterns get cylinders, other props get boxes sized from the model's bounding box, and the terrain is a trimesh built from the same heightmap as the visual. Invisible walls sit inside the hill rim as a safety net.

---

## 🌨️ Snow ground, footprints, wind and camera

Some ideas here are adapted from Bruno Simon's portfolio devlog (infinite grass, wheel tracks, camera, monitoring), sized for a phone-first WebGL game.

- **Ground texture:** Poly Haven *Snow 02* at 1K, using three maps: diffuse, GL normal, and packed AO/Rough/Metal. Three.js reads AO from the red channel and roughness from the green, so one file does both. UVs come from world x/z, so one repeat is 4 m on any mesh. Beyond ~6 m a second sample at ~5× scale is blended in, which hides the grid-like repeat. The terrain's vertex colours still tint it, so trodden paths and blue shading survive.
- **Footprints:**
  - **Idea (from the video's wheel tracks):** keep a fixed-size history of contact points and turn it into a ribbon.
  - **How:** the last ~220 samples (one every 0.36 m) are drawn straight onto the terrain as one textured strip. The texture holds a left and a right boot print, and alpha fades each print out after ~45 s.
  - **Jumps:** the trail breaks at take-off and landing, so the strip doesn't bridge the gap.
  - **Why not the video's way:** it renders tracks into a ground render target. That costs an extra render pass every frame; drawing on the terrain is one small draw call.
- **Wind:** the snow shader patch bends vertices by the square of their height, so trunks stay put and crowns move. The phase comes from each instance's position, so the forest doesn't sway in lockstep. Strength is set per scatter rule (`"sway"` in `frostvale.json`).
- **Camera:**
  - **Swing-back:** after 1.2 s without manual look, the camera swings back behind the player, faster the faster they move.
  - **Run pull-back:** it backs off 2.5 m while running.
  - **Not adopted:** the video's speed lines, which don't suit a cozy game.
- **Monitoring:** `stats-gl`, the stats library from the video, behind `?stats`.
- **Not adopted, and why:**
  - **TSL / WebGPU:** WebGPU is still patchy on phones, and our `onBeforeCompile` patches already run everywhere on WebGL.
  - **250k-blade infinite grass:** wrong biome, and too heavy for the phone budget. The same follow-and-wrap trick could do frosty tufts later.

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

**Graphics presets** (pause menu; phones default to *Balanced*, desktops to *Pretty*):

| Preset | Max pixel ratio | Sun shadow map | Snow particles | Forest density |
|---|---|---|---|---|
| Fast | 1 | off | 2,500 | 50% |
| Balanced | 1.5 | 1024 (smaller area) | 3,500 | 75% |
| Pretty | 2 | 2048 (+ forest shadows) | 7,000 | 100% |

**Already in place:**
- `InstancedMesh` for every repeated model. Trees use a 3×3 chunk grid, and spread-out props (houses, lanterns) use 120 m cells, so off-screen chunks, and chunks outside the shadow box, are skipped.
- After playtesting, the world was made lighter. The forest is about 5× less dense, uses lighter tree models and only casts shadows on Pretty. Rocks, bushes and road lanterns never cast shadows, and lantern halos are a single particle cloud. On Balanced, the plaza view went from ~600k triangles / 153 draw calls to ~350k / 119 (headless measurement), in a world 2.25× the area.
- Fog hides the far edge.
- Only 4 real `PointLight`s, reassigned to the nearest lanterns each frame.
- Game time pauses when the tab is hidden.
- Each mini-game is lazy-loaded (8–15 kB of code each).

**Still to do:** the main bundle is ~1.8 MB gzipped, mostly Rapier's inlined WASM.

---

## 🎮 Controls

| Action | Touch (primary) | Keyboard & mouse | Gamepad |
|---|---|---|---|
| Move | Left thumb: floating joystick anywhere on the left side | W A S D / arrows | Left stick |
| Run | Push the joystick to its edge | Shift | LB / L1 |
| Camera | Right thumb: drag anywhere on the right side | Mouse (click to lock pointer), wheel to zoom | Right stick |
| Jump | ⤒ button | Space | A / Cross |
| Play a game | Tap the **▶ Play** prompt | E or Enter | X / Square |
| Map | 🗺️ button (tap to close) | M | Select / Back |
| Pause / settings | ⏸ button | Esc or P | Start |
| Leave a mini-game | ✕ button (asks first) | Esc (asks first) | Start |

**In mini-games:**
- **Snowball Showdown:** tap where the snowball should land; hold and drag to keep throwing.
- **Santa's Express:** tap the glowing tracks, then 🚂 Go!
- **Advent Dice Race:** tap 🎲 Roll.
- **Haptics:** hits, deliveries and rolls give a short buzz on phones that support it (Android).

---

## 🌐 Deployment

The build output (`dist/`) is a fully static site, and `base: './'` makes it work from a sub-folder. It includes a web app manifest, so phones can **Add to Home Screen** and launch full-screen. That's the only way to hide Safari's bars on iPhone; Android also goes fullscreen when you press Start.

- **CloudPanel (automatic)**: `.github/workflows/deploy.yml` builds on every PR and deploys every push to the `staging` branch to the CloudPanel staging site over SSH/rsync. One-time setup (site, SSH key, GitHub secrets, nginx caching) is in [`deploy/CLOUDPANEL.md`](deploy/CLOUDPANEL.md).
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
| ~~4~~ | 9–15 Nov | ~~Game 6 (Advent Dice Race) + Game 3 (Santa's Express)~~ ✅ + **mobile-first pass** (pulled forward from week 8) ✅ |
| ~~5~~ | 16–22 Nov | ~~Game 2 (Gingerbread Bakery Rush)~~ ✅ (pulled forward) |
| ~~6~~ | 23–29 Nov | ~~Game 4 (Elf Workshop) + Game 5 (Krampus' Cellar)~~ ✅ (pulled forward) |
| 7 | 30 Nov–6 Dec | Asset optimisation (GLB), VFX polish, audio, finale cutscene |
| 8 | 7–13 Dec | Real-device testing (iPhone Safari, Android Chrome, iPad), perf tuning on a mid-range phone, Firefox/desktop Safari |
| 9 | 14–20 Dec | Bug fixing, itch.io page, final deploy: **release ~20 Dec** |

**Cut list if time runs short:** cut bloom → reduce Santa's Express to 3 levels → make Krampus' Cellar a single room. Touch controls are **not** on the cut list: the game is mobile-first.

---

## 📜 Licensing & credits

| Asset | Author | License |
|---|---|---|
| KayKit Holiday Bits, Forest Nature Pack, Dungeon Pack, Restaurant Bits, RPG Tools Bits, Resource Bits, Board Game Bits, Adventurers, Character Animations | Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com), [itch.io](https://kaylousberg.itch.io)) | CC0 1.0. Credit not required but appreciated. License files are in each `public/assets/models/<pack>/` folder. |
| Snow 02 texture | Rob Tuytel — [Poly Haven](https://polyhaven.com/a/snow_02) | CC0 (see `public/assets/textures/snow/LICENSE.txt`) |
| stats-gl | Renaud Rohlinger | MIT |
| Brackeys' VFX Bundle | Repackaged by Brackeys. Particles by [Picster](https://github.com/RPicster/Godot-particle-and-vfx-textures) and [Kenney](https://kenney.nl/assets/particle-pack); flipbooks by Thomas Iché; pre-drawn sheets by [CodeManu](https://codemanu.itch.io/vfx-free-pack) | CC0 (see `public/assets/textures/vfx/LICENSE.txt`) |
| Fredoka font | Milena Brandão, Hafontia | SIL Open Font License |
| three.js, Rapier, Vite | Respective authors | MIT / Apache-2.0 |
| Game code | _Your name / company_ | _Choose: MIT, proprietary, etc._ |

KayKit asks that you don't resell unmodified copies of the assets or claim them as your own. Shipping them inside a game is fine. A web game serves its model files publicly, which is normal and allowed for CC0 assets.

---

*Made with ❄️ and ☕ for Christmas 2026 by 3logiq 😛*
