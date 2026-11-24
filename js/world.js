/* SOLSTICE BAY — world.js
   Procedural TOKYO-BAY sunset city: Shibuya-style scramble crossing,
   neon signs (katakana via canvas), sakura streets, torii + lanterns,
   konbini, ramen cart, monorail, beach + pier, skyline, gulls.
   All textures are generated on canvas — zero external assets. */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  G.THREE = THREE;

  // ---------------- city layout ----------------
  var BLOCK = 60, ROAD = 16, N = 5;                 // 5x5 blocks
  var CITY = N * BLOCK + (N + 1) * ROAD;            // 396
  var HALF = CITY / 2;                              // 198
  var WORLD = 460;                                  // ground plane size
  G.layout = { BLOCK: BLOCK, ROAD: ROAD, N: N, CITY: CITY, HALF: HALF, WORLD: WORLD };

  // road center lines (x or z coords of road centers)
  var roadCenters = [];
  for (var i = 0; i <= N; i++) roadCenters.push(-HALF + ROAD / 2 + i * (BLOCK + ROAD));
  G.roadCenters = roadCenters;
  function nearestRoad(v) {
    var best = roadCenters[0], bd = 1e9;
    for (var i = 0; i < roadCenters.length; i++) {
      var d = Math.abs(v - roadCenters[i]);
      if (d < bd) { bd = d; best = roadCenters[i]; }
    }
    return best;
  }
  G.nearestRoad = nearestRoad;

  // ---- roadside placement guard (user report: trees/lamps in the middle of the road) ----
  // A point is ON a road if either coordinate is inside a road band. Roadside
  // props sit >= ROAD/2+2.5 from their own road's center, but their free
  // coordinate along the road can land inside a CROSSING road's band — that is
  // how palms/lamps ended up standing on the asphalt. offRoadPos() pushes any
  // coordinate that falls inside a road band out to the nearest sidewalk edge,
  // and registers every placed prop so the headless test can audit them.
  G.roadsideProps = [];
  function roadOverlap(v) {
    for (var i = 0; i < roadCenters.length; i++) {
      var d = v - roadCenters[i];
      if (Math.abs(d) < ROAD / 2 + 1) return { rc: roadCenters[i], d: d };
    }
    return null;
  }
  function pushOffRoad(v) {
    var o = roadOverlap(v);
    if (!o) return v;
    return o.rc + (o.d >= 0 ? 1 : -1) * (ROAD / 2 + 2.5);
  }
  function offRoadPos(x, z, kind) {
    var nx = pushOffRoad(x), nz = pushOffRoad(z);
    G.roadsideProps.push({ kind: kind || 'prop', x: Math.round(nx * 10) / 10, z: Math.round(nz * 10) / 10 });
    return [nx, nz];
  }
  G.offRoadPos = offRoadPos;
  // strict audit: a prop counts as "on the road" if either coordinate is
  // within ROAD/2 + 0.5 of a road center (lamps sit at +-9, trees at +-10.5).
  G.checkRoadside = function () {
    var bad = [];
    for (var i = 0; i < G.roadsideProps.length; i++) {
      var p = G.roadsideProps[i], on = false;
      for (var j = 0; j < roadCenters.length && !on; j++) {
        if (Math.abs(p.x - roadCenters[j]) < ROAD / 2 + 0.5) on = true;
        if (Math.abs(p.z - roadCenters[j]) < ROAD / 2 + 0.5) on = true;
      }
      if (on) bad.push(p);
    }
    return { total: G.roadsideProps.length, onRoad: bad };
  };

  // deterministic-ish random (seeded so the city is stable)
  var seed = 1337;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function rrange(a, b) { return a + rnd() * (b - a); }
  function rpick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  G.rnd = rnd; G.rrange = rrange; G.rpick = rpick;

  // ---------------- canvas helpers ----------------
  function makeCanvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    return c;
  }
  G.makeCanvas = makeCanvas;

  // ---------------- ground texture (top-down city map) ----------------
  function buildGroundTexture() {
    var S = 2048, c = makeCanvas(S, S), ctx = c.getContext('2d');
    var scale = S / WORLD;               // px per world unit
    function X(wx) { return (wx + WORLD / 2) * scale; }
    function Z(wz) { return (wz + WORLD / 2) * scale; }
    // base: sidewalk / block ground
    ctx.fillStyle = '#8d8578'; ctx.fillRect(0, 0, S, S);
    // boardwalk strip along the beach edge
    ctx.fillStyle = '#9a744a'; ctx.fillRect(X(HALF + 1), 0, 7 * scale, S);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (var pl = 0; pl < S; pl += 12) ctx.fillRect(X(HALF + 1), pl, 7 * scale, 2);
    // beach sand (east strip)
    ctx.fillStyle = '#e8c98f'; ctx.fillRect(X(HALF + 8), 0, S - X(HALF + 8), S);
    ctx.fillStyle = '#dcb877';
    for (var b = 0; b < 26; b++) ctx.fillRect(X(HALF + 10 + rnd() * 18), rnd() * S, 8, 5);
    // blocks
    for (var bx = 0; bx < N; bx++) for (var bz = 0; bz < N; bz++) {
      var x0 = -HALF + ROAD + bx * (BLOCK + ROAD), z0 = -HALF + ROAD + bz * (BLOCK + ROAD);
      ctx.fillStyle = (bx + bz) % 2 ? '#7e7668' : '#857c6e';
      ctx.fillRect(X(x0), Z(z0), BLOCK * scale, BLOCK * scale);
      // sidewalk tile grid on blocks
      ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1;
      for (var g = 4; g < BLOCK; g += 8) {
        ctx.beginPath(); ctx.moveTo(X(x0 + g), Z(z0)); ctx.lineTo(X(x0 + g), Z(z0 + BLOCK)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(x0), Z(z0 + g)); ctx.lineTo(X(x0 + BLOCK), Z(z0 + g)); ctx.stroke();
      }
      // plaza / park tint on some blocks
      if ((bx * 7 + bz * 3) % 5 === 0) {
        ctx.fillStyle = '#5d7a52'; ctx.fillRect(X(x0 + 4), Z(z0 + 4), (BLOCK - 8) * scale, (BLOCK - 8) * scale);
      }
    }
    // central plaza stone circle (mission start area)
    ctx.fillStyle = '#b8a888';
    ctx.beginPath(); ctx.arc(X(0), Z(0), 13 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9a8a6a';
    ctx.beginPath(); ctx.arc(X(0), Z(0), 9 * scale, 0, Math.PI * 2); ctx.fill();
    // roads
    ctx.fillStyle = '#33333d';
    for (var i = 0; i < roadCenters.length; i++) {
      var rc = roadCenters[i];
      ctx.fillRect(X(rc - ROAD / 2), 0, ROAD * scale, S);           // vertical
      ctx.fillRect(0, Z(rc - ROAD / 2), S, ROAD * scale);           // horizontal
    }
    // road markings: center dashes + edge lines
    ctx.fillStyle = '#d8b13a';
    for (var j = 0; j < roadCenters.length; j++) {
      var r2 = roadCenters[j];
      for (var d = -WORLD / 2; d < WORLD / 2; d += 10) {
        ctx.fillRect(X(r2) - 1.5, Z(d), 3, 14);                     // vertical dash
        ctx.fillRect(X(d), Z(r2) - 1.5, 14, 3);                     // horizontal dash
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (var k = 0; k < roadCenters.length; k++) {
      var r3 = roadCenters[k];
      ctx.fillRect(X(r3 - ROAD / 2 + 1), 0, 2, S);
      ctx.fillRect(X(r3 + ROAD / 2 - 3), 0, 2, S);
      ctx.fillRect(0, Z(r3 - ROAD / 2 + 1), S, 2);
      ctx.fillRect(0, Z(r3 + ROAD / 2 - 3), S, 2);
    }
    // crosswalks at intersections
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (var a = 0; a < roadCenters.length; a++) for (var b2 = 0; b2 < roadCenters.length; b2++) {
      var cx = roadCenters[a], cz = roadCenters[b2];
      for (var s = -3; s <= 3; s++) {
        ctx.fillRect(X(cx + s * 2 - 0.8), Z(cz - ROAD / 2 + 1), 1.6, 4);
        ctx.fillRect(X(cx + s * 2 - 0.8), Z(cz + ROAD / 2 - 5), 1.6, 4);
        ctx.fillRect(X(cx - ROAD / 2 + 1), Z(cz + s * 2 - 0.8), 4, 1.6);
        ctx.fillRect(X(cx + ROAD / 2 - 5), Z(cz + s * 2 - 0.8), 4, 1.6);
      }
    }
    // SHIBUYA SCRAMBLE at (38,38): extra-wide zebra + diagonals
    (function scramble() {
      var sx = 38, sz = 38;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (var s2 = -3; s2 <= 3; s2++) {
        ctx.fillRect(X(sx + s2 * 2.2 - 0.9), Z(sz - ROAD / 2), 1.8, ROAD * scale);
        ctx.fillRect(X(sx - ROAD / 2), Z(sz + s2 * 2.2 - 0.9), ROAD * scale, 1.8);
      }
      ctx.save();
      ctx.translate(X(sx), Z(sz));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-ROAD * scale * 0.62, -1.1 * scale, ROAD * scale * 1.24, 2.2 * scale);
      ctx.rotate(Math.PI / 2);
      ctx.fillRect(-ROAD * scale * 0.62, -1.1 * scale, ROAD * scale * 1.24, 2.2 * scale);
      ctx.restore();
    })();
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return { texture: tex, canvas: c };
  }

  // building facade texture (lit windows, sunset palette) + shopfront band
  function buildingTexture(base, lit) {
    var c = makeCanvas(256, 512), ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(0, 0, 256, 14); ctx.fillRect(0, 498, 256, 14);
    // dense small windows so they read at any building size
    for (var y = 22; y < 452; y += 18) for (var x = 10; x < 246; x += 18) {
      var on = rnd() < lit;
      ctx.fillStyle = on ? '#ffd98a' : 'rgba(22,16,34,0.6)';
      ctx.fillRect(x, y, 10, 12);
    }
    // ground-floor shopfront: glass + awning stripes
    ctx.fillStyle = '#2a2a3a'; ctx.fillRect(8, 458, 240, 40);
    ctx.fillStyle = 'rgba(255,220,140,0.75)';
    for (var w = 14; w < 240; w += 22) ctx.fillRect(w, 462, 12, 32);
    var awn = ['#d63030', '#f2e3c9', '#d63030', '#f2e3c9', '#d63030', '#f2e3c9', '#d63030', '#f2e3c9'];
    for (var a2 = 0; a2 < 8; a2++) { ctx.fillStyle = awn[a2]; ctx.fillRect(8 + a2 * 30, 448, 30, 10); }
    // subtle floor bands
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (var b = 0; b < 512; b += 36) ctx.fillRect(0, b, 256, 2);
    return new THREE.CanvasTexture(c);
  }

  // modern glass tower facade
  function glassTexture(lit) {
    var c = makeCanvas(256, 512), ctx = c.getContext('2d');
    ctx.fillStyle = '#232c3d'; ctx.fillRect(0, 0, 256, 512);
    for (var y = 12; y < 500; y += 16) for (var x = 8; x < 248; x += 16) {
      var on = rnd() < lit;
      ctx.fillStyle = on ? (rnd() < 0.5 ? '#ffe9a8' : '#9fd8ff') : 'rgba(10,14,24,0.85)';
      ctx.fillRect(x, y, 11, 11);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (var b2 = 0; b2 < 512; b2 += 48) ctx.fillRect(0, b2, 256, 3);
    return new THREE.CanvasTexture(c);
  }

  // neon sign texture: katakana big + romaji small, glowing frame
  function neonTexture(jp, romaji, color, vertical) {
    var c = vertical ? makeCanvas(160, 512) : makeCanvas(512, 192);
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 26;
    ctx.fillStyle = color;
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    if (vertical) {
      ctx.font = 'bold 82px "Noto Serif CJK JP", serif';
      var chars = jp.split('');
      for (var i = 0; i < chars.length; i++) ctx.fillText(chars[i], 80, 62 + i * 96);
      ctx.font = 'bold 26px Arial';
      ctx.shadowBlur = 10;
      ctx.fillText(romaji, 80, 478);
    } else {
      ctx.font = 'bold 92px "Noto Serif CJK JP", serif';
      ctx.fillText(jp, 256, 76);
      ctx.font = 'bold 32px Arial';
      ctx.shadowBlur = 12;
      ctx.fillText(romaji, 256, 152);
    }
    ctx.shadowBlur = 14;
    ctx.strokeRect(7, 7, c.width - 14, c.height - 14);
    return new THREE.CanvasTexture(c);
  }

  // big billboard texture: gradient + katakana + romaji
  function billboardTexture(main, sub, bg1, bg2) {
    var c = makeCanvas(512, 256), ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 512, 256);
    g.addColorStop(0, bg1); g.addColorStop(1, bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (var i = -2; i < 8; i++) {
      ctx.save(); ctx.translate(i * 90, 0); ctx.rotate(0.5);
      ctx.fillRect(0, -120, 34, 520); ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000'; ctx.shadowBlur = 10;
    ctx.font = 'bold 88px "Noto Serif CJK JP", serif';
    ctx.fillText(main, 256, 104);
    ctx.font = 'bold 42px Arial';
    ctx.fillText(sub, 256, 188);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 240);
    return new THREE.CanvasTexture(c);
  }

  // helipad "H" texture
  function helipadTexture() {
    var c = makeCanvas(256, 256), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(128, 128, 112, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 130px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H', 128, 134);
    return new THREE.CanvasTexture(c);
  }

  // vending machine front
  function vendingTexture(base) {
    var c = makeCanvas(128, 256), ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = '#14141c'; ctx.fillRect(10, 14, 108, 130);
    var cols = ['#ff5b5b', '#3fb8ff', '#7ddb8a', '#ffd76a', '#c9a0ff', '#ff9a3d'];
    for (var r = 0; r < 3; r++) for (var q = 0; q < 4; q++) {
      ctx.fillStyle = cols[(r * 4 + q) % cols.length];
      ctx.fillRect(16 + q * 26, 22 + r * 40, 20, 30);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center';
    ctx.fillText('DRINK', 64, 178);
    ctx.font = 'bold 18px Arial';
    ctx.fillText('つめた〜い', 64, 208);
    ctx.fillStyle = '#ffd76a'; ctx.fillRect(14, 226, 100, 16);
    return new THREE.CanvasTexture(c);
  }

  // konbini shopfront texture: lit interior shelves + door
  function shopfrontTexture() {
    var c = makeCanvas(512, 128), ctx = c.getContext('2d');
    ctx.fillStyle = '#1c2438'; ctx.fillRect(0, 0, 512, 128);
    // shelves with colorful products
    var cols = ['#ff5b5b', '#3fb8ff', '#7ddb8a', '#ffd76a', '#c9a0ff', '#ff9a3d', '#ffffff'];
    for (var r = 0; r < 3; r++) {
      ctx.fillStyle = '#3a2c1c'; ctx.fillRect(8, 26 + r * 34, 380, 6);
      for (var q = 0; q < 12; q++) {
        ctx.fillStyle = cols[(r * 12 + q) % cols.length];
        ctx.fillRect(14 + q * 31, 4 + r * 34, 22, 24);
      }
    }
    // door (right side)
    ctx.fillStyle = '#9fd8e8'; ctx.fillRect(404, 6, 100, 116);
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 4; ctx.strokeRect(404, 6, 100, 116);
    ctx.fillStyle = '#14141c'; ctx.fillRect(448, 58, 8, 22);
    // warm ceiling light strip
    ctx.fillStyle = 'rgba(255,220,140,0.85)'; ctx.fillRect(0, 0, 512, 6);
    return new THREE.CanvasTexture(c);
  }

  // striped awning texture
  function awningTexture(c1, c2) {
    var c = makeCanvas(256, 64), ctx = c.getContext('2d');
    for (var i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? c1 : c2; ctx.fillRect(i * 32, 0, 32, 64); }
    return new THREE.CanvasTexture(c);
  }

  // flower bed texture (colorful dots on soil)
  function flowerTexture() {
    var c = makeCanvas(128, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#3d5a34'; ctx.fillRect(0, 0, 128, 64);
    var cols = ['#ff5b7a', '#ffd76a', '#ffffff', '#c9a0ff', '#ff9a3d'];
    for (var i = 0; i < 46; i++) {
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.beginPath(); ctx.arc(6 + rnd() * 116, 6 + rnd() * 52, 3 + rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  // monorail train side texture
  function trainTexture() {
    var c = makeCanvas(256, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#2fa8ff'; ctx.fillRect(0, 44, 256, 12);
    ctx.fillStyle = '#14141c';
    for (var i = 0; i < 5; i++) ctx.fillRect(14 + i * 48, 12, 34, 22);
    return new THREE.CanvasTexture(c);
  }

  // beach sand texture: warm sand + fine speckles, few shells, faint footprints
  function sandTexture() {
    var c = makeCanvas(256, 512), ctx = c.getContext('2d');
    ctx.fillStyle = '#e8c98f'; ctx.fillRect(0, 0, 256, 512);
    var dots = ['#dcb877', '#f2ddb0', '#d9b47e', '#e2c184'];
    for (var i = 0; i < 500; i++) {
      ctx.fillStyle = dots[Math.floor(rnd() * dots.length)];
      ctx.fillRect(rnd() * 256, rnd() * 512, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // shells (few, small)
    var shells = ['#ffffff', '#ffb7d5', '#ffd76a', '#ff9a7a'];
    for (var s = 0; s < 8; s++) {
      ctx.fillStyle = shells[Math.floor(rnd() * shells.length)];
      ctx.beginPath(); ctx.arc(10 + rnd() * 236, 10 + rnd() * 492, 2 + rnd() * 2, 0, Math.PI * 2); ctx.fill();
    }
    // footprints: faint paired dots
    ctx.fillStyle = 'rgba(120,90,50,0.2)';
    for (var f = 0; f < 18; f++) {
      var fx = 10 + rnd() * 230, fy = 10 + rnd() * 480;
      ctx.beginPath(); ctx.ellipse(fx, fy, 2, 4, rnd() * 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(fx + 6, fy + 8, 2, 4, rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  // shoreline foam: white wavy edge fading to transparent.
  // Thick white edge on the RIGHT (U=1, ocean/east side), fading toward sand.
  function foamTexture() {
    var c = makeCanvas(64, 512), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 512);
    for (var y = 0; y < 512; y += 6) {
      var w = 18 + Math.sin(y * 0.05) * 10 + rnd() * 8;
      var g = ctx.createLinearGradient(64, y, 64 - w, y);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(64 - w, y, w, 5);
    }
    for (var i = 0; i < 60; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(34 + rnd() * 30, rnd() * 512, 1 + rnd() * 2.5, 0, Math.PI * 2); ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  // wooden boardwalk planks
  function boardwalkTexture() {
    var c = makeCanvas(256, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#8a6a42'; ctx.fillRect(0, 0, 256, 64);
    for (var i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? '#9a7a4e' : '#7a5a38';
      ctx.fillRect(i * 16, 0, 14, 64);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(i * 16 + 14, 0, 2, 64);
    }
    return new THREE.CanvasTexture(c);
  }

  // radial glow sprite texture (shared). Optional tint as "r,g,b" string.
  function glowTexture(tint) {
    var c = makeCanvas(64, 64), ctx = c.getContext('2d');
    var base = tint || '255,220,150';
    var g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(' + base + ',0.9)');
    g.addColorStop(0.5, 'rgba(' + base + ',0.35)');
    g.addColorStop(1, 'rgba(' + base + ',0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // small label sprite (text on dark disc) — for heli / bus stop
  function labelTexture(text, color) {
    var c = makeCanvas(256, 128), ctx = c.getContext('2d');
    ctx.beginPath(); ctx.arc(128, 64, 58, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,8,18,0.85)'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = color || '#ffd76a'; ctx.stroke();
    ctx.fillStyle = color || '#ffd76a';
    ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 66);
    return new THREE.CanvasTexture(c);
  }
  function labelSprite(text, color) {
    var tex = labelTexture(text, color);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(6, 3, 1);
    return sp;
  }
  G.labelSprite = labelSprite;


  // ---------------- scene setup ----------------
  var DECOR = { gulls: [], buoys: [], boats: [], clouds: [], neonFlicker: [], beacons: [], trafficHeads: [], trafficState: -1, frozenState: 0, freezeLights: false, train: null, trainDir: 1, newsHeli: null, newsAngle: 0, petals: null, petalVel: null, time: 0, heliLabels: [], streetLamps: [], stringBulbMats: [], waves: [] };
  G.DECOR = DECOR;

  function initWorld() {
    var scene = new THREE.Scene();
    G.scene = scene;

    // sunset sky dome (gradient canvas texture on inside of sphere)
    var sc = makeCanvas(16, 512), sctx = sc.getContext('2d');
    var grad = sctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#1c0f45');
    grad.addColorStop(0.30, '#5e2470');
    grad.addColorStop(0.50, '#c94a6e');
    grad.addColorStop(0.68, '#ff7a4d');
    grad.addColorStop(0.82, '#ffb35c');
    grad.addColorStop(1.0, '#ffd98a');
    sctx.fillStyle = grad; sctx.fillRect(0, 0, 16, 512);
    var skyTex = new THREE.CanvasTexture(sc);
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
    );
    scene.add(sky);

    // sun disc low on the western horizon
    var sun = new THREE.Mesh(
      new THREE.CircleGeometry(46, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false })
    );
    sun.position.set(-760, 95, -180); sun.lookAt(0, 40, 0);
    scene.add(sun);
    var sunGlow = new THREE.Mesh(
      new THREE.CircleGeometry(90, 32),
      new THREE.MeshBasicMaterial({ color: 0xff9a4d, transparent: true, opacity: 0.25, fog: false })
    );
    sunGlow.position.copy(sun.position).add(new THREE.Vector3(0, 0, -2));
    sunGlow.lookAt(0, 40, 0);
    scene.add(sunGlow);

    // stars appearing in the upper sky
    (function stars() {
      var n = 260, pos = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var a = rnd() * Math.PI * 2, e = 0.35 + rnd() * 1.1, r = 820;
        pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
        pos[i * 3 + 1] = Math.sin(e) * r;
        pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false }));
      scene.add(pts);
    })();

    // distant skyline silhouette (west / north / south)
    (function skyline() {
      var mat = new THREE.MeshLambertMaterial({ color: 0x241631 });
      var geo = new THREE.BoxGeometry(1, 1, 1);
      var spots = [];
      for (var i = 0; i < 10; i++) spots.push({ x: -300 - rnd() * 110, z: -380 + i * 84, w: 22 + rnd() * 22 });
      for (var j = 0; j < 8; j++) spots.push({ x: -380 + j * 100, z: -310 - rnd() * 90, w: 22 + rnd() * 22 });
      for (var k = 0; k < 8; k++) spots.push({ x: -380 + k * 100, z: 310 + rnd() * 90, w: 22 + rnd() * 22 });
      for (var s = 0; s < spots.length; s++) {
        var sp = spots[s], h = 26 + rnd() * 64;
        var m = new THREE.Mesh(geo, mat);
        m.scale.set(sp.w, h, sp.w);
        m.position.set(sp.x, h / 2, sp.z);
        scene.add(m);
        if (rnd() < 0.4) {
          var bc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false }));
          bc.position.set(sp.x, h + 1.5, sp.z);
          scene.add(bc);
          DECOR.beacons.push(bc);
        }
      }
      // Tokyo Tower-ish silhouette on the west horizon
      var tower = new THREE.Mesh(new THREE.ConeGeometry(10, 70, 4), new THREE.MeshLambertMaterial({ color: 0x3a1f2e }));
      tower.position.set(-330, 35, 120);
      tower.rotation.y = Math.PI / 4;
      scene.add(tower);
      var tb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false }));
      tb.position.set(-330, 71, 120);
      scene.add(tb);
      DECOR.beacons.push(tb);
    })();

    // drifting sunset clouds
    (function clouds() {
      var mat = new THREE.MeshBasicMaterial({ color: 0xffc9a8, transparent: true, opacity: 0.5, fog: false });
      var geo = new THREE.SphereGeometry(1, 8, 6);
      for (var i = 0; i < 10; i++) {
        var g = new THREE.Group();
        var npuff = 3 + Math.floor(rnd() * 3);
        for (var p = 0; p < npuff; p++) {
          var s = new THREE.Mesh(geo, mat);
          s.scale.set(rrange(14, 26), rrange(4, 7), rrange(8, 13));
          s.position.set(p * 14 - npuff * 6, rrange(-1, 2), rrange(-4, 4));
          g.add(s);
        }
        g.position.set(rrange(-380, 380), rrange(125, 185), rrange(-380, 380));
        scene.add(g);
        DECOR.clouds.push(g);
      }
    })();

    // fog + lights
    scene.fog = new THREE.Fog(0xe88a68, 130, 520);
    var hemi = new THREE.HemisphereLight(0xffd9a8, 0x3a2438, 0.85);
    scene.add(hemi);
    var sunLight = new THREE.DirectionalLight(0xffb36b, 1.15);
    sunLight.position.set(-180, 90, -60);
    scene.add(sunLight);
    var fill = new THREE.DirectionalLight(0x8a7bff, 0.25);
    fill.position.set(120, 60, 140);
    scene.add(fill);

    // ground
    var gt = buildGroundTexture();
    G.groundCanvas = gt.canvas;
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.MeshLambertMaterial({ map: gt.texture })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    scene.add(ground);
    G.ground = ground;

    // ocean (east of beach)
    var ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(320, WORLD + 200),
      new THREE.MeshLambertMaterial({ color: 0x1d6f8e })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(HALF + 6 + 160, -0.4, 0);
    scene.add(ocean);
    G.ocean = ocean;
    // wet sand strip highlight (at the NEW waterline, x ~252-260)
    var sand = new THREE.Mesh(
      new THREE.PlaneGeometry(9, WORLD),
      new THREE.MeshLambertMaterial({ color: 0xd9b47e })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(HALF + 57, 0.08, 0);
    scene.add(sand);

    buildCity(scene);
    buildTreesAndProps(scene);
    buildBeach(scene);
    buildSkyLife(scene);
    buildMonorail(scene);
  }

  // ---------------- colliders ----------------
  G.colliders = [];   // {x1,z1,x2,z2,h}
  function addCollider(x1, z1, x2, z2, h) {
    G.colliders.push({ x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), h: h || 30 });
  }
  G.addCollider = addCollider;

  // Resolve a circle (x,z,r) against all AABBs. Returns {x,z,hit, nx,nz}.
  function collideCircle(x, z, r) {
    var hit = false, nx = 0, nz = 0;
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < G.colliders.length; i++) {
        var c = G.colliders[i];
        var cx = Math.max(c.x1, Math.min(x, c.x2));
        var cz = Math.max(c.z1, Math.min(z, c.z2));
        var dx = x - cx, dz = z - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          hit = true;
          if (d2 > 1e-6) {
            var d = Math.sqrt(d2);
            var push = (r - d) / d;
            x += dx * push; z += dz * push;
            nx = dx / d; nz = dz / d;
          } else {
            var l = x - c.x1, rt = c.x2 - x, tp = z - c.z1, bt = c.z2 - z;
            if (l <= rt && l <= tp && l <= bt) { x = c.x1 - r; nx = -1; nz = 0; }
            else if (rt <= tp && rt <= bt) { x = c.x2 + r; nx = 1; nz = 0; }
            else if (tp <= bt) { z = c.z1 - r; nx = 0; nz = -1; }
            else { z = c.z2 + r; nx = 0; nz = 1; }
          }
        }
      }
    }
    return { x: x, z: z, hit: hit, nx: nx, nz: nz };
  }
  G.collideCircle = collideCircle;

  // ---------------- buildings ----------------
  var NEON_WORDS = [
    ['ラーメン', 'RAMEN', '#ff5b3d'], ['寿司', 'SUSHI', '#3fd8ff'], ['カラオケ', 'KARAOKE', '#ff5bd8'],
    ['居酒屋', 'IZAKAYA', '#ffd76a'], ['コンビニ', 'KONBINI', '#7dff8a'], ['ホテル', 'HOTEL', '#b78cff'],
    ['ゲーム', 'GAME', '#ff5b8a'], ['焼肉', 'YAKINIKU', '#ff9a3d'], ['喫茶', 'CAFE', '#ffe9a8'],
    ['薬局', 'PHARMACY', '#7dff8a'], ['映画', 'CINEMA', '#5b8cff'], ['温泉', 'ONSEN', '#3fffd8']
  ];
  var BILLBOARDS = [
    ['寿司', 'SUSHI · FRESH', '#ff5b7a', '#7a1040'], ['ラーメン', 'RAMEN 24h', '#ff7a3d', '#8a2a00'],
    ['カラオケ', 'KARAOKE ALL NIGHT', '#ff5bd8', '#5e0a5e'], ['東京湾', 'TOKYO BAY', '#3fb8ff', '#0a2a5e'],
    ['ゲーム', 'GAME CENTER', '#b78cff', '#2a0a5e'], ['焼肉', 'YAKINIKU', '#ffd76a', '#8a4a00']
  ];

  // sign placement on the building face nearest a road: {x, z, ry}
  function faceTransform(b) {
    var cx = b.x + b.w / 2, cz = b.z + b.d / 2;
    var nx = nearestRoad(cx), nz = nearestRoad(cz);
    var dx = Math.abs(cx - nx), dz = Math.abs(cz - nz);
    return faceTransformAxis(b, dx <= dz);
  }
  // same, but forced to the x-face (useX=true) or z-face (useX=false)
  function faceTransformAxis(b, useX) {
    var cx = b.x + b.w / 2, cz = b.z + b.d / 2;
    if (useX) {
      var nx = nearestRoad(cx);
      if (cx < nx) return { x: b.x + b.w, z: cz, ry: Math.PI / 2, axis: 'x' };
      return { x: b.x, z: cz, ry: -Math.PI / 2, axis: 'x' };
    }
    var nz = nearestRoad(cz);
    if (cz < nz) return { x: cx, z: b.z + b.d, ry: 0, axis: 'z' };
    return { x: cx, z: b.z, ry: Math.PI, axis: 'z' };
  }
  function nudgeOut(ft, d) {
    if (ft.ry === Math.PI / 2) return { x: ft.x + d, z: ft.z };
    if (ft.ry === -Math.PI / 2) return { x: ft.x - d, z: ft.z };
    if (ft.ry === 0) return { x: ft.x, z: ft.z + d };
    return { x: ft.x, z: ft.z - d };
  }

  function buildCity(scene) {
    var palette = ['#f2e3c9', '#e8b48a', '#d98a7a', '#9fb8b0', '#c9a06a', '#b98a9e', '#8fa8c9', '#e8d8a8'];
    var roofPalette = ['#5a4a5e', '#6b4a3a', '#3a4a5e', '#54423a'];
    var boxGeo = new THREE.BoxGeometry(1, 1, 1);
    G.buildings = [];
    G.tallestBuilding = null;
    for (var bx = 0; bx < N; bx++) for (var bz = 0; bz < N; bz++) {
      var x0 = -HALF + ROAD + bx * (BLOCK + ROAD);
      var z0 = -HALF + ROAD + bz * (BLOCK + ROAD);
      var park = (bx * 7 + bz * 3) % 5 === 0;
      if (park) { G.parks = G.parks || []; G.parks.push({ x: x0 + BLOCK / 2, z: z0 + BLOCK / 2 }); continue; }
      // konbini block (east of the central plaza)
      if (bx === 3 && bz === 2) { addKonbini(scene, x0, z0, boxGeo); continue; }
      var count = rpick([1, 2, 2, 3]);
      if (count === 1) {
        addBuilding(scene, x0 + 6, z0 + 6, BLOCK - 12, BLOCK - 12, palette, roofPalette, boxGeo);
      } else if (count === 2) {
        var split = rnd() < 0.5;
        if (split) {
          addBuilding(scene, x0 + 4, z0 + 4, BLOCK / 2 - 6, BLOCK - 8, palette, roofPalette, boxGeo);
          addBuilding(scene, x0 + BLOCK / 2 + 2, z0 + 4, BLOCK / 2 - 6, BLOCK - 8, palette, roofPalette, boxGeo);
        } else {
          addBuilding(scene, x0 + 4, z0 + 4, BLOCK - 8, BLOCK / 2 - 6, palette, roofPalette, boxGeo);
          addBuilding(scene, x0 + 4, z0 + BLOCK / 2 + 2, BLOCK - 8, BLOCK / 2 - 6, palette, roofPalette, boxGeo);
        }
      } else {
        addBuilding(scene, x0 + 4, z0 + 4, BLOCK / 2 - 6, BLOCK / 2 - 6, palette, roofPalette, boxGeo);
        addBuilding(scene, x0 + BLOCK / 2 + 2, z0 + 4, BLOCK / 2 - 6, BLOCK / 2 - 6, palette, roofPalette, boxGeo);
        addBuilding(scene, x0 + 4, z0 + BLOCK / 2 + 2, BLOCK - 8, BLOCK / 2 - 6, palette, roofPalette, boxGeo);
      }
    }
    // helipad + parked heli on the tallest roof
    if (G.tallestBuilding) {
      var tb = G.tallestBuilding;
      var pad = new THREE.Mesh(new THREE.CircleGeometry(6.5, 24), new THREE.MeshLambertMaterial({ color: 0x222226 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(tb.x, tb.h + 1.25, tb.z);
      scene.add(pad);
      var ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 6.5, 24), new THREE.MeshBasicMaterial({ color: 0xffd76a, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tb.x, tb.h + 1.28, tb.z);
      scene.add(ring);
      var hMark = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: helipadTexture(), transparent: true, depthWrite: false }));
      hMark.rotation.x = -Math.PI / 2;
      hMark.position.set(tb.x, tb.h + 1.31, tb.z);
      scene.add(hMark);
      var heli = makeHeliMesh(0xd63030, 'RESCUE', 0xffffff);
      heli.position.set(tb.x, tb.h + 1.4, tb.z);
      heli.rotation.y = 0.6;
      scene.add(heli);
      if (heli.userData.labelPlane) { scene.add(heli.userData.labelPlane); DECOR.heliLabels.push(heli); }
    }
  }

  // generic helicopter mesh builder (police/news/rescue variants)
  function makeHeliMesh(bodyColor, label, stripeColor) {
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor, emissive: 0x2a2a2a }); // lift the shadow side so the heli reads at dusk
    var dark = new THREE.MeshLambertMaterial({ color: 0x14141c });
    var body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.5, 5.2), bodyMat);
    body.position.y = 1.1; g.add(body);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.2), bodyMat);
    nose.position.set(0, 0.95, 3.0); g.add(nose);
    var glass = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.6), new THREE.MeshLambertMaterial({ color: 0x9fd8e8 }));
    glass.position.set(0, 1.15, 2.6); g.add(glass);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.6), bodyMat);
    tail.position.set(0, 1.3, -4.6); g.add(tail);
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.6, 1.0), bodyMat);
    fin.position.set(0, 2.0, -6.6); g.add(fin);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.35, 5.25), new THREE.MeshLambertMaterial({ color: stripeColor === undefined ? 0xffffff : stripeColor }));
    stripe.position.y = 0.9; g.add(stripe);
    // skids
    var skidGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6);
    skidGeo.rotateX(Math.PI / 2);
    var sk1 = new THREE.Mesh(skidGeo, dark); sk1.position.set(-1.1, 0.15, 0); g.add(sk1);
    var sk2 = new THREE.Mesh(skidGeo, dark); sk2.position.set(1.1, 0.15, 0); g.add(sk2);
    // main rotor
    var rotor = new THREE.Group();
    var bladeGeo = new THREE.BoxGeometry(11, 0.1, 0.55);
    var bladeMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    var b1 = new THREE.Mesh(bladeGeo, bladeMat); rotor.add(b1);
    var b2 = new THREE.Mesh(bladeGeo, bladeMat); b2.rotation.y = Math.PI / 2; rotor.add(b2);
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8), dark);
    rotor.add(hub);
    rotor.position.y = 2.1; g.add(rotor);
    g.userData.rotor = rotor;
    // tail rotor
    var tr = new THREE.Group();
    var tb1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.3), bladeMat); tr.add(tb1);
    var tb2 = tb1.clone(); tb2.rotation.z = Math.PI / 2; tr.add(tb2);
    tr.position.set(0.45, 1.9, -6.6); g.add(tr);
    g.userData.tailRotor = tr;
    if (label) {
      // NOTE: plane, NOT a Sprite — three r128 sprites under this rotating
      // group intermittently collapse to zero width (SBPD label vanished in
      // screenshots). The plane is NOT added to the group: a child plane of
      // the rotating group also failed to render, while an identical
      // scene-parented plane renders fine. The caller adds it to the scene
      // and G.billboardHeliLabel positions + faces it every frame.
      var lp = new THREE.Mesh(new THREE.PlaneGeometry(6, 3),
        new THREE.MeshBasicMaterial({ map: labelTexture(label, '#ffffff'), transparent: true, fog: false, side: THREE.DoubleSide }));
      g.userData.labelPlane = lp;
    }
    return g;
  }
  G.makeHeliMesh = makeHeliMesh;

  // scene-parented heli label: hovers above the heli, always faces the camera
  // +7 (not +3.8): from the steep below-angle the long body occludes anything
  // closer to it — the label must clear the body's screen footprint
  G.billboardHeliLabel = function (anchor) {
    var lp = anchor.userData.labelPlane;
    if (!lp || !G.camera) return;
    lp.position.set(anchor.position.x, anchor.position.y + 7, anchor.position.z);
    lp.rotation.y = Math.atan2(G.camera.position.x - anchor.position.x, G.camera.position.z - anchor.position.z);
  };

  function addBuilding(scene, x, z, w, d, palette, roofPalette, boxGeo) {
    var h = rrange(10, 42);
    if (rnd() < 0.18) h = rrange(42, 64);   // Tokyo towers
    var base = rpick(palette);
    var glassTower = rnd() < 0.25;
    var mat = new THREE.MeshLambertMaterial({ map: glassTower ? glassTexture(0.5) : buildingTexture(base, 0.45) });
    var m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(w, h, d);
    m.position.set(x + w / 2, h / 2, z + d / 2);
    scene.add(m);
    var roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: rpick(roofPalette) }));
    roof.scale.set(w + 1, 1.2, d + 1);
    roof.position.set(x + w / 2, h + 0.6, z + d / 2);
    scene.add(roof);
    var b = { x: x, z: z, w: w, d: d, h: h };
    // rooftop props: AC units
    if (h > 14) {
      var ac = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x777777 }));
      ac.scale.set(4, 2, 3);
      ac.position.set(x + w / 2 - 3, h + 2.2, z + d / 2);
      scene.add(ac);
      if (rnd() < 0.5) {
        var ac2 = ac.clone();
        ac2.position.set(x + w / 2 + 5, h + 2.2, z + d / 2 - 3);
        scene.add(ac2);
      }
    }
    // antenna
    if (rnd() < 0.45) {
      var ah = rrange(5, 10);
      var ant = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, ah, 5), new THREE.MeshLambertMaterial({ color: 0x3a3a42 }));
      ant.position.set(x + w - 3, h + 1.2 + ah / 2, z + 3);
      scene.add(ant);
      var cross = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3a3a42 }));
      cross.scale.set(2.4, 0.12, 0.12);
      cross.position.set(x + w - 3, h + 1.2 + ah * 0.7, z + 3);
      scene.add(cross);
      var bc = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false }));
      bc.position.set(x + w - 3, h + 1.2 + ah + 0.4, z + 3);
      scene.add(bc);
      DECOR.beacons.push(bc);
    }
    // water tower on low buildings
    if (h < 22 && rnd() < 0.16) {
      var wt = new THREE.Group();
      var legMat = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
      for (var li = 0; li < 4; li++) {
        var leg = new THREE.Mesh(boxGeo, legMat);
        leg.scale.set(0.25, 3, 0.25);
        leg.position.set((li % 2 ? 1.2 : -1.2), 1.5, (li < 2 ? 1.2 : -1.2));
        wt.add(leg);
      }
      var tank = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2.8, 10), new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
      tank.position.y = 4.4; wt.add(tank);
      var cone = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.4, 10), new THREE.MeshLambertMaterial({ color: 0x6b4a3a }));
      cone.position.y = 6.5; wt.add(cone);
      wt.position.set(x + w / 2, h + 1.2, z + d / 2 + 4);
      scene.add(wt);
    }
    // neon signs on the facades (bigger, street-level so they read while driving)
    // dark backing panel so the glow pops against bright facades at dusk
    var neonBackMat = new THREE.MeshBasicMaterial({ color: 0x0b0a14 });
    var neonBackH = new THREE.PlaneGeometry(5.0, 2.0);
    var neonBackV = new THREE.PlaneGeometry(2.0, 5.6);
    function addNeonSign(b, ft, vertical, y, scale) {
      var nw = rpick(NEON_WORDS);
      var sign = new THREE.Mesh(
        vertical ? new THREE.PlaneGeometry(1.6 * scale, 5.2 * scale) : new THREE.PlaneGeometry(4.6 * scale, 1.7 * scale),
        new THREE.MeshBasicMaterial({ map: neonTexture(nw[0], nw[1], nw[2], vertical), transparent: true, fog: false })
      );
      var p = nudgeOut(ft, 0.18);
      sign.position.set(p.x, y, p.z);
      sign.rotation.y = ft.ry;
      scene.add(sign);
      var pb = nudgeOut(ft, 0.11);
      var back = new THREE.Mesh(vertical ? neonBackV : neonBackH, neonBackMat);
      back.scale.setScalar(scale);
      back.position.set(pb.x, y, pb.z);
      back.rotation.y = ft.ry;
      scene.add(back);
      if (rnd() < 0.25) DECOR.neonFlicker.push(sign.material);
    }
    if (rnd() < 0.62) {
      var ftMain = faceTransform(b);
      var vertMain = rnd() < 0.4;
      // street level: right in the driving eyeline (y 4-6.5)
      addNeonSign(b, ftMain, vertMain, vertMain ? 6.5 : Math.max(4, Math.min(6.5, b.h * 0.15)), 1);
      // second sign on the perpendicular face (Tokyo is drenched in neon)
      if (rnd() < 0.45) {
        var ft2b = faceTransformAxis(b, ftMain.axis !== 'x');
        var vert2 = rnd() < 0.4;
        addNeonSign(b, ft2b, vert2, vert2 ? 6 : Math.max(3.5, Math.min(6, b.h * 0.12)), 0.8);
      }
    }
    // big billboard on tall buildings
    if (h > 26 && rnd() < 0.4) {
      var bb = rpick(BILLBOARDS);
      var board = new THREE.Mesh(
        new THREE.PlaneGeometry(6.5, 3.2),
        new THREE.MeshBasicMaterial({ map: billboardTexture(bb[0], bb[1], bb[2], bb[3]), fog: false })
      );
      var ft2 = faceTransform(b);
      board.position.set(ft2.x, h * 0.78, ft2.z);
      board.position.x += ft2.ry === Math.PI / 2 ? 0.2 : (ft2.ry === -Math.PI / 2 ? -0.2 : 0);
      board.position.z += ft2.ry === 0 ? 0.2 : (ft2.ry === Math.PI ? -0.2 : 0);
      board.rotation.y = ft2.ry;
      scene.add(board);
    }
    // rooftop neon sign on towers
    if (h > 34 && rnd() < 0.4) {
      var rw = rpick(NEON_WORDS);
      var rsign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 4.8),
        new THREE.MeshBasicMaterial({ map: neonTexture(rw[0], rw[1], rw[2], true), transparent: true, fog: false })
      );
      var ft3 = faceTransform(b);
      rsign.position.set(ft3.x, h + 3.4, ft3.z);
      rsign.position.x += ft3.ry === Math.PI / 2 ? 0.8 : (ft3.ry === -Math.PI / 2 ? -0.8 : 0);
      rsign.position.z += ft3.ry === 0 ? 0.8 : (ft3.ry === Math.PI ? -0.8 : 0);
      rsign.rotation.y = ft3.ry;
      scene.add(rsign);
      var rback = new THREE.Mesh(neonBackV, neonBackMat);
      rback.position.set(rsign.position.x, rsign.position.y, rsign.position.z);
      rback.position.x += ft3.ry === Math.PI / 2 ? -0.07 : (ft3.ry === -Math.PI / 2 ? 0.07 : 0);
      rback.position.z += ft3.ry === 0 ? -0.07 : (ft3.ry === Math.PI ? 0.07 : 0);
      rback.rotation.y = ft3.ry;
      scene.add(rback);
      if (rnd() < 0.3) DECOR.neonFlicker.push(rsign.material);
    }
    addCollider(x, z, x + w, z + d, h);
    G.buildings.push({ x: x + w / 2, z: z + d / 2, w: w, d: d, h: h });
    if (!G.tallestBuilding || h > G.tallestBuilding.h) {
      G.tallestBuilding = { x: x + w / 2, z: z + d / 2, w: w, d: d, h: h };
    }
  }

  // konbini (24h convenience store) replacing one block's buildings
  function addKonbini(scene, x0, z0, boxGeo) {
    var x = x0 + 8, z = z0 + 8, w = 24, d = 12, h = 6;
    var m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xf2e3c9 }));
    m.scale.set(w, h, d);
    m.position.set(x + w / 2, h / 2, z + d / 2);
    scene.add(m);
    var roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
    roof.scale.set(w + 1, 0.8, d + 1);
    roof.position.set(x + w / 2, h + 0.4, z + d / 2);
    scene.add(roof);
    // glass shopfront (faces north, toward road z=-38) — lit interior
    var glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 2, 3.4), new THREE.MeshBasicMaterial({ map: shopfrontTexture() }));
    glass.position.set(x + w / 2, 2.1, z - 0.1);
    glass.rotation.y = Math.PI;
    scene.add(glass);
    // striped awning over the front
    var awn = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, 2.2), new THREE.MeshLambertMaterial({ map: awningTexture('#d63030', '#f2f2f2') }));
    awn.position.set(x + w / 2, 4.4, z - 1.2);
    scene.add(awn);
    // neon konbini sign (just above the awning, clear of the roof overhang)
    var sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.9),
      new THREE.MeshBasicMaterial({ map: neonTexture('コンビニ', 'KONBINI · 24h', '#7dff8a', false), transparent: true, fog: false })
    );
    sign.position.set(x + w / 2, 5.6, z - 0.55);
    sign.rotation.y = Math.PI;
    scene.add(sign);
    DECOR.neonFlicker.push(sign.material);
    // two vending machines in front (sidewalk strip, off the road)
    var kv1 = offRoadPos(x + 4, z - 3.4, 'vending');
    vendingMachine(scene, kv1[0], kv1[1], '#d63030');
    var kv2 = offRoadPos(x + 7, z - 3.4, 'vending');
    vendingMachine(scene, kv2[0], kv2[1], '#2e7dc2');
    addCollider(x, z, x + w, z + d, h);
    G.buildings.push({ x: x + w / 2, z: z + d / 2, w: w, d: d, h: h });
  }

  function vendingMachine(scene, x, z, base) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.15, 0.85), new THREE.MeshLambertMaterial({ color: 0x2c2c34 }));
    body.position.y = 1.08; g.add(body);
    var front = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0), new THREE.MeshBasicMaterial({ map: vendingTexture(base) }));
    front.position.set(0, 1.08, 0.44); g.add(front);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0.5, depthWrite: false }));
    glow.scale.set(2.2, 2.2, 1);
    glow.position.set(0, 1.2, 0.7); g.add(glow);
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI;   // face the road (north)
    scene.add(g);
    addCollider(x - 0.6, z - 0.5, x + 0.6, z + 0.5, 2.2);
    return g;
  }
  G.vendingMachine = vendingMachine;


  // ---------------- trees, street props, Tokyo life ----------------
  function buildTreesAndProps(scene) {
    // ---- shared geos / mats ----
    var trunkGeo = new THREE.CylinderGeometry(0.28, 0.45, 7, 6);
    var trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    var frondGeo = new THREE.ConeGeometry(1.6, 4.6, 4);
    frondGeo.scale(1, 1, 0.28);
    var frondMat = new THREE.MeshLambertMaterial({ color: 0x3f8f4f });
    var frondMat2 = new THREE.MeshLambertMaterial({ color: 0x57a85e });
    var sakuraTrunkGeo = new THREE.CylinderGeometry(0.25, 0.42, 3.4, 6);
    var sakuraTrunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a2a });
    var canopyGeo = new THREE.SphereGeometry(1.7, 8, 6);
    var sakuraMats = [
      new THREE.MeshLambertMaterial({ color: 0xff9ec4 }),
      new THREE.MeshLambertMaterial({ color: 0xffb7d5 }),
      new THREE.MeshLambertMaterial({ color: 0xf78fb8 })
    ];
    var mapleMats = [
      new THREE.MeshLambertMaterial({ color: 0xe85d3d }),
      new THREE.MeshLambertMaterial({ color: 0xff7a3d }),
      new THREE.MeshLambertMaterial({ color: 0xd63030 })
    ];

    function palm(x, z, s) {
      var g = new THREE.Group();
      var trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 3.5;
      trunk.rotation.z = (rnd() - 0.5) * 0.12;
      g.add(trunk);
      for (var i = 0; i < 4; i++) {
        var f = new THREE.Mesh(frondGeo, i % 2 ? frondMat : frondMat2);
        var a = (i / 4) * Math.PI * 2 + 0.4;
        f.position.set(Math.cos(a) * 1.1, 7.1, Math.sin(a) * 1.1);
        f.rotation.z = Math.cos(a) * 1.9;
        f.rotation.x = -Math.sin(a) * 1.9;
        g.add(f);
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(s || 1);
      scene.add(g);
      addCollider(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 7);
    }
    G.palm = palm;

    function sakura(x, z, s) {
      var g = new THREE.Group();
      var trunk = new THREE.Mesh(sakuraTrunkGeo, sakuraTrunkMat);
      trunk.position.y = 1.7;
      g.add(trunk);
      var offs = [[0, 3.9, 0, 1.15], [1.15, 3.3, 0.5, 0.85], [-1.0, 3.4, -0.45, 0.9]];
      for (var i = 0; i < 3; i++) {
        var c = new THREE.Mesh(canopyGeo, sakuraMats[i % 3]);
        c.position.set(offs[i][0], offs[i][1], offs[i][2]);
        c.scale.setScalar(offs[i][3]);
        g.add(c);
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(s || 1);
      scene.add(g);
      addCollider(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 4);
    }
    function maple(x, z, s) {
      var g = new THREE.Group();
      var trunk = new THREE.Mesh(sakuraTrunkGeo, sakuraTrunkMat);
      trunk.position.y = 1.7;
      g.add(trunk);
      var c1 = new THREE.Mesh(canopyGeo, mapleMats[0]);
      c1.position.set(0, 3.8, 0); c1.scale.setScalar(1.05); g.add(c1);
      var c2 = new THREE.Mesh(canopyGeo, mapleMats[1]);
      c2.position.set(1.0, 3.2, 0.4); c2.scale.setScalar(0.8); g.add(c2);
      g.position.set(x, 0, z);
      g.scale.setScalar(s || 1);
      scene.add(g);
      addCollider(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 4);
    }

    // palms along every road edge + parks + beach
    // (offRoadPos keeps them on the sidewalk: the free coordinate along the
    // road must not land inside a CROSSING road's band)
    for (var i = 0; i < roadCenters.length; i++) {
      var rc = roadCenters[i];
      for (var d = -HALF + 20; d < HALF - 10; d += 26) {
        if (rnd() < 0.6) { var pp1 = offRoadPos(rc - ROAD / 2 - 2.5, d + rrange(-4, 4), 'palm'); palm(pp1[0], pp1[1], rrange(0.85, 1.25)); }
        if (rnd() < 0.45) { var pp2 = offRoadPos(rc + ROAD / 2 + 2.5, d + 14 + rrange(-4, 4), 'palm'); palm(pp2[0], pp2[1], rrange(0.85, 1.25)); }
      }
    }
    (G.parks || []).forEach(function (p) {
      for (var k = 0; k < 3; k++) palm(p.x + rrange(-20, 20), p.z + rrange(-20, 20), rrange(0.9, 1.3));
    });
    for (var b = -HALF + 15; b < HALF - 10; b += 22) palm(HALF + 9, b, rrange(0.9, 1.3));

    // SAKURA STREETS: along road x=-38 and road z=114
    for (var s1 = -HALF + 24; s1 < HALF - 12; s1 += 24) {
      if (rnd() < 0.8) { var sk1 = offRoadPos(-38 - ROAD / 2 - 2.5, s1 + rrange(-4, 4), 'sakura'); sakura(sk1[0], sk1[1], rrange(0.9, 1.25)); }
      if (rnd() < 0.7) { var sk2 = offRoadPos(-38 + ROAD / 2 + 2.5, s1 + 12 + rrange(-4, 4), 'sakura'); sakura(sk2[0], sk2[1], rrange(0.9, 1.25)); }
    }
    for (var s2 = -HALF + 24; s2 < HALF - 12; s2 += 24) {
      if (rnd() < 0.8) { var sk3 = offRoadPos(s2 + rrange(-4, 4), 114 - ROAD / 2 - 2.5, 'sakura'); sakura(sk3[0], sk3[1], rrange(0.9, 1.25)); }
      if (rnd() < 0.7) { var sk4 = offRoadPos(s2 + 12 + rrange(-4, 4), 114 + ROAD / 2 + 2.5, 'sakura'); sakura(sk4[0], sk4[1], rrange(0.9, 1.25)); }
    }
    // sakura + maple in parks
    (G.parks || []).forEach(function (p) {
      for (var k2 = 0; k2 < 4; k2++) sakura(p.x + rrange(-22, 22), p.z + rrange(-22, 22), rrange(0.9, 1.3));
      for (var k3 = 0; k3 < 2; k3++) maple(p.x + rrange(-22, 22), p.z + rrange(-22, 22), rrange(0.9, 1.2));
    });

    // falling sakura petals (Points)
    (function petals() {
      var n = 140, pos = new Float32Array(n * 3), ph = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        pos[i * 3] = rrange(-HALF, HALF);
        pos[i * 3 + 1] = rrange(0.5, 9);
        pos[i * 3 + 2] = rrange(-HALF, HALF);
        ph[i] = rnd() * 6.28;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb7d5, size: 0.55, map: glowTexture(), transparent: true, opacity: 0.9, depthWrite: false }));
      scene.add(pts);
      DECOR.petals = pts;
      DECOR.petalPhase = ph;
    })();

    // ---- street lamps with COLORED glow + light pools on the asphalt ----
    // 5 lamp colors cycle along each road so the streets read colorful at dusk:
    // warm yellow, cool white, neon pink, orange, cyan.
    var LAMP_COLORS = [
      { hex: 0xffd98a, rgb: '255,217,138', pool: 0xffc46a },
      { hex: 0xd8ecff, rgb: '216,236,255', pool: 0xbdd8ff },
      { hex: 0xff7ad9, rgb: '255,122,217', pool: 0xff5bd0 },
      { hex: 0xff9a3d, rgb: '255,154,61', pool: 0xff8a2a },
      { hex: 0x7de8ff, rgb: '125,232,255', pool: 0x5bd8ff }
    ];
    var poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
    var poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2c34 });
    var lampGeo = new THREE.SphereGeometry(0.55, 8, 6);
    var poolGeo = new THREE.CircleGeometry(4.5, 20);
    var lampBulbMats = [], lampGlowMats = [], lampPoolMats = [];
    for (var lc = 0; lc < LAMP_COLORS.length; lc++) {
      lampBulbMats.push(new THREE.MeshBasicMaterial({ color: LAMP_COLORS[lc].hex }));
      lampGlowMats.push(new THREE.SpriteMaterial({ map: glowTexture(LAMP_COLORS[lc].rgb), transparent: true, opacity: 0.6, depthWrite: false }));
      lampPoolMats.push(new THREE.MeshBasicMaterial({ color: LAMP_COLORS[lc].pool, transparent: true, opacity: 0.22, depthWrite: false }));
    }
    function streetLamp(x, z, ci, glowScale) {
      var c = ((ci % LAMP_COLORS.length) + LAMP_COLORS.length) % LAMP_COLORS.length;
      var pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.5, z);
      scene.add(pole);
      var lamp = new THREE.Mesh(lampGeo, lampBulbMats[c]);
      lamp.position.set(x, 7.2, z);
      scene.add(lamp);
      var glow = new THREE.Sprite(lampGlowMats[c]);
      glow.scale.set(glowScale || 5.5, glowScale || 5.5, 1);
      glow.position.set(x, 7.2, z);
      scene.add(glow);
      // light pool spilled on the asphalt / sidewalk below
      var pool = new THREE.Mesh(poolGeo, lampPoolMats[c]);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.07, z);
      scene.add(pool);
      DECOR.streetLamps.push({ x: x, z: z, color: LAMP_COLORS[c].hex });
    }
    for (var j = 0; j < roadCenters.length; j++) {
      var rc2 = roadCenters[j];
      var seg = 0;
      for (var d2 = -HALF + 30; d2 < HALF - 10; d2 += 52, seg++) {
        var lp1 = offRoadPos(rc2 - ROAD / 2 - 1, d2, 'lamp');
        streetLamp(lp1[0], lp1[1], j * 2 + seg, 5.5);
        var lp2 = offRoadPos(rc2 + ROAD / 2 + 1, d2 + 26, 'lamp');
        streetLamp(lp2[0], lp2[1], j * 2 + seg + 2, 5.5);
      }
    }

    // ---- Shibuya scramble: neon curb strips + colored corner lamps ----
    (function shibuyaLights() {
      var stripCols = [0xff5bd8, 0x3fd8ff, 0xff9a3d, 0x7dff8a];
      var stripGeo = new THREE.BoxGeometry(9, 0.28, 0.9);
      var stripGeoV = new THREE.BoxGeometry(0.9, 0.28, 9);
      var corners = [[38, 26], [50, 38], [38, 50], [26, 38]];
      for (var ci2 = 0; ci2 < 4; ci2++) {
        var m = new THREE.MeshBasicMaterial({ color: stripCols[ci2] });
        var s1 = new THREE.Mesh(stripGeo, m);
        s1.position.set(corners[ci2][0], 0.16, corners[ci2][1] - 1.2);
        scene.add(s1);
        var s2 = new THREE.Mesh(stripGeoV, m);
        s2.position.set(corners[ci2][0] + 1.2, 0.16, corners[ci2][1]);
        scene.add(s2);
        // corner lamp in the same neon color, bigger glow — pushed to the
        // sidewalk corner (the raw offset lands ON the crossing road)
        var cl = offRoadPos(corners[ci2][0] + (ci2 % 2 ? 3.5 : -3.5), corners[ci2][1] + (ci2 < 2 ? -3.5 : 3.5), 'lamp');
        streetLamp(cl[0], cl[1], ci2 + 2, 7.5);
      }
      // glowing ring painted on the asphalt around the scramble
      var ring = new THREE.Mesh(new THREE.RingGeometry(11, 12.4, 40),
        new THREE.MeshBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(38, 0.09, 38);
      scene.add(ring);
    })();

    // ---- festival string lights across the sakura streets ----
    (function stringLights() {
      var bulbGeo = new THREE.SphereGeometry(0.24, 8, 6);
      var bulbCols = [0xff7ad9, 0xffd76a, 0x7de8ff];
      var bulbMats = [];
      for (var bc = 0; bc < bulbCols.length; bc++) {
        var bm = new THREE.MeshBasicMaterial({ color: bulbCols[bc], transparent: true, opacity: 1 });
        bulbMats.push(bm);
        DECOR.stringBulbMats.push({ mat: bm, phase: bc * 2.1 });
      }
      var wireGeo = new THREE.CylinderGeometry(0.045, 0.045, 21, 5);
      wireGeo.rotateZ(Math.PI / 2);
      var strPoleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6);
      function stringSpan(cx, cz, horizontal) {
        var g = new THREE.Group();
        var p1 = new THREE.Mesh(strPoleGeo, poleMat); p1.position.set(-10.5, 2.6, 0); g.add(p1);
        var p2 = new THREE.Mesh(strPoleGeo, poleMat); p2.position.set(10.5, 2.6, 0); g.add(p2);
        var wire = new THREE.Mesh(wireGeo, poleMat); wire.position.y = 5.1; g.add(wire);
        for (var b = 0; b < 8; b++) {
          var bx = -9 + b * 2.6;
          var sag = 5.05 - Math.sin((b / 7) * Math.PI) * 0.55;
          var bulb = new THREE.Mesh(bulbGeo, bulbMats[b % 3]);
          bulb.position.set(bx, sag, 0);
          g.add(bulb);
          var glow = new THREE.Sprite(lampGlowMats[b % LAMP_COLORS.length]);
          glow.scale.set(1.6, 1.6, 1);
          glow.position.set(bx, sag, 0);
          g.add(glow);
        }
        g.position.set(cx, 0, cz);
        if (horizontal) g.rotation.y = Math.PI / 2;
        scene.add(g);
      }
      // across road x=-38 (sakura street), and across road z=114
      stringSpan(-38, -100, false);
      stringSpan(-38, 0, false);
      stringSpan(-38, 100, false);
      stringSpan(-100, 114, true);
      stringSpan(0, 114, true);
      stringSpan(100, 114, true);
    })();

    // ---- a few real point lights so the colored glow spills onto buildings ----
    (function realLights() {
      var pl1 = new THREE.PointLight(0xffb36b, 1.1, 60);
      pl1.position.set(38, 9, 38);
      scene.add(pl1);
      var pl2 = new THREE.PointLight(0x9fd8ff, 0.8, 50);
      pl2.position.set(0, 8, 0);
      scene.add(pl2);
      var pl3 = new THREE.PointLight(0xff7ad9, 0.9, 55);
      pl3.position.set(-38, 8, 40);
      scene.add(pl3);
    })();

    // ---- traffic lights (animated, at 4 intersections) ----
    var tlMats = {
      red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
      redDim: new THREE.MeshBasicMaterial({ color: 0x551010 }),
      yellow: new THREE.MeshBasicMaterial({ color: 0xffd76a }),
      yellowDim: new THREE.MeshBasicMaterial({ color: 0x554410 }),
      green: new THREE.MeshBasicMaterial({ color: 0x3dff7a }),
      greenDim: new THREE.MeshBasicMaterial({ color: 0x104420 })
    };
    var tlPoleGeo = new THREE.CylinderGeometry(0.14, 0.18, 5.5, 6);
    var tlHeadGeo = new THREE.BoxGeometry(0.7, 1.7, 0.5);
    var tlLightGeo = new THREE.CircleGeometry(0.22, 10);
    function trafficLight(x, z, faceRy, dir) {
      var g = new THREE.Group();
      var pole = new THREE.Mesh(tlPoleGeo, poleMat);
      pole.position.y = 2.75; g.add(pole);
      var head = new THREE.Mesh(tlHeadGeo, new THREE.MeshLambertMaterial({ color: 0x1c1c22 }));
      head.position.y = 5.9; g.add(head);
      var r = new THREE.Mesh(tlLightGeo, tlMats.redDim); r.position.set(0, 6.4, 0.27); g.add(r);
      var y = new THREE.Mesh(tlLightGeo, tlMats.yellowDim); y.position.set(0, 5.9, 0.27); g.add(y);
      var gr = new THREE.Mesh(tlLightGeo, tlMats.greenDim); gr.position.set(0, 5.4, 0.27); g.add(gr);
      g.position.set(x, 0, z);
      g.rotation.y = faceRy;
      scene.add(g);
      DECOR.trafficHeads.push({ r: r, y: y, g: gr, dir: dir, mats: tlMats });
    }
    var TL_SPOTS = [[38, 38], [-38, -38], [114, -38], [-38, 114]];
    G.trafficLightSpots = TL_SPOTS; // intersections with lights (game.js reads this)
    for (var ti = 0; ti < TL_SPOTS.length; ti++) {
      var tc = TL_SPOTS[ti];
      trafficLight(tc[0] - 10, tc[1] - 10, 0, 'ns');
      trafficLight(tc[0] + 10, tc[1] + 10, -Math.PI / 2, 'ew');
    }

    // ---- traffic cones ----
    var coneGeo = new THREE.ConeGeometry(0.5, 1.1, 8);
    var coneMat = new THREE.MeshLambertMaterial({ color: 0xff6a2a });
    for (var q = 0; q < 26; q++) {
      var cone = new THREE.Mesh(coneGeo, coneMat);
      var cx = rpick(roadCenters) + rrange(-5, 5), cz = rpick(roadCenters) + rrange(-5, 5);
      cone.position.set(cx, 0.55, cz);
      scene.add(cone);
    }

    // ---- benches, trash cans, hydrants, mailboxes ----
    var woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
    var benchSeatGeo = new THREE.BoxGeometry(2.0, 0.15, 0.6);
    var benchBackGeo = new THREE.BoxGeometry(2.0, 0.7, 0.12);
    var benchLegGeo = new THREE.BoxGeometry(0.14, 0.55, 0.55);
    function bench(x, z, ry) {
      var g = new THREE.Group();
      var seat = new THREE.Mesh(benchSeatGeo, woodMat); seat.position.y = 0.55; g.add(seat);
      var back = new THREE.Mesh(benchBackGeo, woodMat); back.position.set(0, 1.0, -0.28); g.add(back);
      var l1 = new THREE.Mesh(benchLegGeo, poleMat); l1.position.set(-0.8, 0.28, 0); g.add(l1);
      var l2 = new THREE.Mesh(benchLegGeo, poleMat); l2.position.set(0.8, 0.28, 0); g.add(l2);
      g.position.set(x, 0, z); g.rotation.y = ry || 0;
      scene.add(g);
    }
    var canGeo = new THREE.CylinderGeometry(0.35, 0.3, 0.9, 8);
    var canMat = new THREE.MeshLambertMaterial({ color: 0x3a5a3a });
    function trashCan(x, z) {
      var m = new THREE.Mesh(canGeo, canMat);
      m.position.set(x, 0.45, z);
      scene.add(m);
    }
    var hydMat = new THREE.MeshLambertMaterial({ color: 0xd63030 });
    var hydBodyGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.8, 8);
    var hydTopGeo = new THREE.SphereGeometry(0.28, 8, 6);
    function hydrant(x, z) {
      var g = new THREE.Group();
      var b = new THREE.Mesh(hydBodyGeo, hydMat); b.position.y = 0.4; g.add(b);
      var t = new THREE.Mesh(hydTopGeo, hydMat); t.position.y = 0.85; g.add(t);
      g.position.set(x, 0, z);
      scene.add(g);
    }
    var mailMat = new THREE.MeshLambertMaterial({ color: 0xc22e2e });
    function mailbox(x, z) {
      var g = new THREE.Group();
      var b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.6), mailMat);
      b.position.y = 0.85; g.add(b);
      var top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 8), mailMat);
      top.rotation.x = Math.PI / 2; top.position.y = 1.35; g.add(top);
      g.position.set(x, 0, z);
      scene.add(g);
    }
    var benchSpots = [
      [-48.5, 20, 0], [48.5, -60, Math.PI], [-20, -48.5, 0], [20, 48.5, Math.PI],
      [-104, 60, 0], [124, -20, Math.PI], [60, 104, 0], [-60, -104, Math.PI],
      [104, 124, 0], [-124, -104, Math.PI], [24, 28, 0], [-24, -28, Math.PI],
      [150, 48.5, Math.PI], [-150, -48.5, 0]
    ];
    for (var bi = 0; bi < benchSpots.length; bi++) { var bsp = offRoadPos(benchSpots[bi][0], benchSpots[bi][1], 'bench'); bench(bsp[0], bsp[1], benchSpots[bi][2]); }
    for (var ci = 0; ci < 16; ci++) {
      var crc = rpick(roadCenters);
      var tp;
      if (rnd() < 0.5) tp = offRoadPos(rrange(-HALF, HALF), crc + (rnd() < 0.5 ? -10.5 : 10.5), 'trash');
      else tp = offRoadPos(crc + (rnd() < 0.5 ? -10.5 : 10.5), rrange(-HALF, HALF), 'trash');
      trashCan(tp[0], tp[1]);
    }
    var hydSpots = [[-48.5, -80], [48.5, 80], [-80, -48.5], [80, 48.5], [-124, 40], [124, -60], [40, 124], [-40, -124]];
    for (var hi = 0; hi < hydSpots.length; hi++) { var hsp = offRoadPos(hydSpots[hi][0], hydSpots[hi][1], 'hydrant'); hydrant(hsp[0], hsp[1]); }
    var mailSpots = [[-48.5, 140], [48.5, -140], [140, 48.5], [-140, -48.5]];
    for (var mi = 0; mi < mailSpots.length; mi++) { var msp = offRoadPos(mailSpots[mi][0], mailSpots[mi][1], 'mailbox'); mailbox(msp[0], msp[1]); }

    // ---- bus stops ----
    function busStop(x, z, ry) {
      var g = new THREE.Group();
      var postGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.6, 6);
      var p1 = new THREE.Mesh(postGeo, poleMat); p1.position.set(-1.5, 1.3, 0); g.add(p1);
      var p2 = new THREE.Mesh(postGeo, poleMat); p2.position.set(1.5, 1.3, 0); g.add(p2);
      var roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 1.7), new THREE.MeshLambertMaterial({ color: 0x2e7dc2 }));
      roof.position.y = 2.65; g.add(roof);
      var seat = new THREE.Mesh(benchSeatGeo, woodMat); seat.position.y = 0.55; g.add(seat);
      var sign = labelSprite('BUS', '#7df3ff');
      sign.scale.set(2.4, 1.2, 1);
      sign.position.set(1.9, 3.1, 0);
      g.add(sign);
      g.position.set(x, 0, z); g.rotation.y = ry || 0;
      scene.add(g);
    }
    var bsA = offRoadPos(-48.5, 100, 'busstop'); busStop(bsA[0], bsA[1], 0);
    var bsB = offRoadPos(100, 48.5, 'busstop'); busStop(bsB[0], bsB[1], Math.PI / 2);

    // ---- hedges, bushes, flower beds, grass ----
    var hedgeMat = new THREE.MeshLambertMaterial({ color: 0x2e5a2e });
    var hedgeGeo = new THREE.BoxGeometry(3, 0.9, 0.9);
    for (var hg = 0; hg < 6; hg++) {
      var h1 = new THREE.Mesh(hedgeGeo, hedgeMat);
      h1.position.set(-21 + hg * 8.4, 0.45, -28.5); scene.add(h1);
      var h2 = new THREE.Mesh(hedgeGeo, hedgeMat);
      h2.position.set(-21 + hg * 8.4, 0.45, 28.5); scene.add(h2);
    }
    var bushGeo = new THREE.SphereGeometry(1, 8, 6);
    var bushMat = new THREE.MeshLambertMaterial({ color: 0x3d6b34 });
    for (var bu = 0; bu < 24; bu++) {
      var bush = new THREE.Mesh(bushGeo, bushMat);
      var brc = rpick(roadCenters);
      var bp;
      if (rnd() < 0.5) bp = offRoadPos(rrange(-HALF, HALF), brc + (rnd() < 0.5 ? -11 : 11), 'bush');
      else bp = offRoadPos(brc + (rnd() < 0.5 ? -11 : 11), rrange(-HALF, HALF), 'bush');
      bush.position.set(bp[0], 0.5, bp[1]);
      bush.scale.setScalar(rrange(0.7, 1.3));
      scene.add(bush);
    }
    var flowerMat = new THREE.MeshLambertMaterial({ map: flowerTexture() });
    var flowerGeo = new THREE.BoxGeometry(2.2, 0.25, 1.3);
    for (var fl = 0; fl < 12; fl++) {
      var fb = new THREE.Mesh(flowerGeo, flowerMat);
      var frc = rpick(roadCenters);
      var fp;
      if (rnd() < 0.5) fp = offRoadPos(rrange(-HALF, HALF), frc + (rnd() < 0.5 ? -11 : 11), 'flower');
      else fp = offRoadPos(frc + (rnd() < 0.5 ? -11 : 11), rrange(-HALF, HALF), 'flower');
      fb.position.set(fp[0], 0.13, fp[1]);
      fb.rotation.y = rnd() * Math.PI;
      scene.add(fb);
    }
    var grassGeo = new THREE.CircleGeometry(1, 12);
    var grassMat = new THREE.MeshLambertMaterial({ color: 0x4a7a3d });
    for (var gr = 0; gr < 16; gr++) {
      var gp = new THREE.Mesh(grassGeo, grassMat);
      var grc = rpick(roadCenters);
      var gp2;
      if (rnd() < 0.5) gp2 = offRoadPos(rrange(-HALF, HALF), grc + (rnd() < 0.5 ? -11 : 11), 'grass');
      else gp2 = offRoadPos(grc + (rnd() < 0.5 ? -11 : 11), rrange(-HALF, HALF), 'grass');
      gp.position.set(gp2[0], 0.06, gp2[1]);
      gp.rotation.x = -Math.PI / 2;
      gp.scale.setScalar(rrange(1.2, 2.4));
      scene.add(gp);
    }

    // ---- vending machines on sidewalks ----
    var vmSpots = [[-48.5, 40], [48.5, -100], [-100, -48.5], [100, 48.5], [-140, 20], [140, -20], [20, -48.5], [-20, 48.5], [60, -48.5], [-60, 48.5]];
    for (var vi = 0; vi < vmSpots.length; vi++) {
      var vp = offRoadPos(vmSpots[vi][0], vmSpots[vi][1], 'vending');
      vendingMachine(scene, vp[0], vp[1], vi % 2 ? '#2e7dc2' : '#d63030');
    }

    // ---- TORII gate + stone lanterns in the central plaza park ----
    (function torii() {
      var red = new THREE.MeshLambertMaterial({ color: 0xd63030 });
      var dark = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
      var px = -22, pz = -22;
      var p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 6.5, 8), red);
      p1.position.set(px - 3, 3.25, pz); scene.add(p1);
      var p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 6.5, 8), red);
      p2.position.set(px + 3, 3.25, pz); scene.add(p2);
      var beamTop = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.7, 0.9), red);
      beamTop.position.set(px, 6.4, pz); scene.add(beamTop);
      var beam2 = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.55, 0.7), red);
      beam2.position.set(px, 5.3, pz); scene.add(beam2);
      var plaque = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.35), dark);
      plaque.position.set(px, 5.85, pz); scene.add(plaque);
      addCollider(px - 3.5, pz - 0.6, px - 2.5, pz + 0.6, 6.5);
      addCollider(px + 2.5, pz - 0.6, px + 3.5, pz + 0.6, 6.5);
      // stone lanterns (toro) flanking the path
      var stoneMat = new THREE.MeshLambertMaterial({ color: 0x9a9a92 });
      var glowMat2 = new THREE.MeshLambertMaterial({ color: 0xffd98a, emissive: 0x664411 });
      function stoneLantern(x, z) {
        var g = new THREE.Group();
        var base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.7), stoneMat); base.position.y = 0.15; g.add(base);
        var pil = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.28), stoneMat); pil.position.y = 0.75; g.add(pil);
        var box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), glowMat2); box.position.y = 1.45; g.add(box);
        var roof = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.45, 4), stoneMat); roof.position.y = 1.9; roof.rotation.y = Math.PI / 4; g.add(roof);
        g.position.set(x, 0, z);
        scene.add(g);
      }
      stoneLantern(px - 4.5, pz + 4);
      stoneLantern(px + 4.5, pz + 4);
      stoneLantern(px - 4.5, pz - 4);
      stoneLantern(px + 4.5, pz - 4);
    })();

    // ---- chochin paper lanterns along the alley (north edge of block 1,2) ----
    (function chochin() {
      var wire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 48, 5), poleMat);
      wire.rotation.z = Math.PI / 2;
      wire.position.set(-76, 3.7, -29);
      scene.add(wire);
      var lanternGeo = new THREE.SphereGeometry(0.55, 10, 8);
      var lanternMats = [
        new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0x551100 }),
        new THREE.MeshLambertMaterial({ color: 0xff9500, emissive: 0x552200 })
      ];
      DECOR.lanterns = [];
      for (var i = 0; i < 8; i++) {
        var lx = -96 + i * 6;
        var l = new THREE.Mesh(lanternGeo, lanternMats[i % 2]);
        l.scale.set(1, 1.25, 1);
        l.position.set(lx, 3.0, -29);
        l.userData.baseX = lx;
        l.userData.phase = i * 0.9;
        scene.add(l);
        DECOR.lanterns.push(l);
        var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 6), poleMat);
        cap.position.set(lx, 3.72, -29);
        scene.add(cap);
      }
    })();

    // ---- ramen cart (yatai) on the sidewalk near the konbini ----
    (function ramenCart() {
      var g = new THREE.Group();
      var wood = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
      var body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.2), wood);
      body.position.y = 0.85; g.add(body);
      var counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.4), new THREE.MeshLambertMaterial({ color: 0x5a3a22 }));
      counter.position.y = 1.4; g.add(counter);
      var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.35, 10), new THREE.MeshLambertMaterial({ color: 0x3a3a42 }));
      pot.position.set(-0.5, 1.6, 0); g.add(pot);
      var steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
      var st1 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), steamMat);
      st1.position.set(-0.5, 2.1, 0); g.add(st1);
      var st2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), steamMat);
      st2.position.set(-0.4, 2.5, 0.1); g.add(st2);
      var wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.15, 10);
      wheelGeo.rotateX(Math.PI / 2);
      var w1 = new THREE.Mesh(wheelGeo, poleMat); w1.position.set(0, 0.4, 0.65); g.add(w1);
      var w2 = new THREE.Mesh(wheelGeo, poleMat); w2.position.set(0, 0.4, -0.65); g.add(w2);
      var postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 5);
      var pa = new THREE.Mesh(postGeo, poleMat); pa.position.set(-1.0, 2.1, 0.6); g.add(pa);
      var pb = new THREE.Mesh(postGeo, poleMat); pb.position.set(-1.0, 2.1, -0.6); g.add(pb);
      var pc = new THREE.Mesh(postGeo, poleMat); pc.position.set(1.0, 2.1, 0.6); g.add(pc);
      var pd = new THREE.Mesh(postGeo, poleMat); pd.position.set(1.0, 2.1, -0.6); g.add(pd);
      var awn = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.7), new THREE.MeshLambertMaterial({ map: awningTexture('#d63030', '#f2f2f2') }));
      awn.position.y = 2.85; g.add(awn);
      var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0x551100 }));
      lamp.scale.set(1, 1.25, 1);
      lamp.position.set(1.35, 2.2, 0); g.add(lamp);
      var sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 0.75),
        new THREE.MeshBasicMaterial({ map: neonTexture('ラーメン', 'RAMEN', '#ff5b3d', false), transparent: true, fog: false })
      );
      sign.position.set(-1.12, 1.0, 0);
      sign.rotation.y = -Math.PI / 2;
      g.add(sign);
      g.position.set(48, 0, 70);
      scene.add(g);
      addCollider(47, 69, 49, 71, 3);
    })();

    // ---- parked bicycles ----
    (function bicycles() {
      var frameMat = new THREE.MeshLambertMaterial({ color: 0x2e7dc2 });
      var tireGeo = new THREE.TorusGeometry(0.35, 0.05, 6, 12);
      var tireMat = new THREE.MeshLambertMaterial({ color: 0x16161c });
      var barGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5);
      var spots = [[-48.5, 20], [48.5, -20], [-20, 104], [104, -48.5], [20, -48.5]];
      for (var i = 0; i < spots.length; i++) {
        var g = new THREE.Group();
        var w1 = new THREE.Mesh(tireGeo, tireMat); w1.position.set(-0.55, 0.35, 0); g.add(w1);
        var w2 = new THREE.Mesh(tireGeo, tireMat); w2.position.set(0.55, 0.35, 0); g.add(w2);
        var f1 = new THREE.Mesh(barGeo, frameMat); f1.position.set(0, 0.55, 0); f1.rotation.z = 1.1; g.add(f1);
        var f2 = new THREE.Mesh(barGeo, frameMat); f2.position.set(0.15, 0.7, 0); f2.rotation.z = -0.5; g.add(f2);
        var seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.15), tireMat);
        seat.position.set(-0.25, 0.95, 0); g.add(seat);
        var bc = offRoadPos(spots[i][0], spots[i][1], 'bicycle');
        g.position.set(bc[0], 0, bc[1]);
        g.rotation.y = rnd() * Math.PI;
        scene.add(g);
      }
    })();
  }

  // ---------------- beach + pier + ocean life ----------------
  function buildBeach(scene) {
    var poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2c34 });

    // WIDE BEACH: big textured sand plane from the city edge (x=200) to the
    // new waterline (x=258) — cars and players can drive/walk all over it
    // (bounds in game.js moved to HALF+52 = 250).
    var sandTex = sandTexture();
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(2, 14);
    var beachSand = new THREE.Mesh(
      new THREE.PlaneGeometry(58, WORLD),
      new THREE.MeshLambertMaterial({ map: sandTex })
    );
    beachSand.rotation.x = -Math.PI / 2;
    beachSand.position.set(229, 0.06, 0);
    scene.add(beachSand);

    // animated shoreline foam strips (slide + pulse in updateDecorations)
    (function waves() {
      var foamTex = foamTexture();
      var foamGeo = new THREE.PlaneGeometry(7, WORLD);
      for (var w = 0; w < 3; w++) {
        var fm = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({
          map: foamTex, transparent: true, opacity: 0.55 + w * 0.1, depthWrite: false, side: THREE.DoubleSide
        }));
        fm.rotation.x = -Math.PI / 2;
        fm.position.set(260 + w * 3.5, 0.1 + w * 0.02, 0);
        scene.add(fm);
        DECOR.waves.push({ mesh: fm, phase: w * 2.1, baseX: 260 + w * 3.5 });
      }
    })();

    // beach umbrellas + towels (16, spread across the wide sand)
    var umbGeo = new THREE.ConeGeometry(2.6, 1.4, 8);
    var umbMats = [new THREE.MeshLambertMaterial({ color: 0xff5b7a }), new THREE.MeshLambertMaterial({ color: 0x3fb8ff }), new THREE.MeshLambertMaterial({ color: 0xffd76a }), new THREE.MeshLambertMaterial({ color: 0x7dff8a }), new THREE.MeshLambertMaterial({ color: 0xc9a0ff })];
    var towelCols = [0xff5b7a, 0x3fb8ff, 0xffd76a, 0x7ddb8a, 0xc9a0ff];
    for (var u = 0; u < 16; u++) {
      var ux = HALF + 12 + rrange(0, 34), uz = -HALF + 22 + u * 24 + rrange(-6, 6);
      var up = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), poleMat);
      up.position.set(ux, 1.3, uz); scene.add(up);
      var um = new THREE.Mesh(umbGeo, umbMats[u % 5]);
      um.position.set(ux, 3.0, uz); scene.add(um);
      var towel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.9), new THREE.MeshLambertMaterial({ color: towelCols[u % 5] }));
      towel.position.set(ux + 2.5, 0.1, uz + 1.5);
      towel.rotation.y = rnd() * Math.PI;
      scene.add(towel);
    }

    // beach balls
    var ballCols = [0xff5b7a, 0x3fb8ff, 0xffd76a, 0x7ddb8a, 0xff9a3d, 0xc9a0ff];
    var ballGeo = new THREE.SphereGeometry(0.55, 10, 8);
    for (var bb = 0; bb < 6; bb++) {
      var ball = new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ color: ballCols[bb % 6] }));
      ball.position.set(HALF + 16 + rrange(0, 26), 0.55, -HALF + 40 + bb * 62 + rrange(-8, 8));
      scene.add(ball);
    }

    // sandcastles (cone + bucket + flag)
    for (var sc = 0; sc < 4; sc++) {
      var sx = HALF + 18 + rrange(0, 22), sz = -HALF + 60 + sc * 85 + rrange(-10, 10);
      var castle = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 0.9, 8), new THREE.MeshLambertMaterial({ color: 0xdcb877 }));
      castle.position.set(sx, 0.45, sz); scene.add(castle);
      var tower = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.3, 8), new THREE.MeshLambertMaterial({ color: 0xe8c98f }));
      tower.position.set(sx, 1.5, sz); scene.add(tower);
      var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ color: 0xff5b7a, side: THREE.DoubleSide }));
      flag.position.set(sx + 0.4, 2.3, sz); scene.add(flag);
    }

    // beach chairs near the umbrellas
    for (var bc = 0; bc < 6; bc++) {
      var chx = HALF + 16 + rrange(0, 24), chz = -HALF + 55 + bc * 58 + rrange(-8, 8);
      var chair = new THREE.Group();
      var seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 1.6), new THREE.MeshLambertMaterial({ color: ballCols[bc % 6] }));
      seat.position.y = 0.35; chair.add(seat);
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.1), new THREE.MeshLambertMaterial({ color: ballCols[bc % 6] }));
      back.position.set(0, 0.8, -0.8); back.rotation.x = -0.5; chair.add(back);
      var legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.35, 5);
      [[-0.35, -0.7], [0.35, -0.7], [-0.35, 0.7], [0.35, 0.7]].forEach(function (lp) {
        var leg = new THREE.Mesh(legGeo, poleMat);
        leg.position.set(lp[0], 0.17, lp[1]); chair.add(leg);
      });
      chair.position.set(chx, 0, chz);
      chair.rotation.y = rnd() * Math.PI * 2;
      scene.add(chair);
    }

    // beach volleyball net
    (function volleyball() {
      var nx = HALF + 32, nz = -20;
      var netPoleGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.6, 6);
      var np1 = new THREE.Mesh(netPoleGeo, poleMat); np1.position.set(nx, 1.3, nz - 3); scene.add(np1);
      var np2 = new THREE.Mesh(netPoleGeo, poleMat); np2.position.set(nx, 1.3, nz + 3); scene.add(np2);
      var net = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      net.position.set(nx, 2.0, nz);
      net.rotation.y = Math.PI / 2;
      scene.add(net);
      var tape = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 6), new THREE.MeshBasicMaterial({ color: 0xff5b7a }));
      tape.position.set(nx, 2.55, nz);
      scene.add(tape);
      addCollider(nx - 0.3, nz - 3.3, nx + 0.3, nz - 2.7, 2.6);
      addCollider(nx - 0.3, nz + 2.7, nx + 0.3, nz + 3.3, 2.6);
    })();

    // extra palms deeper on the sand
    for (var pb2 = -HALF + 30; pb2 < HALF - 10; pb2 += 34) {
      if (rnd() < 0.8) G.palm(HALF + 30 + rrange(-3, 3), pb2, rrange(0.9, 1.25));
    }

    // boardwalks: wooden paths from the city to the beach (pier + lifeguard)
    (function boardwalks() {
      var bwTex = boardwalkTexture();
      bwTex.wrapS = bwTex.wrapT = THREE.RepeatWrapping;
      bwTex.repeat.set(10, 1);
      var bwMat = new THREE.MeshLambertMaterial({ map: bwTex });
      var bwGeo = new THREE.BoxGeometry(62, 0.12, 2.6);
      [40, -60].forEach(function (bz) {
        var bw = new THREE.Mesh(bwGeo, bwMat);
        bw.position.set(227, 0.06, bz);
        scene.add(bw);
        // side posts
        var postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.0, 6);
        for (var px2 = 200; px2 <= 254; px2 += 9) {
          var q1 = new THREE.Mesh(postGeo, poleMat); q1.position.set(px2, 0.5, bz - 1.5); scene.add(q1);
          var q2 = new THREE.Mesh(postGeo, poleMat); q2.position.set(px2, 0.5, bz + 1.5); scene.add(q2);
        }
      });
    })();

    // beach sign + surfboards at the boardwalk entrance
    (function beachSign() {
      var g = new THREE.Group();
      var postMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
      var p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6), postMat);
      p1.position.set(-1.6, 1.6, 0); g.add(p1);
      var p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6), postMat);
      p2.position.set(1.6, 1.6, 0); g.add(p2);
      var sc2 = makeCanvas(512, 192), sctx = sc2.getContext('2d');
      sctx.fillStyle = '#2e7dc2'; sctx.fillRect(0, 0, 512, 192);
      sctx.fillStyle = '#ffd76a';
      sctx.beginPath(); sctx.arc(70, 60, 34, 0, Math.PI * 2); sctx.fill();
      sctx.fillStyle = '#ffffff';
      sctx.font = 'bold 64px Arial'; sctx.textAlign = 'center';
      sctx.fillText('SOLSTICE', 290, 84);
      sctx.fillText('BEACH', 290, 152);
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(20, 168, 472, 6);
      var board = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.65),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc2), side: THREE.DoubleSide }));
      board.position.y = 3.1;
      g.add(board);
      g.position.set(HALF + 6, 0, 34);
      g.rotation.y = -Math.PI / 2;
      scene.add(g);
      // surfboards leaning on the sign posts
      var surfCols = [0xff5b7a, 0x3fb8ff];
      for (var sb = 0; sb < 2; sb++) {
        var surf = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.6, 0.08),
          new THREE.MeshLambertMaterial({ color: surfCols[sb] }));
        surf.position.set(HALF + 4.6, 1.3, 31.5 + sb * 1.4);
        surf.rotation.z = 0.25;
        surf.rotation.y = -Math.PI / 2;
        scene.add(surf);
      }
    })();

    // lifeguard tower
    (function lifeguard() {
      var g = new THREE.Group();
      var legGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.6, 6);
      var positions = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (var i = 0; i < 4; i++) {
        var leg = new THREE.Mesh(legGeo, poleMat);
        leg.position.set(positions[i][0], 1.8, positions[i][1]);
        leg.rotation.z = -positions[i][0] * 0.12;
        g.add(leg);
      }
      var cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 2.4), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      cabin.position.y = 4.2; g.add(cabin);
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.4, 2.45), new THREE.MeshLambertMaterial({ color: 0xd63030 }));
      stripe.position.y = 4.6; g.add(stripe);
      var roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.0, 4), new THREE.MeshLambertMaterial({ color: 0xd63030 }));
      roof.position.y = 5.7; roof.rotation.y = Math.PI / 4; g.add(roof);
      g.position.set(HALF + 10, 0, -60);
      scene.add(g);
      addCollider(HALF + 8.8, -61.2, HALF + 11.2, -58.8, 5);
    })();

    // boats + yachts in the bay (moved east — the beach is wider now)
    (function boats() {
      var hullMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
      var hullMat2 = new THREE.MeshLambertMaterial({ color: 0xff9a3d });
      var spots = [
        { x: HALF + 80, z: -120, sail: true, mat: hullMat },
        { x: HALF + 105, z: 60, sail: false, mat: hullMat2 },
        { x: HALF + 90, z: 140, sail: false, mat: hullMat },
        { x: HALF + 130, z: -40, sail: true, mat: hullMat2 },
        { x: HALF + 118, z: -160, sail: false, mat: hullMat },
        { x: HALF + 145, z: 100, sail: true, mat: hullMat }
      ];
      for (var i = 0; i < spots.length; i++) {
        var s = spots[i];
        var g = new THREE.Group();
        var hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 7), s.mat);
        hull.position.y = 0.2; g.add(hull);
        var bow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.2, 4), s.mat);
        bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;
        bow.position.set(0, 0.2, 4.5); g.add(bow);
        var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 2.6), new THREE.MeshLambertMaterial({ color: 0x2c3a5e }));
        cabin.position.set(0, 1.3, -0.5); g.add(cabin);
        if (s.sail) {
          var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6.5, 6), poleMat);
          mast.position.set(0, 3.6, 0.8); g.add(mast);
          var shape = new THREE.Shape();
          shape.moveTo(0, 0); shape.lineTo(0, 5.4); shape.lineTo(3.2, 0.4); shape.lineTo(0, 0);
          var sail = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
          sail.position.set(0.1, 1.2, 0.8);
          g.add(sail);
        }
        g.position.set(s.x, -0.3, s.z);
        g.rotation.y = rnd() * Math.PI * 2;
        scene.add(g);
        DECOR.boats.push({ mesh: g, baseY: -0.3, phase: i * 1.7 });
      }
      // jet skis near the shore
      var jetCols = [0xff5b7a, 0x3fb8ff];
      for (var js = 0; js < 2; js++) {
        var jg = new THREE.Group();
        var jhull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 2.6), new THREE.MeshLambertMaterial({ color: jetCols[js] }));
        jhull.position.y = 0.1; jg.add(jhull);
        var jseat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 1.2), new THREE.MeshLambertMaterial({ color: 0x14141c }));
        jseat.position.set(0, 0.45, -0.4); jg.add(jseat);
        jg.position.set(HALF + 66 + js * 8, -0.25, 90 + js * 24);
        jg.rotation.y = rnd() * Math.PI * 2;
        scene.add(jg);
        DECOR.boats.push({ mesh: jg, baseY: -0.25, phase: 3 + js * 1.3 });
      }
    })();

    // buoys bobbing in the bay (moved east of the new waterline)
    (function buoys() {
      var geo = new THREE.SphereGeometry(0.7, 8, 6);
      var mat = new THREE.MeshLambertMaterial({ color: 0xff6a2a });
      for (var i = 0; i < 6; i++) {
        var b = new THREE.Mesh(geo, mat);
        b.position.set(HALF + 66 + rrange(0, 12), -0.2, -150 + i * 60 + rrange(-8, 8));
        scene.add(b);
        DECOR.buoys.push({ mesh: b, phase: i * 1.3 });
      }
    })();

    // pier (east, into the ocean) + lamps, benches, fishing rods.
    // Extended past the wider beach so its end is in the water again.
    var plankMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
    for (var p = 0; p < 26; p++) {
      var plank = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 3), plankMat);
      plank.position.set(HALF + 14 + p * 3.2, 0.8, 40);
      scene.add(plank);
    }
    var pierPost = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 6), poleMat);
    pierPost.position.set(HALF + 14 + 25 * 3.2, -0.4, 37.5); scene.add(pierPost);
    var pierPost2 = pierPost.clone(); pierPost2.position.z = 42.5; scene.add(pierPost2);
    var pierLampGeo = new THREE.CylinderGeometry(0.1, 0.13, 3.4, 6);
    var pierBulbGeo = new THREE.SphereGeometry(0.4, 8, 6);
    var pierBulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    var pierGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0.55, depthWrite: false });
    for (var pl2 = 0; pl2 < 5; pl2++) {
      var px = HALF + 22 + pl2 * 16;
      var lp = new THREE.Mesh(pierLampGeo, poleMat);
      lp.position.set(px, 2.5, 38.2); scene.add(lp);
      var lb = new THREE.Mesh(pierBulbGeo, pierBulbMat);
      lb.position.set(px, 4.3, 38.2); scene.add(lb);
      var lg = new THREE.Sprite(pierGlowMat);
      lg.scale.set(4, 4, 1);
      lg.position.set(px, 4.3, 38.2);
      scene.add(lg);
    }
    // fishing rods leaning over the pier edge (near the pier end now)
    var rodGeo = new THREE.CylinderGeometry(0.035, 0.05, 3.2, 5);
    for (var fr = 0; fr < 2; fr++) {
      var rod = new THREE.Mesh(rodGeo, poleMat);
      rod.position.set(HALF + 84 + fr * 4, 2.2, 42.6);
      rod.rotation.x = 0.7;
      scene.add(rod);
    }
    // crates near the pier start
    var crateMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
    for (var cr = 0; cr < 3; cr++) {
      var crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), crateMat);
      crate.position.set(HALF + 12 + cr * 1.2, 0.55 + (cr === 2 ? 1.1 : 0), 45 + (cr === 2 ? 0.5 : 0));
      crate.rotation.y = rnd() * 0.6;
      scene.add(crate);
    }
  }

  // ---------------- seagulls + news heli ----------------
  function buildSkyLife(scene) {
    // seagulls over the bay
    var wingGeo = new THREE.PlaneGeometry(1.3, 0.45);
    wingGeo.translate(0.65, 0, 0);
    var wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    var bodyGeo = new THREE.SphereGeometry(0.32, 6, 5);
    var bodyMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    for (var i = 0; i < 6; i++) {
      var g = new THREE.Group();
      var body = new THREE.Mesh(bodyGeo, bodyMat);
      body.scale.set(0.7, 0.55, 1.6);
      g.add(body);
      var wl = new THREE.Mesh(wingGeo, wingMat);
      wl.rotation.y = Math.PI;
      g.add(wl);
      var wr = new THREE.Mesh(wingGeo, wingMat);
      g.add(wr);
      scene.add(g);
      DECOR.gulls.push({
        mesh: g, wingL: wl, wingR: wr,
        cx: HALF + 60 + rrange(-15, 25), cz: rrange(-140, 140),
        r: rrange(14, 38), y: rrange(22, 38),
        angle: rnd() * Math.PI * 2, speed: rrange(0.15, 0.3)
      });
    }
    // news / TV helicopter orbiting the city
    var news = makeHeliMesh(0xf2f2f2, 'NEWS', 0xd63030);
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false }));
    beacon.position.set(0, 2.6, 0);
    news.add(beacon);
    DECOR.beacons.push(beacon);
    scene.add(news);
    if (news.userData.labelPlane) { scene.add(news.userData.labelPlane); DECOR.heliLabels.push(news); }
    DECOR.newsHeli = news;
    DECOR.newsAngle = 0;
  }

  // ---------------- monorail (west edge, over the sunset) ----------------
  function buildMonorail(scene) {
    var pillarMat = new THREE.MeshLambertMaterial({ color: 0x6a6a72 });
    var pillarGeo = new THREE.BoxGeometry(1.4, 12, 1.4);
    for (var i = 0; i < 15; i++) {
      var z = -182 + i * 26;
      var p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(-212, 6, z);
      scene.add(p);
      addCollider(-212.8, z - 0.8, -211.2, z + 0.8, 12);
    }
    var beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 380), new THREE.MeshLambertMaterial({ color: 0x8a8a92 }));
    beam.position.set(-212, 12.6, 0);
    scene.add(beam);
    // train: 3 cars
    var train = new THREE.Group();
    var carMat = new THREE.MeshLambertMaterial({ map: trainTexture() });
    var carGeo = new THREE.BoxGeometry(3, 2.8, 8);
    for (var c = 0; c < 3; c++) {
      var car = new THREE.Mesh(carGeo, carMat);
      car.position.set(0, 0, -c * 8.8);
      train.add(car);
    }
    var head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.2), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    head.position.set(0, -0.6, 4.1);
    train.add(head);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.2), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    tail.position.set(0, -0.6, -17.7);
    train.add(tail);
    train.position.set(-212, 14.6, -100);
    scene.add(train);
    DECOR.train = train;
    DECOR.trainDir = 1;
  }

  // ---------------- per-frame decoration animation ----------------
  function updateDecorations(dt) {
    DECOR.time += dt;
    var t = DECOR.time;
    var i;
    // seagulls
    for (i = 0; i < DECOR.gulls.length; i++) {
      var gl = DECOR.gulls[i];
      gl.angle += gl.speed * dt;
      gl.mesh.position.set(gl.cx + Math.cos(gl.angle) * gl.r, gl.y + Math.sin(t * 0.7 + i) * 1.5, gl.cz + Math.sin(gl.angle) * gl.r);
      gl.mesh.rotation.y = -gl.angle;
      var flap = Math.sin(t * 7 + i * 1.7) * 0.55;
      gl.wingL.rotation.z = flap;
      gl.wingR.rotation.z = -flap;
    }
    // buoys + boats bob
    for (i = 0; i < DECOR.buoys.length; i++) {
      var by = DECOR.buoys[i];
      by.mesh.position.y = -0.2 + Math.sin(t * 1.4 + by.phase) * 0.3;
      by.mesh.rotation.x = Math.sin(t * 1.1 + by.phase) * 0.12;
    }
    for (i = 0; i < DECOR.boats.length; i++) {
      var bt = DECOR.boats[i];
      bt.mesh.position.y = bt.baseY + Math.sin(t * 0.9 + bt.phase) * 0.3;
      bt.mesh.rotation.z = Math.sin(t * 0.6 + bt.phase) * 0.02;
    }
    // clouds drift
    for (i = 0; i < DECOR.clouds.length; i++) {
      var cl = DECOR.clouds[i];
      cl.position.x += 1.2 * dt;
      if (cl.position.x > 420) cl.position.x = -420;
    }
    // monorail train (ping-pong along the west edge)
    if (DECOR.train) {
      var tr = DECOR.train;
      tr.position.z += DECOR.trainDir * 16 * dt;
      if (tr.position.z > 175) { tr.position.z = 175; DECOR.trainDir = -1; tr.rotation.y = Math.PI; }
      else if (tr.position.z < -175) { tr.position.z = -175; DECOR.trainDir = 1; tr.rotation.y = 0; }
    }
    // news heli orbit + rotor
    if (DECOR.newsHeli) {
      DECOR.newsAngle += 0.05 * dt;
      var nh = DECOR.newsHeli;
      nh.position.set(Math.cos(DECOR.newsAngle) * 150, 62, Math.sin(DECOR.newsAngle) * 150);
      nh.rotation.y = -DECOR.newsAngle;
      if (nh.userData.rotor) nh.userData.rotor.rotation.y += dt * 25;
      if (nh.userData.tailRotor) nh.userData.tailRotor.rotation.z += dt * 30;
    }
    // heli labels (news + parked rescue): scene-parented billboards, face the camera
    for (var li = 0; li < DECOR.heliLabels.length; li++) G.billboardHeliLabel(DECOR.heliLabels[li]);
    // sakura petals fall + drift
    if (DECOR.petals) {
      var pos = DECOR.petals.geometry.attributes.position.array;
      for (i = 0; i < pos.length; i += 3) {
        pos[i + 1] -= 0.55 * dt;
        pos[i] += Math.sin(t * 0.8 + DECOR.petalPhase[i / 3]) * 0.35 * dt;
        if (pos[i + 1] < 0.3) {
          pos[i + 1] = 8;
          pos[i] = rrange(-HALF, HALF);
          pos[i + 2] = rrange(-HALF, HALF);
        }
      }
      DECOR.petals.geometry.attributes.position.needsUpdate = true;
    }
    // shoreline foam: waves wash in and out of the waterline
    for (i = 0; i < DECOR.waves.length; i++) {
      var wv = DECOR.waves[i];
      wv.mesh.position.x = wv.baseX + Math.sin(t * 0.5 + wv.phase) * 2.2;
      wv.mesh.material.opacity = 0.5 + Math.sin(t * 0.5 + wv.phase + 0.8) * 0.22;
    }
    // festival string lights: gentle twinkle (per-color materials)
    for (i = 0; i < DECOR.stringBulbMats.length; i++) {
      var sbm = DECOR.stringBulbMats[i];
      sbm.mat.opacity = 0.82 + Math.sin(t * 2.2 + sbm.phase) * 0.18;
    }
    // traffic lights cycle (4s per phase); freezeLights pins one phase
    // (headless test uses it to stage a deterministic red light)
    if (DECOR.trafficHeads.length) {
      var cyc = DECOR.freezeLights ? DECOR.frozenState : Math.floor(t / 4) % 4;
      if (cyc !== DECOR.trafficState) {
        DECOR.trafficState = cyc;
        for (i = 0; i < DECOR.trafficHeads.length; i++) {
          var hd = DECOR.trafficHeads[i], m = hd.mats;
          var nsGreen = (cyc === 0), nsYellow = (cyc === 1);
          var ewGreen = (cyc === 2), ewYellow = (cyc === 3);
          var redOn, yelOn, grnOn;
          if (hd.dir === 'ns') { redOn = !(nsGreen || nsYellow); yelOn = nsYellow; grnOn = nsGreen; }
          else { redOn = !(ewGreen || ewYellow); yelOn = ewYellow; grnOn = ewGreen; }
          hd.r.material = redOn ? m.red : m.redDim;
          hd.y.material = yelOn ? m.yellow : m.yellowDim;
          hd.g.material = grnOn ? m.green : m.greenDim;
        }
      }
    }
    // neon flicker (occasional dropout)
    for (i = 0; i < DECOR.neonFlicker.length; i++) {
      var nm = DECOR.neonFlicker[i];
      nm.opacity = (Math.random() < 0.05) ? 0.55 : 1;
    }
    // rooftop / tower beacons blink
    for (i = 0; i < DECOR.beacons.length; i++) {
      DECOR.beacons[i].visible = ((t * 1.4 + i * 0.37) % 1) < 0.55;
    }
    // paper lanterns sway
    if (DECOR.lanterns) {
      for (i = 0; i < DECOR.lanterns.length; i++) {
        var ln = DECOR.lanterns[i];
        ln.position.x = ln.userData.baseX + Math.sin(t * 0.9 + ln.userData.phase) * 0.1;
        ln.rotation.z = Math.sin(t * 0.9 + ln.userData.phase) * 0.06;
      }
    }
  }
  G.updateDecorations = updateDecorations;

  G.initWorld = initWorld;
})();

