# SOLSTICE BAY — 3D Open-World Crime

A sunset open-world crime game set in a neon Tokyo-bay city. Steal race cars,
run missions for cash, and outrun the SBPD — the whole city, from the Shibuya
scramble crossing to the beach pier, runs 100% offline in your browser.

## Play

Open `game/index.html` in a desktop browser (or play it live at
https://fyoranda.github.io/solstice-bay-preview/), then press **NEW GAME**.

| Key | Action |
| --- | --- |
| W A S D | Move / drive |
| Mouse drag | Camera |
| SHIFT | Run / nitro |
| SPACE | Jump / handbrake |
| E | Enter / exit car |
| CLICK / F | Shoot (1 pistol, 2 SMG, R reload) |
| M | Nearest mission · P / ESC pause · C camera · X unstick |

Phone players get touch controls: a floating joystick on the left half of the
screen, camera drag on the right, and JUMP / FIRE / CAR / NITRO buttons.

## The city

- **Shibuya-style scramble crossing**, sakura streets, a red torii gate with
  stone lanterns, konbini, ramen carts, a monorail, and a beach with a pier,
  umbrellas, sailboats, and a volleyball game.
- **7 race cars** (low bodies, spoilers, stripes) parked around the city,
  plus 8 traffic cars — every one with a visible driver — that obey traffic
  lights and turn at intersections.
- **44 pedestrians** who walk the sidewalks, sit, and play on the beach.
- **3 missions** ($2,500 / $4,000 / $6,500): pick up and deliver, steal the
  gold NEON COUPE, and a 3-checkpoint breakout that ends on the beach.
- **Wanted 0–5 stars**: police cars chase from 1 star; at 3+ stars the SBPD
  Air-1 helicopter joins with a searchlight. A news helicopter circles the
  city and a rescue helicopter sits on the hospital helipad.
- **HUD**: mission panel with timer and distance, money, clock, wanted
  stars, circular minimap, health/armour bars, speed, nitro, and ammo.

## Tech

- Three.js, vendored as `game/js/three.min.js` — no CDN, no network request,
  no build step. Open `game/index.html` and it plays.
- World, gameplay, and UI are plain scripts under `game/js/`
  (`world.js`, `game.js`, `ui.js`).
- Progress (money + cleared missions) is saved on the device.
- Debug helpers for automated checks live on `window.G`
  (`G.ready`, `G.debug.state()`, `G.debug.decor()`, `G.time`).

## Screenshots

All four PNGs in `screenshots/` are real renders of this game's own code in
a headless browser (Playwright + Chromium), captured while playing — never
edited, composited, or borrowed. `1-cover-police-chase.png` is the cover:
a 4-star police chase at golden hour with the SBPD helicopter overhead.

## Entry layout (gta6-01)

- `main.ts` — copies `game/` and `screenshots/` to the output and writes
  `dossier.json` (run: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`).
- `game/` — the playable game (`index.html` + `js/`).
- `screenshots/` — the 4 entry screenshots (first by name is the cover).
- `vendor/makefun-game.ts` — the make.fun dossier library, byte-for-byte
  from the starter kit.
- `shots.json` — the screenshot list for the entry.
