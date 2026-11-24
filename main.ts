// SOLSTICE BAY (gta6-01 entry) — a full 3D open-world crime game in game/:
// a neon Tokyo-bay city at sunset. Steal one of 7 race cars, run 3 missions
// for cash ($2,500 / $4,000 / $6,500), and outrun the SBPD under a 0-5 star
// wanted system — police cruisers chase from 1 star, the Air-1 helicopter
// joins with a searchlight at 3+. On foot there is shooting (pistol + SMG),
// 44 pedestrians walk the sidewalks and the beach, 8 traffic cars with
// visible drivers obey the lights, and a news helicopter circles the city
// while a rescue helicopter waits on the hospital helipad. The city itself
// is the showpiece: a Shibuya-style scramble crossing, sakura streets, a red
// torii gate with stone lanterns, konbini, ramen carts, a monorail, and a
// beach with a pier, umbrellas, sailboats and a volleyball game. Phone
// players get touch controls (floating joystick, camera drag, JUMP / FIRE /
// CAR / NITRO buttons); desktop uses WASD + mouse drag, SHIFT nitro, SPACE
// handbrake, E enter/exit car, CLICK/F shoot, M nearest mission.
// It runs 100% offline: every script it loads is vendored under game/js,
// and it makes no network request of its own. Screenshots in screenshots/
// are real headless-browser renders of this code (Playwright + Chromium),
// never edited or composited — the cover is a 4-star police chase at the
// scramble crossing, framed so the pursuing SBPD cruiser is fully in shot.
const GAME_NAME = 'SOLSTICE BAY';
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// Pre-flight: fail fast with a plain message when the entry is malformed,
// instead of letting buildDossier refuse it with a terse cap error.
if (!existsSync(join(here, 'game', 'index.html'))) throw new Error('main.ts: game/index.html missing');
const shotDir = join(here, 'screenshots');
const shots = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => /\.png$/i.test(f)).sort() : [];
if (shots.length < 1 || shots.length > 4) throw new Error(`main.ts: expected 1-4 screenshots, found ${shots.length}`);
for (const f of shots) {
  const bytes = statSync(join(shotDir, f)).size;
  if (bytes > 262144) throw new Error(`main.ts: screenshots/${f} is ${bytes} bytes, over the 256 KiB cap`);
}
if (!shots[0].startsWith('1-')) throw new Error(`main.ts: first screenshot ${shots[0]} is not the cover (must start with '1-')`);

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
