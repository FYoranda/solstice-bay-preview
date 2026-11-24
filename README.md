# SOLSTICE BAY — Preview

A 3D open-world crime game in the browser. Neon-lit Tokyo Bay at sunset — drive race cars, run, shoot, do missions, outrun the law.

**Play it here:** https://fyoranda.github.io/solstice-bay-preview/

100% offline — no CDN, no external assets. Three.js is vendored in `js/three.min.js`.

## How to play

| Action | Keyboard | Touch (phone) |
|---|---|---|
| Move / drive | W A S D | Left joystick (up = gas, down = brake/reverse, left/right = steer) |
| Run | hold Shift (on foot) | — |
| Jump / handbrake | Space | JUMP button |
| Nitro | hold Shift (in car) | NITRO button |
| Shoot | F or click | FIRE button |
| Enter / exit car | E | CAR button |
| Unstick (teleport to road) | X | — |
| Camera | drag mouse | drag on screen / CAM button |
| Start mission | M | MISSION button |
| Pause | P / Esc | — |

## Features

- Open city: 5×5 Tokyo blocks, Shibuya-style scramble crossing, neon signs + billboards, sakura streets, torii + paper lanterns, konbini, ramen cart, monorail, beach + pier, ocean, sunset sky
- 7 race cars (steal any parked car): low/wide bodies, spoilers, racing stripes, big rims, dual exhausts — arcade physics with drift + nitro
- 3 multi-stage missions with timers and rewards ($2,500 / $4,000 / $6,500)
- Wanted system 0–5 stars: police race interceptors chase + ram, detailed SBPD helicopter with searchlight at 3+ stars, a news helicopter circling the city, a rescue heli parked on a rooftop helipad, BUSTED if they catch you
- Weapons: pistol (∞) + SMG pickup, tracers, muzzle flash
- Traffic + pedestrians who flee, cash/health/SMG pickups
- Money, health, armour, minimap, day clock, save in localStorage
- Full touch controls for phone

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```
