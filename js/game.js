/* SOLSTICE BAY — game.js
   Core gameplay. Physics model (from researched patterns):
   - Arcade 2D car: velocity split into forward vF / lateral vL in car frame.
     Engine force scaled near max speed; lateral grip vL *= (1-grip*dt),
     grip 13 normal / 1.8 handbrake (drift); yaw = vF/wheelbase * tan(steer)
     (kinematic bicycle model); steer eases, max shrinks with speed.
   - Collision: circle vs AABB minimum-translation push-out + velocity
     reflected along the normal (restitution 0.25) + tangential damping,
     so cars slide along walls instead of sticking.
   - Wanted: HEAT 0-100 -> 0-5 stars; decays after 18s clean, never while
     a cop is near; BUSTED on arrest / health 0.
   All code written from scratch. */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  var THREE = window.THREE;

  // ---------------- errors surface (for headless test) ----------------
  G.errors = [];
  window.addEventListener('error', function (e) { G.errors.push(String(e.message || e.error)); });

  // ---------------- save ----------------
  var SAVE_KEY = 'solstice-bay-save-v1';
  G.save = { money: 1200, missionsDone: [], bestScore: 0 };
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (raw) { var s = JSON.parse(raw); if (s && typeof s.money === 'number') G.save = s; }
  } catch (e) { /* storage unavailable - play session-only */ }
  G.persist = function () {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.save)); } catch (e) { /* ignore */ }
  };

  // ---------------- renderer / scene / camera ----------------
  // ?test=1 lowers render cost for headless testing (no AA, half pixels).
  // Gameplay is identical; only rasterization quality changes.
  var TEST_MODE = /[?&]test=1/.test(location.search);
  G.TEST_MODE = TEST_MODE;
  var canvas = document.getElementById('game-canvas');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !TEST_MODE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(TEST_MODE ? 0.5 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  G.renderer = renderer;
  G.initWorld();
  var scene = G.scene;
  var camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 30, 60);
  G.camera = camera;

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------- state ----------------
  G.state = 'menu';            // menu | playing | paused | busted
  G.time = 0;                  // seconds since start
  G.clockMin = 18 * 60 + 14;   // 18:14
  G.day = 1;
  G.money = G.save.money;
  G.health = 100; G.armour = 50;
  G.heat = 0;                  // 0..100
  G.wanted = 0;                // 0..5 stars
  G.cleanTimer = 0;            // seconds since last crime / cop sighting
  G.nitro = 100;
  G.score = 0;

  function starsFromHeat(h) { return h <= 0 ? 0 : Math.min(5, Math.ceil(h / 20)); }
  G.starsFromHeat = starsFromHeat;
  G.addHeat = function (n) {
    var before = G.wanted;
    G.heat = Math.max(0, Math.min(100, G.heat + n));
    G.wanted = starsFromHeat(G.heat);
    G.cleanTimer = 0;
    if (G.wanted > before && G.ui) G.ui.onWantedUp(G.wanted);
  };

  // ---------------- input ----------------
  G.keys = {};
  G.mouse = { dragging: false, dx: 0, dy: 0, downX: 0, downY: 0 };
  G.camDragging = false; // true while a mouse/touch camera drag is held
  G.touch = { active: false, joyX: 0, joyY: 0, jump: false, fire: false, car: false, nitro: false, cam: false, mission: false };
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    G.keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'KeyP' || e.code === 'Escape') G.togglePause && G.togglePause();
    if (e.code === 'KeyM') G.tryStartNextMission && G.tryStartNextMission();
    if (e.code === 'KeyX') G.unstick && G.unstick();
    if (e.code === 'KeyC') G.touch.cam = true;
    if (e.code === 'Digit1') G.setWeapon && G.setWeapon(0);
    if (e.code === 'Digit2') G.setWeapon && G.setWeapon(1);
    if (e.code === 'KeyR') G.reload && G.reload();
  });
  window.addEventListener('keyup', function (e) { G.keys[e.code] = false; });
  canvas.addEventListener('mousedown', function (e) {
    G.mouse.dragging = true; G.camDragging = true; G.mouse.downX = e.clientX; G.mouse.downY = e.clientY;
    if (G.state === 'playing' && !G.player.inCar) G.shoot && G.shoot();
  });
  window.addEventListener('mouseup', function () { G.mouse.dragging = false; G.camDragging = false; });
  window.addEventListener('mousemove', function (e) {
    if (!G.mouse.dragging) return;
    G.mouse.dx += e.movementX || 0; G.mouse.dy += e.movementY || 0;
  });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

  function readInput() {
    var k = G.keys, t = G.touch;
    var fwd = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    var str = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    if (t.active) { fwd += -t.joyY; str += t.joyX; }
    fwd = Math.max(-1, Math.min(1, fwd));
    str = Math.max(-1, Math.min(1, str));
    return {
      fwd: fwd, str: str,
      run: !!(k['ShiftLeft'] || k['ShiftRight']),
      jump: !!(k['Space'] || t.jump),
      brake: !!(k['Space'] || t.jump),
      nitro: !!(k['ShiftLeft'] || k['ShiftRight'] || t.nitro),
      action: !!(k['KeyE']),
      fire: !!(k['KeyF'] || t.fire),
      reload: false
    };
  }
  G.readInput = readInput;

  // consume a one-shot key (E etc.) — returns true once per press
  var pressedOnce = {};
  window.addEventListener('keydown', function (e) { pressedOnce[e.code] = true; });
  G.consumeKey = function (code) {
    if (pressedOnce[code]) { pressedOnce[code] = false; return true; }
    return false;
  };
  G.consumeTouch = function (name) {
    if (G.touch[name]) { G.touch[name] = false; return true; }
    return false;
  };

  // ---------------- helpers ----------------
  G.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  G.lerp = function (a, b, t) { return a + (b - a) * t; };
  G.angleLerp = function (a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };
  G.dist2d = function (ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); };
  // blob shadow (cheap fake shadow)
  var shadowGeo = new THREE.CircleGeometry(1, 20);
  var shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  G.makeBlobShadow = function (r) {
    var m = new THREE.Mesh(shadowGeo, shadowMat);
    m.rotation.x = -Math.PI / 2; m.scale.setScalar(r); m.position.y = 0.03;
    m.renderOrder = 1;
    return m;
  };

  // ---------------- player (on foot) ----------------
  // Shared person geometries + material cache (keeps NPC crowds cheap)
  var PERSON_GEO = {
    body: new THREE.BoxGeometry(0.72, 0.85, 0.4),
    head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
    hair: new THREE.BoxGeometry(0.44, 0.16, 0.44),
    leg: new THREE.BoxGeometry(0.26, 0.8, 0.3),
    arm: new THREE.BoxGeometry(0.2, 0.75, 0.24),
    jacketSide: new THREE.BoxGeometry(0.36, 0.85, 0.48),
    zipper: new THREE.BoxGeometry(0.07, 0.78, 0.03),
    collar: new THREE.BoxGeometry(0.52, 0.12, 0.5),
    shoe: new THREE.BoxGeometry(0.28, 0.14, 0.46),
    beanie: new THREE.CylinderGeometry(0.24, 0.26, 0.22, 8),
    beanieFold: new THREE.CylinderGeometry(0.27, 0.27, 0.09, 8),
    pompom: new THREE.SphereGeometry(0.09, 6, 5),
    capTop: new THREE.CylinderGeometry(0.24, 0.25, 0.12, 8),
    capBrim: new THREE.BoxGeometry(0.42, 0.05, 0.32)
  };
  var personMatCache = {};
  function personMat(c) {
    if (!personMatCache[c]) personMatCache[c] = new THREE.MeshLambertMaterial({ color: c });
    return personMatCache[c];
  }
  // opts: { jacket, hat ('beanie'|'cap'|null), hatColor, shoes }
  // Clothes are children of the same group, so they follow the character
  // when walking / jumping / entering a car. Hitbox and controls untouched.
  function makePersonMesh(shirt, pants, skin, opts) {
    opts = opts || {};
    var g = new THREE.Group();
    var armColor = (opts.jacket !== undefined && opts.jacket !== null) ? opts.jacket : shirt;
    var body = new THREE.Mesh(PERSON_GEO.body, personMat(shirt));
    body.position.y = 1.15; g.add(body);
    if (opts.jacket !== undefined && opts.jacket !== null) {
      // open jacket: two side panels over the shirt (shirt shows as the tee)
      var jl = new THREE.Mesh(PERSON_GEO.jacketSide, personMat(opts.jacket));
      jl.position.set(-0.2, 1.15, 0); g.add(jl);
      var jr = new THREE.Mesh(PERSON_GEO.jacketSide, personMat(opts.jacket));
      jr.position.set(0.2, 1.15, 0); g.add(jr);
      var zip = new THREE.Mesh(PERSON_GEO.zipper, personMat(0xffffff));
      zip.position.set(0, 1.15, 0.25); g.add(zip);
      var col = new THREE.Mesh(PERSON_GEO.collar, personMat(opts.jacket));
      col.position.y = 1.62; g.add(col);
    }
    var head = new THREE.Mesh(PERSON_GEO.head, personMat(skin));
    head.position.y = 1.85; g.add(head);
    var hair = new THREE.Mesh(PERSON_GEO.hair, personMat(0x1c1410));
    hair.position.y = 2.08; g.add(hair);
    if (opts.hat === 'beanie') {
      var bn = new THREE.Mesh(PERSON_GEO.beanie, personMat(opts.hatColor || 0xffd21f));
      bn.position.y = 2.16; g.add(bn);
      var bf = new THREE.Mesh(PERSON_GEO.beanieFold, personMat(opts.hatColor || 0xffd21f));
      bf.position.y = 2.06; g.add(bf);
      var pom = new THREE.Mesh(PERSON_GEO.pompom, personMat(0xffffff));
      pom.position.y = 2.3; g.add(pom);
    } else if (opts.hat === 'cap') {
      var ct = new THREE.Mesh(PERSON_GEO.capTop, personMat(opts.hatColor || 0xd63030));
      ct.position.y = 2.1; g.add(ct);
      var cb = new THREE.Mesh(PERSON_GEO.capBrim, personMat(opts.hatColor || 0xd63030));
      cb.position.set(0, 2.06, 0.3); g.add(cb);
    }
    var legL = new THREE.Mesh(PERSON_GEO.leg, personMat(pants));
    legL.position.set(-0.19, 0.4, 0); g.add(legL);
    var legR = legL.clone(); legR.position.x = 0.19; g.add(legR);
    if (opts.shoes !== undefined && opts.shoes !== null) {
      // shoes ride on the legs, so they swing with the walk animation
      var shL = new THREE.Mesh(PERSON_GEO.shoe, personMat(opts.shoes));
      shL.position.set(0, -0.36, 0.06); legL.add(shL);
      var shR = new THREE.Mesh(PERSON_GEO.shoe, personMat(opts.shoes));
      shR.position.set(0, -0.36, 0.06); legR.add(shR);
    }
    var armL = new THREE.Mesh(PERSON_GEO.arm, personMat(armColor));
    armL.position.set(-0.48, 1.15, 0); g.add(armL);
    var armR = armL.clone(); armR.position.x = 0.48; g.add(armR);
    g.userData = { legL: legL, legR: legR, armL: armL, armR: armR, body: body };
    return g;
  }
  G.makePersonMesh = makePersonMesh;

  // Player outfit: white tee, bright red-orange open jacket, dark blue pants,
  // white shoes, yellow beanie.
  G.player = {
    mesh: makePersonMesh(0xffffff, 0x2c3a5e, 0xe8b98a, { jacket: 0xff3b1e, hat: 'beanie', hatColor: 0xffd21f, shoes: 0xf2f2f2 }),
    x: 0, z: 30, y: 0, vy: 0, yaw: 0, onGround: true,
    vx: 0, vz: 0, inCar: false, car: null, walkPhase: 0
  };
  G.player.mesh.position.set(0, 0, 30);
  scene.add(G.player.mesh);
  var pShadow = G.makeBlobShadow(0.9);
  scene.add(pShadow);
  G.player.shadow = pShadow;

  // ---------------- cars ----------------
  var CAR_TYPES = [
    { name: 'SOLSTICE SPYDER', color: 0xff2a1e, maxSpeed: 38, accel: 13, grip: 13, price: 0 },
    { name: 'CORAL GT', color: 0xff8c1a, maxSpeed: 36, accel: 12, grip: 12.5, price: 0 },
    { name: 'TIDE RUNNER', color: 0x00b3ff, maxSpeed: 34, accel: 11, grip: 12, price: 0 },
    { name: 'NEON COUPE', color: 0xb44dff, maxSpeed: 40, accel: 14, grip: 13.5, price: 0 },
    { name: 'SAND TAXI', color: 0xffd21f, maxSpeed: 30, accel: 10, grip: 11, price: 0 },
    { name: 'PALM SEDAN', color: 0x2eff8a, maxSpeed: 32, accel: 10.5, grip: 12, price: 0 },
    { name: 'SAKURA GT', color: 0xff2fb3, maxSpeed: 37, accel: 12.5, grip: 13, price: 0 }
  ];
  G.CAR_TYPES = CAR_TYPES;

  // ---------------- race cars (shared geos + paint cache, low/wide bodies) ----------------
  var RACE_GEO = (function () {
    function bx(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
    var wheel = new THREE.CylinderGeometry(0.5, 0.5, 0.42, 14);
    wheel.rotateZ(Math.PI / 2);
    var hub = new THREE.CylinderGeometry(0.26, 0.26, 0.44, 8);
    hub.rotateZ(Math.PI / 2);
    var exhaust = new THREE.CylinderGeometry(0.09, 0.09, 0.35, 8);
    exhaust.rotateX(Math.PI / 2);
    return {
      body: bx(2.1, 0.5, 4.5), splitter: bx(2.2, 0.16, 0.55), skirt: bx(0.14, 0.16, 3.2),
      diffuser: bx(2.0, 0.2, 0.4), grille: bx(1.9, 0.3, 0.12), scoop: bx(0.8, 0.1, 1.0),
      cabin: bx(1.6, 0.42, 2.0), roof: bx(1.65, 0.08, 1.8),
      stripe: bx(0.9, 0.03, 4.4), stripeRoof: bx(0.9, 0.03, 1.9),
      fin: bx(0.08, 0.35, 0.5), wing: bx(1.95, 0.07, 0.55),
      headlight: bx(0.55, 0.12, 0.06), taillight: bx(1.85, 0.12, 0.06),
      exhaust: exhaust, wheel: wheel, hub: hub,
      door: bx(0.06, 0.45, 1.5), lightBar: bx(1.1, 0.16, 0.4), lightHalf: bx(0.5, 0.18, 0.42),
      // driver figure (sits in the cabin, visible through the glass)
      driverTorso: bx(0.62, 0.45, 0.32), driverHead: bx(0.32, 0.3, 0.32),
      driverArm: bx(0.16, 0.16, 0.5), steerWheel: bx(0.5, 0.06, 0.06)
    };
  })();
  var RACE_MAT = {
    dark: new THREE.MeshLambertMaterial({ color: 0x14141c }),
    // semi-transparent cabin glass so the driver inside reads from outside
    glass: new THREE.MeshLambertMaterial({ color: 0x9fd8e8, transparent: true, opacity: 0.5 }),
    chrome: new THREE.MeshLambertMaterial({ color: 0xc8ccd4 }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    headlight: new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
    taillight: new THREE.MeshBasicMaterial({ color: 0xff2a2a })
  };
  var paintCache = {};
  function paintMat(color) {
    if (!paintCache[color]) paintCache[color] = new THREE.MeshLambertMaterial({ color: color });
    return paintCache[color];
  }

  function makeCarMesh(color, isPolice, withDriver) {
    var g = new THREE.Group();
    var paint = paintMat(color);
    function part(geo, mat, x, y, z) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    }
    // low, wide race body
    var body = part(RACE_GEO.body, paint, 0, 0.55, 0);
    part(RACE_GEO.splitter, RACE_MAT.dark, 0, 0.28, 2.3);          // front splitter
    part(RACE_GEO.skirt, RACE_MAT.dark, -1.06, 0.3, 0);            // side skirts
    part(RACE_GEO.skirt, RACE_MAT.dark, 1.06, 0.3, 0);
    part(RACE_GEO.diffuser, RACE_MAT.dark, 0, 0.3, -2.25);         // rear diffuser
    part(RACE_GEO.grille, RACE_MAT.dark, 0, 0.5, 2.28);            // grille
    part(RACE_GEO.scoop, RACE_MAT.dark, 0, 0.83, 1.3);             // hood scoop
    part(RACE_GEO.cabin, RACE_MAT.glass, 0, 0.98, -0.3);           // low glass cabin
    part(RACE_GEO.roof, paint, 0, 1.22, -0.3);                     // roof
    part(RACE_GEO.stripe, RACE_MAT.white, 0, 0.81, 0);             // racing stripe
    part(RACE_GEO.stripeRoof, RACE_MAT.white, 0, 1.27, -0.3);
    // rear spoiler: fins + wing
    part(RACE_GEO.fin, RACE_MAT.dark, -0.75, 0.98, -2.05);
    part(RACE_GEO.fin, RACE_MAT.dark, 0.75, 0.98, -2.05);
    part(RACE_GEO.wing, RACE_MAT.dark, 0, 1.18, -2.05);
    // slim LED headlights + full-width taillight strip
    part(RACE_GEO.headlight, RACE_MAT.headlight, -0.62, 0.62, 2.27);
    part(RACE_GEO.headlight, RACE_MAT.headlight, 0.62, 0.62, 2.27);
    part(RACE_GEO.taillight, RACE_MAT.taillight, 0, 0.62, -2.27);
    // dual exhausts
    part(RACE_GEO.exhaust, RACE_MAT.chrome, -0.55, 0.35, -2.35);
    part(RACE_GEO.exhaust, RACE_MAT.chrome, 0.55, 0.35, -2.35);
    // big rims
    var wheels = [], steers = [];
    var wpos = [[-1.02, 1.5], [1.02, 1.5], [-1.02, -1.5], [1.02, -1.5]];
    for (var i = 0; i < 4; i++) {
      var wgroup = new THREE.Group();
      var w = new THREE.Mesh(RACE_GEO.wheel, RACE_MAT.dark);
      var hub = new THREE.Mesh(RACE_GEO.hub, RACE_MAT.chrome);
      wgroup.add(w); wgroup.add(hub);
      wgroup.position.set(wpos[i][0], 0.5, wpos[i][1]);
      g.add(wgroup);
      wheels.push(wgroup);
      if (i < 2) steers.push(wgroup);
    }
    if (isPolice) {
      // white doors + light bar (race-spec SBPD interceptor)
      part(RACE_GEO.door, RACE_MAT.white, -1.06, 0.62, 0.2);
      part(RACE_GEO.door, RACE_MAT.white, 1.06, 0.62, 0.2);
      part(RACE_GEO.lightBar, RACE_MAT.dark, 0, 1.35, -0.25);
      var red = part(RACE_GEO.lightHalf, new THREE.MeshBasicMaterial({ color: 0xff2020 }), -0.28, 1.35, -0.25);
      var blue = part(RACE_GEO.lightHalf, new THREE.MeshBasicMaterial({ color: 0x2040ff }), 0.28, 1.35, -0.25);
      g.userData.lightRed = red; g.userData.lightBlue = blue;
    }
    if (withDriver) {
      // driver: torso + head + arms on the wheel, tucked inside the cabin
      // (head top sits just under the roof so it reads through the glass)
      var shirtCols = [0x4aa8ff, 0xffd76a, 0x7ddb8a, 0xff8ab0, 0xc9a0ff, 0xffffff, 0xff6a3d];
      var dMat = paintMat(shirtCols[Math.floor(Math.random() * shirtCols.length)]);
      var dSkin = paintMat(0xe8b98a);
      var drv = new THREE.Group();
      var dTorso = new THREE.Mesh(RACE_GEO.driverTorso, dMat);
      dTorso.position.set(-0.35, 0.88, -0.3); drv.add(dTorso);
      var dHead = new THREE.Mesh(RACE_GEO.driverHead, dSkin);
      dHead.position.set(-0.35, 1.12, -0.3); drv.add(dHead);
      var dArmL = new THREE.Mesh(RACE_GEO.driverArm, dMat);
      dArmL.position.set(-0.52, 0.95, 0.02); drv.add(dArmL);
      var dArmR = new THREE.Mesh(RACE_GEO.driverArm, dMat);
      dArmR.position.set(-0.18, 0.95, 0.02); drv.add(dArmR);
      var dWheel = new THREE.Mesh(RACE_GEO.steerWheel, RACE_MAT.dark);
      dWheel.position.set(-0.35, 0.98, 0.14); dWheel.rotation.x = -0.5; drv.add(dWheel);
      g.add(drv);
      g.userData.driver = drv;
    }
    g.userData.wheels = wheels; g.userData.steers = steers;
    g.userData.body = body;
    return g;
  }
  G.makeCarMesh = makeCarMesh;

  function makeCar(type, x, z, heading, isPolice, withDriver) {
    var mesh = makeCarMesh(type.color, isPolice, withDriver);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    var shadow = G.makeBlobShadow(2.4);
    scene.add(shadow);
    return {
      mesh: mesh, shadow: shadow, type: type,
      x: x, z: z, heading: heading, vx: 0, vz: 0,
      steer: 0, condition: 100, isPolice: !!isPolice,
      stuckTimer: 0, targetX: 0, targetZ: 0, ai: false,
      dead: false, explodeTimer: 0
    };
  }
  G.makeCar = makeCar;

  // player starting car + parked cars
  G.cars = [];
  var startCar = makeCar(CAR_TYPES[0], 6, 34, Math.PI / 2, false);
  G.cars.push(startCar);
  G.playerCar = startCar;
  var parkedSpots = [
    { t: 1, x: -38, z: 8, h: 0 }, { t: 2, x: 38, z: -40, h: Math.PI }, { t: 3, x: -114, z: 60, h: Math.PI / 2 },
    { t: 4, x: 114, z: 20, h: -Math.PI / 2 }, { t: 5, x: -38, z: -90, h: 0 }, { t: 1, x: 38, z: -110, h: Math.PI },
    { t: 3, x: 190, z: 130, h: Math.PI / 2 },
    { t: 6, x: -114, z: 100, h: Math.PI / 2 }, { t: 1, x: 114, z: 140, h: 0 }, { t: 6, x: 60, z: 114, h: Math.PI }
  ];
  parkedSpots.forEach(function (s) {
    var c = makeCar(CAR_TYPES[s.t], s.x, s.z, s.h, false);
    c.parked = true;
    G.cars.push(c);
  });

  // traffic cars
  G.traffic = [];
  // right-hand lane offset for a given road axis + travel direction
  function laneOffset(axis, dir) {
    if (axis === 'x') return dir > 0 ? 4 : -4;
    return dir > 0 ? -4 : 4;
  }
  function spawnTrafficCar() {
    var t = CAR_TYPES[1 + Math.floor(Math.random() * (CAR_TYPES.length - 1))];
    // snap onto a road with a cardinal heading, in the right-hand lane
    var axis = Math.random() < 0.5 ? 'x' : 'z';
    var rc = G.roadCenters[Math.floor(Math.random() * G.roadCenters.length)];
    var dir = Math.random() < 0.5 ? 1 : -1;
    var along = G.rrange(-G.layout.HALF + 20, G.layout.HALF - 20);
    var lane = laneOffset(axis, dir);
    var x, z, heading;
    if (axis === 'x') { x = along; z = rc + lane; heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { x = rc + lane; z = along; heading = dir > 0 ? 0 : Math.PI; }
    var c = makeCar(t, x, z, heading, false, true);
    c.ai = true;
    c.aiSpeed = G.rrange(9, 13);
    pickTrafficTarget(c);
    G.traffic.push(c);
    return c;
  }
  // Traffic drives leg by leg: along the current road to the next
  // intersection, then straight / left / right (never a mid-block U-turn).
  // At the city edge the car turns around. Legs stay in the right-hand
  // lane, so turns look natural instead of snapping around.
  function pickTrafficTarget(c) {
    var H = G.layout.HALF;
    var sh = Math.sin(c.heading), ch = Math.cos(c.heading);
    var axis = Math.abs(sh) > Math.abs(ch) ? 'x' : 'z';
    var dir = axis === 'x' ? (sh >= 0 ? 1 : -1) : (ch >= 0 ? 1 : -1);
    var rc = axis === 'x' ? G.nearestRoad(c.z) : G.nearestRoad(c.x);
    var pos = axis === 'x' ? c.x : c.z;
    var next = null;
    for (var i = 0; i < G.roadCenters.length; i++) {
      var r = G.roadCenters[i];
      if (dir > 0 && r > pos + 8) { next = r; break; }
      if (dir < 0 && r < pos - 8) next = r; // last one wins = nearest below
    }
    var lane = laneOffset(axis, dir);
    if (next === null) { c.legEnd = dir > 0 ? H - 10 : -H + 10; c.atEdge = true; }
    else { c.legEnd = next; c.atEdge = false; }
    if (axis === 'x') { c.targetX = c.legEnd; c.targetZ = rc + lane; }
    else { c.targetX = rc + lane; c.targetZ = c.legEnd; }
    c.legAxis = axis; c.legDir = dir; c.legLane = lane; c.legRoad = rc;
  }
  // called when a car arrives at an intersection: pick the next leg
  // (straight 50% / left 25% / right 25% — never back the way it came)
  function pickTrafficTurn(c) {
    var H = G.layout.HALF;
    var roll = Math.random();
    var turn = roll < 0.5 ? 0 : (roll < 0.75 ? 1 : -1);
    var nh = c.heading + (turn === 1 ? Math.PI / 2 : (turn === -1 ? -Math.PI / 2 : 0));
    var sh = Math.sin(nh), ch = Math.cos(nh);
    var axis = Math.abs(sh) > Math.abs(ch) ? 'x' : 'z';
    var dir = axis === 'x' ? (sh >= 0 ? 1 : -1) : (ch >= 0 ? 1 : -1);
    var ix = G.nearestRoad(c.x), iz = G.nearestRoad(c.z);
    var rc = axis === 'x' ? iz : ix; // the road we will travel on
    var pos = axis === 'x' ? c.x : c.z;
    var next = null;
    for (var i = 0; i < G.roadCenters.length; i++) {
      var r = G.roadCenters[i];
      if (dir > 0 && r > pos + 8) { next = r; break; }
      if (dir < 0 && r < pos - 8) next = r;
    }
    var lane = laneOffset(axis, dir);
    if (next === null) { c.legEnd = dir > 0 ? H - 10 : -H + 10; c.atEdge = true; }
    else { c.legEnd = next; c.atEdge = false; }
    if (axis === 'x') { c.targetX = c.legEnd; c.targetZ = rc + lane; }
    else { c.targetX = rc + lane; c.targetZ = c.legEnd; }
    c.legAxis = axis; c.legDir = dir; c.legLane = lane; c.legRoad = rc;
  }
  G.pickTrafficTarget = pickTrafficTarget;
  G.pickTrafficTurn = pickTrafficTurn;
  // distance to the stop line if a red/yellow light is ahead, else -1.
  // trafficState: 0 = NS green, 2 = EW green (1/3 are the yellows = red).
  function stopLineAhead(c) {
    var spots = G.trafficLightSpots || [];
    var st = G.DECOR ? G.DECOR.trafficState : -1;
    if (st < 0) return -1;
    var axis = c.legAxis, dir = c.legDir;
    if (!axis || !dir) return -1;
    for (var i = 0; i < spots.length; i++) {
      var ix = spots[i][0], iz = spots[i][1];
      if (axis === 'x') {
        if (Math.abs(c.z - iz) > 7) continue;
        if (st === 2) continue; // EW green
        if (dir > 0 && c.x < ix && ix - c.x < 22) return (ix - 12) - c.x;
        if (dir < 0 && c.x > ix && c.x - ix < 22) return c.x - (ix + 12);
      } else {
        if (Math.abs(c.x - ix) > 7) continue;
        if (st === 0) continue; // NS green
        if (dir > 0 && c.z < iz && iz - c.z < 22) return (iz - 12) - c.z;
        if (dir < 0 && c.z > iz && c.z - iz < 22) return c.z - (iz + 12);
      }
    }
    return -1;
  }
  G.stopLineAhead = stopLineAhead;
  for (var ti = 0; ti < 8; ti++) spawnTrafficCar();

  // ---------------- pedestrians ----------------
  G.peds = [];
  var pedShirts = [0x4aa8ff, 0xffd76a, 0x7ddb8a, 0xff8ab0, 0xc9a0ff, 0xffffff, 0x8a6a4a, 0xff4fd8, 0x00e5ff, 0xff6a3d];
  var pedJackets = [0xff3b1e, 0x2e7dc2, 0x2eff8a, 0xffd21f, 0xb44dff, 0xff8ab0, 0x1c1c22];
  var pedPants = [0x3a3a4a, 0x2c3a5e, 0x5a4a3a, 0x6b4a3a, 0x1c1c22, 0x4a5a3a];
  var pedSkins = [0xd9a06a, 0xe8b98a, 0xc98a5a, 0xf2c9a0];
  var pedShoes = [0xf2f2f2, 0x1c1c22, 0xd63030, 0x2e7dc2];
  var pedHats = [0xffd21f, 0xd63030, 0x2e7dc2, 0x2eff8a, 0xff7ad9, 0xff9a3d];
  function pedOutfit() {
    var o = { shoes: pedShoes[Math.floor(Math.random() * pedShoes.length)] };
    if (Math.random() < 0.5) o.jacket = pedJackets[Math.floor(Math.random() * pedJackets.length)];
    if (Math.random() < 0.4) {
      o.hat = Math.random() < 0.6 ? 'beanie' : 'cap';
      o.hatColor = pedHats[Math.floor(Math.random() * pedHats.length)];
    }
    return o;
  }
  // mode: 'walk' (sidewalks), 'beach' (sand), 'sit' (on a towel), 'volley'
  // zone: optional {x1,z1,x2,z2} the ped stays inside
  function spawnPed(x, z, mode, zone) {
    var mesh = makePersonMesh(
      pedShirts[Math.floor(Math.random() * pedShirts.length)],
      pedPants[Math.floor(Math.random() * pedPants.length)],
      pedSkins[Math.floor(Math.random() * pedSkins.length)],
      pedOutfit()
    );
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    var p = {
      mesh: mesh, x: x, z: z, yaw: Math.random() * Math.PI * 2,
      vx: 0, vz: 0, tx: x, tz: z, state: 'walk', timer: G.rrange(0, 3),
      dead: false, deadTimer: 0, phase: Math.random() * 6,
      mode: mode || 'walk', zone: zone || null,
      homeX: x, homeZ: z, hopT: 0, hopY: 0,
      walkSpeed: G.rrange(1.2, 2.4), smoothSpeed: 0,
      volleyT: G.rrange(1, 3), volleySide: Math.random() < 0.5 ? 0 : 1
    };
    G.peds.push(p);
    return p;
  }
  G.spawnPed = spawnPed;
  // beach sitter: sits on a towel facing the ocean (legs out in front)
  var sitTowels = [0xff5b7a, 0x3fb8ff, 0xffd76a, 0x7ddb8a];
  function spawnBeachSitter(x, z) {
    var p = spawnPed(x, z, 'sit', null);
    p.yaw = Math.PI / 2; // face the ocean (east)
    p.mesh.rotation.y = p.yaw;
    var towel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.9),
      personMat(sitTowels[Math.floor(Math.random() * sitTowels.length)]));
    towel.position.set(x + 0.8, 0.08, z); // towel extends east, under the legs
    scene.add(towel);
    return p;
  }
  // --- city sidewalks (26, up from 20) ---
  for (var pi = 0; pi < 26; pi++) {
    // spawn on a sidewalk near a road (never inside a building)
    var rc = G.roadCenters[Math.floor(Math.random() * G.roadCenters.length)];
    var px, pz;
    if (Math.random() < 0.5) { px = G.rrange(-G.layout.HALF, G.layout.HALF); pz = rc + (Math.random() < 0.5 ? -10 : 10); }
    else { px = rc + (Math.random() < 0.5 ? -10 : 10); pz = G.rrange(-G.layout.HALF, G.layout.HALF); }
    spawnPed(px, pz);
  }
  // --- hotspot crowds: konbini, Shibuya crossing, parks ---
  function spawnZoneCrowd(zone, n) {
    for (var i = 0; i < n; i++) {
      spawnPed(G.rrange(zone.x1, zone.x2), G.rrange(zone.z1, zone.z2), 'walk', zone);
    }
  }
  spawnZoneCrowd({ x1: 42, z1: -34, x2: 84, z2: -2 }, 3);   // konbini (block 3,2)
  spawnZoneCrowd({ x1: 22, z1: 22, x2: 54, z2: 54 }, 3);    // Shibuya crossing
  (G.parks || []).slice(0, 2).forEach(function (pk) {
    spawnZoneCrowd({ x1: pk.x - 20, z1: pk.z - 20, x2: pk.x + 20, z2: pk.z + 20 }, 1);
  });
  // --- beach: walkers on the sand ---
  for (var bi = 0; bi < 4; bi++) {
    spawnPed(G.rrange(212, 246), G.rrange(-180, 180), 'beach', null);
  }
  // --- beach: sitters on towels ---
  var sitSpots = [[222, -140], [228, -60], [220, 30], [230, 120]];
  for (var si = 0; si < sitSpots.length; si++) {
    spawnBeachSitter(sitSpots[si][0], sitSpots[si][1]);
  }
  // --- beach volleyball: two players shuffling by the net (230,-20) ---
  spawnPed(227, -20, 'volley', null);
  spawnPed(233, -20, 'volley', null);
  function pickPedTarget(p) {
    if (p.zone) {
      p.tx = G.rrange(p.zone.x1, p.zone.x2);
      p.tz = G.rrange(p.zone.z1, p.zone.z2);
      return;
    }
    if (p.mode === 'volley') { p.tx = p.homeX; p.tz = G.rrange(-24, -16); return; }
    if (p.mode === 'beach' || p.mode === 'sit') {
      // stay on the sand
      p.tx = G.rrange(212, 246);
      p.tz = G.rrange(-185, 185);
      return;
    }
    // sidewalk point near a road
    var rc = G.roadCenters[Math.floor(Math.random() * G.roadCenters.length)];
    if (Math.random() < 0.5) { p.tx = G.rrange(-G.layout.HALF, G.layout.HALF); p.tz = rc + (Math.random() < 0.5 ? -10 : 10); }
    else { p.tx = rc + (Math.random() < 0.5 ? -10 : 10); p.tz = G.rrange(-G.layout.HALF, G.layout.HALF); }
  }
  G.pickPedTarget = pickPedTarget;
})();

(function () {
  'use strict';
  var G = window.G;
  var THREE = window.THREE;
  var clamp = G.clamp;

  // ---------------- car physics (researched arcade model) ----------------
  // One substep (dt ~ 1/120). Velocity is kept as (vx,vz); each step it is
  // split into forward vF and lateral vL in the car's frame. Engine acts on
  // vF; lateral grip scrubs vL. Yaw follows the bicycle model.
  var CAR = {
    wheelbase: 2.9,
    grip: 13,            // lateral grip 1/s (normal)
    driftGrip: 1.8,      // lateral grip 1/s (handbrake)
    slipThreshold: 6,    // |vL| above this -> grip drops (drift state)
    brake: 26,
    reverseAccel: 9,
    dragRoll: 0.35,      // rolling drag 1/s
    dragQuad: 0.004,     // quadratic drag
    steerMax: 0.55,      // rad at standstill
    steerRate: 5.5,      // rad/s easing
    nitroAccel: 10,
    nitroTop: 10
  };
  G.CAR = CAR;

  function updateCarPhysics(car, throttle, steerIn, handbrake, nitro, dt) {
    var t = car.type;
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    var rx = -fz, rz = fx;   // right vector of forward
    var vF = car.vx * fx + car.vz * fz;
    var vL = car.vx * rx + car.vz * rz;

    // --- steering: ease toward input, max shrinks with speed ---
    var speedRatio = Math.min(Math.abs(vF) / t.maxSpeed, 1);
    var steerMax = CAR.steerMax * (1 - 0.55 * speedRatio);
    var steerTarget = steerIn * steerMax;
    var dSteer = clamp(steerTarget - car.steer, -CAR.steerRate * dt, CAR.steerRate * dt);
    car.steer += dSteer;

    // --- longitudinal: engine / brake / reverse / drag ---
    var top = t.maxSpeed + (nitro && G.nitro > 0 ? CAR.nitroTop : 0);
    if (throttle > 0) {
      var scale = clamp(1 - vF / top, 0, 1);
      vF += throttle * t.accel * scale * dt;
      if (nitro && G.nitro > 0 && car === G.player.car) {
        vF += CAR.nitroAccel * dt;
        G.nitro = Math.max(0, G.nitro - 34 * dt);
      }
    } else if (throttle < 0) {
      if (vF > 0.6) vF += throttle * CAR.brake * dt;          // braking
      else vF = Math.max(vF + throttle * CAR.reverseAccel * dt, -12); // reverse
    }
    // drag
    vF -= vF * CAR.dragRoll * dt;
    vF -= vF * Math.abs(vF) * CAR.dragQuad * dt;
    if (Math.abs(vF) < 0.05 && throttle === 0) vF = 0;

    // --- lateral grip: drift when handbrake or slipping ---
    var drifting = handbrake || Math.abs(vL) > CAR.slipThreshold;
    var grip = drifting ? CAR.driftGrip : t.grip;
    vL *= Math.max(0, 1 - grip * dt);
    car.drifting = drifting && Math.abs(vF) > 4;

    // --- yaw (bicycle model) + drift inertia blend ---
    var yawRate = (vF / CAR.wheelbase) * Math.tan(car.steer);
    if (car.drifting) yawRate += vL * 0.06;   // slide feeds rotation
    car.heading += yawRate * dt;

    // --- recompose velocity in the NEW frame ---
    fx = Math.sin(car.heading); fz = Math.cos(car.heading);
    rx = -fz; rz = fx;
    car.vx = fx * vF + rx * vL;
    car.vz = fz * vF + rz * vL;

    // --- integrate position ---
    car.x += car.vx * dt;
    car.z += car.vz * dt;

    // --- world bounds (ocean is a wall on the east, past the wide beach) ---
    var B = G.layout.HALF;
    if (car.x > B + 52) { car.x = B + 52; if (car.vx > 0) car.vx = 0; }
    if (car.x < -B - 22) { car.x = -B - 22; if (car.vx < 0) car.vx = 0; }
    if (car.z > B + 22) { car.z = B + 22; if (car.vz > 0) car.vz = 0; }
    if (car.z < -B - 22) { car.z = -B - 22; if (car.vz < 0) car.vz = 0; }

    // --- collision: circle vs AABBs, min-translation push-out + reflect ---
    var res = G.collideCircle(car.x, car.z, 1.7);
    if (res.hit) {
      var vN = car.vx * res.nx + car.vz * res.nz;
      if (vN < 0) {
        var impact = -vN;
        // reflect along normal with restitution 0.25, tangential damping
        car.vx -= res.nx * vN * 1.25;
        car.vz -= res.nz * vN * 1.25;
        car.vx *= 0.94; car.vz *= 0.94;
        if (impact > 9 && car === G.player.car) {
          car.condition = Math.max(0, car.condition - (impact - 9) * 1.2);
          G.damagePlayer((impact - 9) * 0.5);
          if (G.ui) G.ui.flash();
        }
      }
      car.x = res.x; car.z = res.z;
    }

    // --- visuals ---
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    // body roll / pitch from lateral + longitudinal accel (weight feel)
    var targetRoll = clamp(-vL * 0.012, -0.09, 0.09) + (car.drifting ? clamp(-vL * 0.01, -0.06, 0.06) : 0);
    car.mesh.rotation.z = G.lerp(car.mesh.rotation.z || 0, targetRoll, 0.2);
    car.mesh.rotation.x = G.lerp(car.mesh.rotation.x || 0, clamp(-(throttle > 0 ? 0.02 : 0) + (vF < 0 ? 0.015 : 0), -0.03, 0.03), 0.15);
    // wheels
    var wheels = car.mesh.userData.wheels, steers = car.mesh.userData.steers;
    var spin = (vF * dt) / 0.5;
    for (var i = 0; i < wheels.length; i++) wheels[i].rotation.x += spin;
    if (steers) for (var j = 0; j < steers.length; j++) steers[j].rotation.y = car.steer * 0.9;
    car.shadow.position.set(car.x, 0.03, car.z);
    car.speed = Math.abs(vF);
  }
  G.updateCarPhysics = updateCarPhysics;

  // circle-circle push for car-car / car-ped contacts
  function collideCircles(a, b, ra, rb) {
    var dx = b.x - a.x, dz = b.z - a.z;
    var d = Math.sqrt(dx * dx + dz * dz), min = ra + rb;
    if (d >= min || d < 1e-4) return false;
    var push = (min - d) / 2, nx = dx / d, nz = dz / d;
    a.x -= nx * push; a.z -= nz * push;
    b.x += nx * push; b.z += nz * push;
    // exchange a bit of velocity along the normal
    var avn = a.vx * nx + a.vz * nz, bvn = b.vx * nx + b.vz * nz;
    var imp = (bvn - avn) * 0.5;
    a.vx += nx * imp; a.vz += nz * imp;
    b.vx -= nx * imp; b.vz -= nz * imp;
    return true;
  }
  G.collideCircles = collideCircles;

  // ---------------- player on foot ----------------
  var camYaw = Math.PI;   // camera behind player (player faces +Z at start)
  var camPitch = 0.32;
  var camDist = 8;
  // yaw/pitch/offset chase smoothed targets, so drags feel buttery instead
  // of snapping the view one frame at a time
  G.cam = { yaw: camYaw, pitch: camPitch, dist: camDist, offset: 0, targetYaw: camYaw, targetPitch: camPitch, targetOffset: 0 };

  function updatePlayer(dt, inp) {
    var p = G.player;
    if (p.inCar) return;
    // camera-relative move dir
    var cy = G.cam.yaw;
    var fx = -Math.sin(cy), fz = -Math.cos(cy);   // camera looks toward -yaw dir
    var rx = -fz, rz = fx;
    var mx = fx * inp.fwd + rx * inp.str;
    var mz = fz * inp.fwd + rz * inp.str;
    var ml = Math.sqrt(mx * mx + mz * mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    var maxSpeed = inp.run ? 10 : 6;
    var accel = 46;
    p.vx += mx * accel * dt;
    p.vz += mz * accel * dt;
    // friction when no input
    if (ml < 0.05) {
      var fr = Math.max(0, 1 - 11 * dt);
      p.vx *= fr; p.vz *= fr;
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
      if (Math.abs(p.vz) < 0.05) p.vz = 0;
    }
    // clamp speed
    var sp = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    if (sp > maxSpeed) { p.vx *= maxSpeed / sp; p.vz *= maxSpeed / sp; }
    // jump / gravity
    if (inp.jump && p.onGround) { p.vy = 8.6; p.onGround = false; }
    p.vy -= 23 * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
    // integrate + collide (circle r=0.6)
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    var B = G.layout.HALF;
    p.x = clamp(p.x, -B - 22, B + 52);
    p.z = clamp(p.z, -B - 22, B + 22);
    var res = G.collideCircle(p.x, p.z, 0.6);
    if (res.hit) {
      // slide: remove velocity into the wall
      var vN = p.vx * res.nx + p.vz * res.nz;
      if (vN < 0) { p.vx -= res.nx * vN; p.vz -= res.nz * vN; }
      p.x = res.x; p.z = res.z;
    }
    // face movement direction
    if (sp > 0.6) {
      var targetYaw = Math.atan2(p.vx, p.vz);
      p.yaw = G.angleLerp(p.yaw, targetYaw, Math.min(1, 12 * dt));
    }
    // walk animation
    p.walkPhase += sp * dt * 1.6;
    var swing = Math.sin(p.walkPhase * 2) * clamp(sp / 6, 0, 1) * 0.55;
    var ud = p.mesh.userData;
    ud.legL.rotation.x = swing; ud.legR.rotation.x = -swing;
    ud.armL.rotation.x = -swing * 0.8; ud.armR.rotation.x = swing * 0.8;
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.rotation.y = p.yaw;
    p.mesh.position.y = p.y + Math.abs(Math.sin(p.walkPhase * 2)) * 0.05 * clamp(sp / 6, 0, 1);
    p.shadow.position.set(p.x, 0.03, p.z);
  }
  G.updatePlayer = updatePlayer;

  // ---------------- traffic AI ----------------
  function updateTraffic(dt) {
    for (var i = 0; i < G.traffic.length; i++) {
      var c = G.traffic[i];
      if (c.dead) continue;
      // steer toward target
      var dx = c.targetX - c.x, dz = c.targetZ - c.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 7) {
        if (c.atEdge) {
          // end of the road: turn around and head back down the same road
          // (next leg ends at the nearest intersection behind us)
          var back = null;
          for (var bi = 0; bi < G.roadCenters.length; bi++) {
            var br = G.roadCenters[bi];
            if (c.legDir > 0 && br < c.legEnd) back = br;
            if (c.legDir < 0 && br > c.legEnd) { back = br; break; }
          }
          c.legDir = -c.legDir;
          c.legLane = -c.legLane;
          c.legEnd = back;
          c.atEdge = false;
          if (c.legAxis === 'x') { c.targetX = back; c.targetZ = c.legRoad + c.legLane; }
          else { c.targetX = c.legRoad + c.legLane; c.targetZ = back; }
        } else G.pickTrafficTurn(c);
        continue;
      }
      var want = Math.atan2(dx, dz);
      var diff = want - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      var steerIn = clamp(diff * 1.6, -1, 1);
      // slow for cars ahead
      var throttle = 0.75;
      for (var j = 0; j < G.traffic.length; j++) {
        if (j === i) continue;
        var o = G.traffic[j];
        var ox = o.x - c.x, oz = o.z - c.z;
        var fwd = Math.sin(c.heading), fwdZ = Math.cos(c.heading);
        var ahead = ox * fwd + oz * fwdZ;
        var side = Math.abs(ox * (-fwdZ) + oz * fwd);
        if (ahead > 0 && ahead < 9 && side < 2.4) { throttle = 0; break; }
      }
      // player car ahead counts too
      if (G.player.inCar && G.player.car) {
        var pc = G.player.car;
        var px = pc.x - c.x, pz = pc.z - c.z;
        var f2 = Math.sin(c.heading), f2z = Math.cos(c.heading);
        var ah = px * f2 + pz * f2z, sd = Math.abs(px * (-f2z) + pz * f2);
        if (ah > 0 && ah < 9 && sd < 2.4) throttle = 0;
      }
      // stop at red / yellow lights: brake smoothly before the stop line
      var stop = G.stopLineAhead(c);
      if (stop >= 0) {
        if (stop > 5) throttle = (c.speed || 0) > 1.2 ? -1 : 0;
        else throttle = 0; // right at the line: hold, don't creep through
      }
      updateCarPhysics(c, throttle, steerIn, false, false, dt);
      // stuck? pick a new leg
      var sp = Math.sqrt(c.vx * c.vx + c.vz * c.vz);
      if (sp < 0.8 && throttle > 0) { c.stuckTimer += dt; if (c.stuckTimer > 3) { c.stuckTimer = 0; G.pickTrafficTarget(c); } }
      else c.stuckTimer = 0;
      // keep traffic near the player: respawn far ones, snapped to a road
      var pd = G.dist2d(c.x, c.z, G.player.x, G.player.z);
      if (pd > 260) {
        var H = G.layout.HALF;
        var ax2 = Math.random() < 0.5 ? 'x' : 'z';
        var rc2 = G.roadCenters[Math.floor(Math.random() * G.roadCenters.length)];
        var d2 = Math.random() < 0.5 ? 1 : -1;
        var lane2 = ax2 === 'x' ? (d2 > 0 ? 4 : -4) : (d2 > 0 ? -4 : 4);
        if (ax2 === 'x') { c.x = G.rrange(-H + 20, H - 20); c.z = rc2 + lane2; c.heading = d2 > 0 ? Math.PI / 2 : -Math.PI / 2; }
        else { c.x = rc2 + lane2; c.z = G.rrange(-H + 20, H - 20); c.heading = d2 > 0 ? 0 : Math.PI; }
        c.vx = 0; c.vz = 0;
        G.pickTrafficTarget(c);
      }
    }
    // traffic vs traffic / player car (soft circle push)
    var all = G.traffic.concat(G.player.inCar && G.player.car ? [G.player.car] : []);
    for (var a = 0; a < all.length; a++) for (var b = a + 1; b < all.length; b++) {
      collideCircles(all[a], all[b], 1.7, 1.7);
    }
  }
  G.updateTraffic = updateTraffic;

  // ---------------- pedestrians ----------------
  function updatePeds(dt) {
    var px = G.player.x, pz = G.player.z;
    var pc = G.player.inCar ? G.player.car : null;
    for (var i = 0; i < G.peds.length; i++) {
      var p = G.peds[i];
      if (p.dead) {
        p.deadTimer -= dt;
        if (p.deadTimer <= 0) {
          // respawn at home: beach peds return to the sand, zoned peds to
          // their zone, volley players to their side of the net
          if (p.mode === 'volley') {
            p.x = p.homeX; p.z = p.homeZ;
          } else if (p.zone) {
            p.x = G.rrange(p.zone.x1, p.zone.x2);
            p.z = G.rrange(p.zone.z1, p.zone.z2);
          } else if (p.mode === 'beach' || p.mode === 'sit') {
            p.x = G.rrange(212, 246);
            p.z = G.rrange(-185, 185);
          } else {
            var a = Math.random() * Math.PI * 2, r = G.rrange(90, 140);
            p.x = clamp(px + Math.cos(a) * r, -G.layout.HALF, G.layout.HALF);
            p.z = clamp(pz + Math.sin(a) * r, -G.layout.HALF, G.layout.HALF);
          }
          p.dead = false; p.state = 'walk';
          p.mesh.visible = true;
          p.mesh.rotation.x = 0;
          G.pickPedTarget(p);
        }
        continue;
      }
      // threat check: fast car nearby or recent gunshot
      var threatX = 0, threatZ = 0, flee = false;
      if (pc) {
        var d = G.dist2d(p.x, p.z, pc.x, pc.z);
        var csp = Math.sqrt(pc.vx * pc.vx + pc.vz * pc.vz);
        if (d < 12 && csp > 7) { flee = true; threatX = pc.x; threatZ = pc.z; }
        // run over?
        if (d < 1.9 && csp > 3) { killPed(p, 'car'); continue; }
      } else {
        var d2 = G.dist2d(p.x, p.z, px, pz);
        if (d2 < 2.2 && G.playerSpeed > 3) { /* on-foot bump: ignore */ }
      }
      if (G.lastShotAt && G.time - G.lastShotAt < 1.2) {
        var ds = G.dist2d(p.x, p.z, G.lastShotX, G.lastShotZ);
        if (ds < 22) { flee = true; threatX = G.lastShotX; threatZ = G.lastShotZ; }
      }
      // sitters: stay put on their towel (legs out, facing the ocean).
      // A fast car or gunshot scares them off the towel for good.
      if (p.mode === 'sit') {
        if (!flee) {
          var ud0 = p.mesh.userData;
          ud0.legL.rotation.x = -1.35; ud0.legR.rotation.x = -1.35;
          ud0.armL.rotation.x = -0.4; ud0.armR.rotation.x = -0.4;
          p.mesh.position.set(p.x, 0, p.z);
          p.mesh.rotation.y = p.yaw;
          continue;
        }
        p.mode = 'beach';
      }
      var speed = p.walkSpeed || 1.6, tx = p.tx, tz = p.tz;
      if (flee) {
        speed = 7;
        p.hopY = 0; // stop any volleyball hop while running away
        var fx = p.x - threatX, fz = p.z - threatZ, fl = Math.sqrt(fx * fx + fz * fz) || 1;
        tx = p.x + fx / fl * 30; tz = p.z + fz / fl * 30;
      } else if (G.dist2d(p.x, p.z, p.tx, p.tz) < 2) {
        p.timer -= dt;
        if (p.timer <= 0) { p.timer = G.rrange(1, 4); G.pickPedTarget(p); }
        speed = 0;
      }
      // volleyball: shuffle along your side of the net, hop now and then
      if (p.mode === 'volley' && !flee) {
        p.volleyT -= dt;
        if (p.volleyT <= 0) {
          p.volleyT = G.rrange(1.5, 3.5);
          p.volleySide = p.volleySide ? 0 : 1;
          p.hopT = 0.55;
        }
        tx = p.homeX; tz = p.volleySide ? -16 : -24;
        speed = 2.2;
        if (p.hopT > 0) {
          p.hopT -= dt;
          p.hopY = Math.abs(Math.sin((0.55 - Math.max(p.hopT, 0)) / 0.55 * Math.PI)) * 0.55;
        } else p.hopY = 0;
      }
      var dx = tx - p.x, dz = tz - p.z, dl = Math.sqrt(dx * dx + dz * dz);
      if (dl > 0.2 && speed > 0) {
        var want = Math.atan2(dx, dz);
        p.yaw = G.angleLerp(p.yaw, want, Math.min(1, 8 * dt));
        p.x += Math.sin(p.yaw) * speed * dt;
        p.z += Math.cos(p.yaw) * speed * dt;
        var res = G.collideCircle(p.x, p.z, 0.5);
        p.x = res.x; p.z = res.z;
      }
      // smooth the walk cycle: ease the speed in/out so legs never snap
      // when a ped starts, stops, or changes pace
      p.smoothSpeed = G.lerp(p.smoothSpeed || 0, speed, Math.min(1, 6 * dt));
      p.phase += p.smoothSpeed * dt * 2.2;
      var sw = Math.sin(p.phase) * clamp(p.smoothSpeed / 5, 0, 1) * 0.6;
      var ud = p.mesh.userData;
      ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw;
      ud.armL.rotation.x = -sw * 0.7; ud.armR.rotation.x = sw * 0.7;
      var bob = Math.abs(Math.sin(p.phase)) * 0.07 * clamp(p.smoothSpeed / 5, 0, 1);
      p.mesh.position.set(p.x, (p.hopY || 0) + bob, p.z);
      p.mesh.rotation.y = p.yaw;
    }
  }
  G.updatePeds = updatePeds;

  function killPed(p, cause) {
    p.dead = true; p.deadTimer = 22;
    p.mesh.rotation.x = -Math.PI / 2;
    p.mesh.position.y = 0.25;
    if (cause === 'car') { G.addHeat(12); G.ui && G.ui.callout('Pedestrian down! Witnesses called the SBPD.', 'ELENA · CREW'); }
    else if (cause === 'shot') { G.addHeat(15); G.money += 25; }
  }
  G.killPed = killPed;
})();

(function () {
  'use strict';
  var G = window.G;
  var THREE = window.THREE;
  var clamp = G.clamp;

  // ---------------- damage / money ----------------
  G.damagePlayer = function (n) {
    if (G.state !== 'playing' || n <= 0) return;
    var rem = n;
    if (G.armour > 0) { var a = Math.min(G.armour, rem); G.armour -= a; rem -= a; }
    G.health -= rem;
    if (G.ui) G.ui.flash();
    if (G.health <= 0) { G.health = 0; G.busted(); }
  };
  G.healPlayer = function (n) { G.health = Math.min(100, G.health + n); };
  G.addMoney = function (n) { G.money += n; G.score += n; G.persist(); };

  // ---------------- police + helicopter ----------------
  G.police = [];
  G.heli = null;
  var POLICE_TYPE = { name: 'SBPD CRUISER', color: 0x1c1c22, maxSpeed: 42, accel: 14.5, grip: 12 };
  var arrestTimer = 0;

  function spawnPoliceCar() {
    // spawn on a road 70-100 units from the player
    var px = G.player.x, pz = G.player.z;
    var a = Math.random() * Math.PI * 2, r = G.rrange(70, 100);
    var x = clamp(px + Math.cos(a) * r, -G.layout.HALF, G.layout.HALF);
    var z = clamp(pz + Math.sin(a) * r, -G.layout.HALF, G.layout.HALF);
    var rc = G.nearestRoad(x);
    x = rc + (Math.random() < 0.5 ? -4 : 4);
    var c = G.makeCar(POLICE_TYPE, x, z, Math.random() * Math.PI * 2, true, true);
    c.ai = true; c.isPolice = true;
    G.police.push(c);
    return c;
  }
  function removePoliceCar(c) {
    var i = G.police.indexOf(c);
    if (i >= 0) G.police.splice(i, 1);
    G.scene.remove(c.mesh); G.scene.remove(c.shadow);
    c.dead = true;
  }
  G.spawnPoliceCar = spawnPoliceCar;

  // detailed SBPD police helicopter (built on the shared heli mesh)
  function makeHeli() {
    var g = G.makeHeliMesh(0xf2f2f2, 'SBPD', 0x1e3a8a);   // white body, police-blue stripe
    // NOTE: do NOT scale the group — a scaled parent breaks the SBPD label
    // sprite in three r128 (label renders on the unscaled news heli, vanishes here)
    // light bar on the roof (flashing, driven in updatePolice)
    var red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    red.position.set(-0.28, 2.0, -0.25); g.add(red);
    var blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: 0x2040ff }));
    blue.position.set(0.28, 2.0, -0.25); g.add(blue);
    g.userData.lightRed = red; g.userData.lightBlue = blue;
    // searchlight fixture under the nose + bright cone + ground spot
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    lamp.position.set(0, 0.1, 3.2); g.add(lamp);
    var cone = new THREE.Mesh(new THREE.ConeGeometry(7, 28, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    cone.position.y = -14; g.add(cone);
    var spot = new THREE.Mesh(new THREE.CircleGeometry(7, 20), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.32, depthWrite: false }));
    spot.rotation.x = -Math.PI / 2; spot.position.y = -27.5; g.add(spot);
    g.userData.spot = spot;
    G.scene.add(g);
    if (g.userData.labelPlane) G.scene.add(g.userData.labelPlane); // scene-parented: renders reliably
    return { mesh: g, angle: 0 };
  }

  function updatePolice(dt) {
    var want = Math.min(G.wanted, 4);
    // spawn to match wanted level
    if (G.wanted > 0 && G.police.length < want) spawnPoliceCar();
    // helicopter at 3+ stars
    if (G.wanted >= 3 && !G.heli) { G.heli = makeHeli(); if (G.ui) G.ui.callout('Air-1 is overhead. Their spotlight never blinks.', 'SBPD DISPATCH'); }
    if (G.wanted < 3 && G.heli) { G.scene.remove(G.heli.mesh); if (G.heli.mesh.userData.labelPlane) G.scene.remove(G.heli.mesh.userData.labelPlane); G.heli = null; }
    if (G.heli) {
      var h = G.heli;
      h.angle += dt * 0.35;
      var tx = G.player.x + Math.cos(h.angle) * 30, tz = G.player.z + Math.sin(h.angle) * 30; // wide orbit: side of the heli (white body + SBPD label) reads from the ground instead of a dark belly
      h.mesh.position.x = G.lerp(h.mesh.position.x, tx, 0.03);
      h.mesh.position.z = G.lerp(h.mesh.position.z, tz, 0.03);
      h.mesh.position.y = 30;
      h.mesh.rotation.y = Math.atan2(G.player.x - h.mesh.position.x, G.player.z - h.mesh.position.z);
      // billboard the SBPD label toward the camera (scene-parented plane)
      if (G.billboardHeliLabel) G.billboardHeliLabel(h.mesh);
      if (h.mesh.userData.rotor) h.mesh.userData.rotor.rotation.y += dt * 25;
      if (h.mesh.userData.tailRotor) h.mesh.userData.tailRotor.rotation.z += dt * 30;
      // light bar flash
      var ph2 = (G.time * 6) % 2 < 1;
      if (h.mesh.userData.lightRed) h.mesh.userData.lightRed.material.color.setHex(ph2 ? 0xff2020 : 0x551010);
      if (h.mesh.userData.lightBlue) h.mesh.userData.lightBlue.material.color.setHex(ph2 ? 0x101055 : 0x2040ff);
      // spotlight follows the player
      h.mesh.userData.spot.position.x = G.player.x - h.mesh.position.x;
      h.mesh.userData.spot.position.z = G.player.z - h.mesh.position.z;
    }
    // despawn all when heat is gone
    if (G.wanted === 0) {
      for (var i = G.police.length - 1; i >= 0; i--) removePoliceCar(G.police[i]);
      arrestTimer = 0;
      return;
    }
    var px = G.player.x, pz = G.player.z;
    var nearestCop = 1e9;
    for (var j = 0; j < G.police.length; j++) {
      var c = G.police[j];
      var d = G.dist2d(c.x, c.z, px, pz);
      if (d < nearestCop) nearestCop = d;
      // pursuit steering: aim at player with a little lead
      var lead = 0.35;
      var lx = px + (G.player.inCar && G.player.car ? G.player.car.vx * lead : 0);
      var lz = pz + (G.player.inCar && G.player.car ? G.player.car.vz * lead : 0);
      var want2 = Math.atan2(lx - c.x, lz - c.z);
      var diff = want2 - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      var steerIn = clamp(diff * 2.2, -1, 1);
      G.updateCarPhysics(c, 1, steerIn, false, false, dt);
      // light bar flash
      var ph = (G.time * 6) % 2 < 1;
      if (c.mesh.userData.lightRed) c.mesh.userData.lightRed.material.color.setHex(ph ? 0xff2020 : 0x551010);
      if (c.mesh.userData.lightBlue) c.mesh.userData.lightBlue.material.color.setHex(ph ? 0x101055 : 0x2040ff);
      // ram the player
      if (G.player.inCar && G.player.car) {
        if (G.collideCircles(c, G.player.car, 1.7, 1.7)) {
          var rel = Math.abs(c.speed - G.player.car.speed);
          if (rel > 4) {
            G.player.car.condition = Math.max(0, G.player.car.condition - rel * 0.5);
            G.damagePlayer(rel * 0.25);
          }
        }
      } else {
        if (d < 3.5) {
          arrestTimer += dt;
          if (arrestTimer > 2) { G.busted(); return; }
        } else arrestTimer = Math.max(0, arrestTimer - dt * 2);
        if (d < 2.2) { // cop shoves the player
          var nx = (px - c.x) / (d || 1), nz = (pz - c.z) / (d || 1);
          G.player.x += nx * 6 * dt; G.player.z += nz * 6 * dt;
          G.damagePlayer(4 * dt);
        }
      }
      // stuck? respawn near player
      var sp = Math.sqrt(c.vx * c.vx + c.vz * c.vz);
      if (sp < 1 && G.wanted > 0) {
        c.stuckTimer += dt;
        if (c.stuckTimer > 3.5) { removePoliceCar(c); spawnPoliceCar(); }
      } else c.stuckTimer = 0;
      // too far? despawn
      if (d > 170) { c.farTimer = (c.farTimer || 0) + dt; if (c.farTimer > 8) removePoliceCar(c); }
      else c.farTimer = 0;
    }
    G.nearestCop = nearestCop;
    // police vs police + traffic (soft push)
    for (var a = 0; a < G.police.length; a++) for (var b = a + 1; b < G.police.length; b++) G.collideCircles(G.police[a], G.police[b], 1.7, 1.7);
  }
  G.updatePolice = updatePolice;

  function explodePoliceCar(c) {
    var boom = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.95 }));
    boom.position.set(c.x, 1.5, c.z);
    G.scene.add(boom);
    var t0 = G.time;
    var iv = setInterval(function () {
      var k = (G.time - t0) / 0.7;
      if (k >= 1) { G.scene.remove(boom); clearInterval(iv); return; }
      boom.scale.setScalar(1 + k * 2.2);
      boom.material.opacity = 0.95 * (1 - k);
    }, 50);
    removePoliceCar(c);
    G.addHeat(20);
    G.addMoney(100);
    if (G.ui) G.ui.callout('Cruiser down! +$100 — but the whole city heard that.', 'ELENA · CREW');
  }
  G.explodePoliceCar = explodePoliceCar;

  // ---------------- combat ----------------
  G.weapons = [
    { name: 'PISTOL', damage: 34, rate: 0.22, spread: 0.012, mag: Infinity, reserve: Infinity, auto: false },
    { name: 'SMG', damage: 18, rate: 0.085, spread: 0.05, mag: 30, reserve: 90, auto: true }
  ];
  G.weaponIdx = 0;
  G.fireCooldown = 0;
  G.reloading = false;
  G.reloadTimer = 0;
  G.lastShotAt = -10; G.lastShotX = 0; G.lastShotZ = 0;

  var raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  var tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 });
  var tracerGeo = new THREE.BufferGeometry();
  var tracer = new THREE.Line(tracerGeo, tracerMat);
  tracer.visible = false; tracer.frustumCulled = false;
  G.scene.add(tracer);
  var flashLight = new THREE.PointLight(0xffd76a, 0, 18);
  G.scene.add(flashLight);
  var sparkGeo = new THREE.SphereGeometry(0.16, 6, 5);
  var sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd76a });

  G.setWeapon = function (i) {
    if (i === 1 && G.weapons[1].mag <= 0 && G.weapons[1].reserve <= 0) { if (G.ui) G.ui.callout('No SMG ammo — grab the gun pickup near the plaza.', 'ELENA · CREW'); return; }
    G.weaponIdx = i;
    if (G.ui) G.ui.updateWeapon();
  };
  G.reload = function () {
    var w = G.weapons[G.weaponIdx];
    if (w.mag === Infinity || G.reloading) return;
    var need = 30 - w.mag;
    if (need <= 0 || w.reserve <= 0) return;
    G.reloading = true; G.reloadTimer = 1.1;
  };

  function shootables() {
    var list = [];
    for (var i = 0; i < G.peds.length; i++) if (!G.peds[i].dead) list.push(G.peds[i].mesh);
    for (var j = 0; j < G.police.length; j++) list.push(G.police[j].mesh);
    for (var k = 0; k < G.buildings.length; k++) { /* buildings via mesh list below */ }
    return list;
  }
  // building meshes for raycast (collected from scene by userData flag)
  G.buildingMeshes = [];
  // (filled in chunk 4 boot: tag meshes at creation is complex; instead raycast
  //  against a cheap AABB slab test for buildings — see shoot().)

  G.rayHitBuilding = rayHitBuilding; // reused by camera collision (chunk 4)

  function rayHitBuilding(origin, dir, maxDist) {
    // slab test against building AABBs (y 0..h)
    var best = maxDist, hit = null;
    for (var i = 0; i < G.colliders.length; i++) {
      var c = G.colliders[i];
      var h = c.h || 20;
      var tmin = 0, tmax = maxDist, ok = true;
      // x slab
      if (Math.abs(dir.x) < 1e-8) { if (origin.x < c.x1 || origin.x > c.x2) ok = false; }
      else {
        var tx1 = (c.x1 - origin.x) / dir.x, tx2 = (c.x2 - origin.x) / dir.x;
        var t1 = Math.min(tx1, tx2), t2 = Math.max(tx1, tx2);
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) ok = false;
      }
      if (!ok) continue;
      if (Math.abs(dir.z) < 1e-8) { if (origin.z < c.z1 || origin.z > c.z2) ok = false; }
      else {
        var tz1 = (c.z1 - origin.z) / dir.z, tz2 = (c.z2 - origin.z) / dir.z;
        var tz1m = Math.min(tz1, tz2), tz2m = Math.max(tz1, tz2);
        tmin = Math.max(tmin, tz1m); tmax = Math.min(tmax, tz2m);
        if (tmin > tmax) ok = false;
      }
      if (!ok) continue;
      // y slab (building height)
      if (Math.abs(dir.y) < 1e-8) { if (origin.y < 0 || origin.y > h) ok = false; }
      else {
        var ty1 = (0 - origin.y) / dir.y, ty2 = (h - origin.y) / dir.y;
        var ty1m = Math.min(ty1, ty2), ty2m = Math.max(ty1, ty2);
        tmin = Math.max(tmin, ty1m); tmax = Math.min(tmax, ty2m);
        if (tmin > tmax) ok = false;
      }
      if (ok && tmin < best && tmin > 0) { best = tmin; hit = { dist: tmin, x: origin.x + dir.x * tmin, y: origin.y + dir.y * tmin, z: origin.z + dir.z * tmin }; }
    }
    return hit;
  }

  G.shoot = function () {
    if (G.state !== 'playing' || G.fireCooldown > 0 || G.reloading) return;
    var w = G.weapons[G.weaponIdx];
    if (w.mag !== Infinity && w.mag <= 0) { G.reload(); return; }
    G.fireCooldown = w.rate;
    if (w.mag !== Infinity) w.mag--;
    var cam = G.camera;
    var origin = cam.position.clone();
    var dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    // spread
    dir.x += (Math.random() - 0.5) * w.spread * 2;
    dir.y += (Math.random() - 0.5) * w.spread * 2;
    dir.z += (Math.random() - 0.5) * w.spread * 2;
    dir.normalize();
    // raycast peds + police (mesh raycast), buildings (slab)
    raycaster.set(origin, dir);
    var hits = raycaster.intersectObjects(shootables(), true);
    var bHit = rayHitBuilding(origin, dir, 90);
    var end = origin.clone().addScaledVector(dir, 90);
    var hitKind = null, hitObj = null;
    if (hits.length > 0 && hits[0].distance < (bHit ? bHit.dist : 90)) {
      end = hits[0].point.clone();
      var o = hits[0].object;
      // walk up to the ped/car group root
      var root = o;
      while (root.parent && root.parent !== G.scene) root = root.parent;
      hitObj = root;
      hitKind = 'mesh';
    } else if (bHit) {
      end = new THREE.Vector3(bHit.x, bHit.y, bHit.z);
      hitKind = 'building';
    }
    // tracer + flash
    tracerGeo.setFromPoints([origin.clone().addScaledVector(dir, 1.2), end]);
    tracer.visible = true;
    setTimeout(function () { tracer.visible = false; }, 60);
    flashLight.position.copy(origin).addScaledVector(dir, 1.5);
    flashLight.intensity = 2.2;
    setTimeout(function () { flashLight.intensity = 0; }, 45);
    // resolve hit
    if (hitKind === 'mesh' && hitObj) {
      var ped = null, cop = null;
      for (var i = 0; i < G.peds.length; i++) if (G.peds[i].mesh === hitObj) ped = G.peds[i];
      for (var j = 0; j < G.police.length; j++) if (G.police[j].mesh === hitObj) cop = G.police[j];
      if (ped) { G.killPed(ped, 'shot'); }
      else if (cop) {
        cop.condition -= w.damage;
        if (cop.condition <= 0) G.explodePoliceCar(cop);
        else { G.addHeat(6); }
      }
    } else if (hitKind === 'building') {
      var s = new THREE.Mesh(sparkGeo, sparkMat);
      s.position.copy(end);
      G.scene.add(s);
      setTimeout(function () { G.scene.remove(s); }, 120);
    }
    G.lastShotAt = G.time; G.lastShotX = G.player.x; G.lastShotZ = G.player.z;
    G.addHeat(3);
    if (G.ui) G.ui.onShoot();
    if (G.audio) G.audio.shot();
  };
})();

(function () {
  'use strict';
  var G = window.G;
  var THREE = window.THREE;
  var clamp = G.clamp;

  // ---------------- mission beacons + marker ----------------
  function makeTextSprite(text, color) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var ctx = c.getContext('2d');
    ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,8,18,0.85)'; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = color || '#ffd76a'; ctx.stroke();
    ctx.fillStyle = color || '#ffd76a';
    ctx.font = '900 64px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 68);
    var tex = new THREE.CanvasTexture(c);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(7, 7, 1);
    return sp;
  }
  G.makeTextSprite = makeTextSprite;

  function makeBeacon(x, z, color) {
    var g = new THREE.Group();
    var cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 30, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: color || 0xffd76a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    );
    cyl.position.y = 15; g.add(cyl);
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2.6, 24),
      new THREE.MeshBasicMaterial({ color: color || 0xffd76a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    var spr = makeTextSprite('M', '#ffd76a');
    spr.position.y = 7; g.add(spr);
    g.userData.ring = ring; g.userData.spr = spr;
    g.position.set(x, 0, z);
    G.scene.add(g);
    return g;
  }

  // ---------------- missions ----------------
  var H = G.layout.HALF;
  G.missions = [
    {
      id: 0, title: 'SUNSET PICKUP', reward: 2500, time: 180,
      start: { x: 0, z: 0 },
      stages: [
        { text: 'Pick up the package at the plaza', type: 'reach', x: 0, z: 0, r: 5 },
        { text: 'Deliver it to the Pier — watch the sunset', type: 'reach', x: H + 12, z: 40, r: 6 }
      ],
      intro: 'ELENA: A client left a package at the plaza. Grab it, take it to the Pier. Easy money.'
    },
    {
      id: 1, title: 'HOT PACKAGE', reward: 4000, time: 240,
      start: { x: 114, z: -60 },
      stages: [
        { text: 'Steal the gold NEON COUPE on Coral Row', type: 'enterCar', x: 114, z: -60, r: 5 },
        { text: 'Deliver the coupe to the Garage — lose the heat on the way', type: 'reach', x: -114, z: -140, r: 6 }
      ],
      intro: 'MIRA: That gold coupe is ours tonight. Take it — the cops WILL notice. Get it to the Garage.'
    },
    {
      id: 2, title: 'CORAL STRIP BREAKOUT', reward: 6500, time: 300,
      start: { x: 38, z: -150 },
      stages: [
        { text: 'Checkpoint 1/3 — Ocean Blvd', type: 'reach', x: -110, z: -40, r: 6 },
        { text: 'Checkpoint 2/3 — Palm Row', type: 'reach', x: 114, z: 60, r: 6 },
        { text: 'Checkpoint 3/3 — Coral Strip', type: 'reach', x: -40, z: 130, r: 6 },
        { text: 'Escape to the Beach — do not stop', type: 'reach', x: H + 12, z: -80, r: 7 }
      ],
      intro: 'ELENA: The Strip is locked down. Punch through all three checkpoints and vanish on the beach.'
    }
  ];
  G.activeMission = null;
  G.missionBeacons = [];
  G.missions.forEach(function (m) {
    if (G.save.missionsDone.indexOf(m.id) < 0) {
      m.beacon = makeBeacon(m.start.x, m.start.z, 0xffd76a);
      G.missionBeacons.push(m);
    }
  });
  // mission target marker (moves per stage)
  G.marker = makeBeacon(0, 0, 0x7dff8a);
  G.marker.visible = false;

  // the gold target car for mission 2
  var goldCar = G.makeCar({ name: 'NEON COUPE', color: 0xffd76a, maxSpeed: 40, accel: 14, grip: 13.5 }, 114, -60, Math.PI / 2, false);
  goldCar.parked = true; goldCar.missionCar = true;
  G.cars.push(goldCar);
  G.goldCar = goldCar;

  function startMission(def) {
    if (G.activeMission) return false;
    G.activeMission = { def: def, stageIdx: 0, timeLeft: def.time };
    if (def.beacon) def.beacon.visible = false;
    if (def.id === 2) G.addHeat(25);
    setStageTarget();
    if (G.ui) { G.ui.callout(def.intro, 'MISSION · ' + def.title); G.ui.toast(def.title + ' — START', 'good'); }
    if (G.audio) G.audio.mission();
    return true;
  }
  G.startMission = startMission;

  function setStageTarget() {
    var am = G.activeMission;
    if (!am) { G.marker.visible = false; return; }
    var st = am.def.stages[am.stageIdx];
    G.marker.position.set(st.x, 0, st.z);
    G.marker.visible = true;
    if (G.ui) G.ui.updateMission();
  }

  function advanceStage() {
    var am = G.activeMission;
    if (!am) return;
    am.stageIdx++;
    if (am.stageIdx >= am.def.stages.length) { completeMission(); return; }
    setStageTarget();
    if (G.ui) G.ui.callout(am.def.stages[am.stageIdx].text, 'STAGE ' + (am.stageIdx + 1) + '/' + am.def.stages.length);
    if (G.audio) G.audio.pickup();
  }

  function completeMission() {
    var am = G.activeMission;
    if (!am) return;
    G.addMoney(am.def.reward);
    G.heat = Math.max(0, G.heat - 40);
    G.wanted = G.starsFromHeat(G.heat);
    if (G.save.missionsDone.indexOf(am.def.id) < 0) G.save.missionsDone.push(am.def.id);
    G.persist();
    if (G.ui) { G.ui.toast('MISSION COMPLETE  +$' + am.def.reward.toLocaleString(), 'good'); G.ui.callout('Clean work. The money is yours.', 'ELENA · CREW'); }
    if (G.audio) G.audio.mission();
    G.activeMission = null;
    G.marker.visible = false;
    if (G.ui) G.ui.updateMission();
  }
  function failMission(reason) {
    var am = G.activeMission;
    if (!am) return;
    if (G.ui) { G.ui.toast('MISSION FAILED — ' + reason, 'bad'); G.ui.callout('That one is burned. Find another M beacon when you are ready.', 'ELENA · CREW'); }
    if (am.def.beacon) am.def.beacon.visible = true;
    G.activeMission = null;
    G.marker.visible = false;
    if (G.ui) G.ui.updateMission();
  }
  G.failMission = failMission;

  function updateMission(dt) {
    var am = G.activeMission;
    if (!am) return;
    am.timeLeft -= dt;
    if (am.timeLeft <= 0) { failMission('OUT OF TIME'); return; }
    var st = am.def.stages[am.stageIdx];
    if (st.type === 'reach') {
      var d = G.dist2d(G.player.x, G.player.z, st.x, st.z);
      if (d < st.r) advanceStage();
    } else if (st.type === 'enterCar') {
      if (G.player.inCar && G.player.car === G.goldCar) {
        G.addHeat(25);
        if (G.ui) G.ui.callout('You took the coupe! SBPD is on you — drive!', 'MIRA · CREW');
        advanceStage();
      }
    }
  }

  G.tryStartNextMission = function () {
    if (G.activeMission) return;
    // nearest beacon within 10
    var best = null, bd = 1e9;
    G.missionBeacons.forEach(function (m) {
      if (G.save.missionsDone.indexOf(m.id) >= 0) return;
      var d = G.dist2d(G.player.x, G.player.z, m.start.x, m.start.z);
      if (d < bd) { bd = d; best = m; }
    });
    if (best && bd < 12) { startMission(best); return; }
    // otherwise start the next undone mission in order
    for (var i = 0; i < G.missions.length; i++) {
      if (G.save.missionsDone.indexOf(G.missions[i].id) < 0) { startMission(G.missions[i]); return; }
    }
    if (G.ui) G.ui.callout('All missions cleared. Free roam — cause some trouble.', 'ELENA · CREW');
  };

  // ---------------- pickups ----------------
  G.pickups = [];
  function makePickup(kind, x, z) {
    var label = kind === 'cash' ? '$' : (kind === 'health' ? '+' : 'SMG');
    var color = kind === 'cash' ? '#7dff8a' : (kind === 'health' ? '#ff8b8b' : '#ffd76a');
    var spr = makeTextSprite(label, color);
    spr.position.set(x, 2.2, z);
    G.scene.add(spr);
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.0, 20),
      new THREE.MeshBasicMaterial({ color: kind === 'cash' ? 0x7dff8a : (kind === 'health' ? 0xff8b8b : 0xffd76a), transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.1, z);
    G.scene.add(ring);
    var p = { kind: kind, x: x, z: z, spr: spr, ring: ring, active: true, respawn: 0 };
    G.pickups.push(p);
    return p;
  }
  function randomRoadPoint() {
    var rc = G.roadCenters[Math.floor(Math.random() * G.roadCenters.length)];
    if (Math.random() < 0.5) return { x: G.rrange(-H, H), z: rc + (Math.random() < 0.5 ? -10 : 10) };
    return { x: rc + (Math.random() < 0.5 ? -10 : 10), z: G.rrange(-H, H) };
  }
  for (var ci = 0; ci < 6; ci++) { var cp = randomRoadPoint(); makePickup('cash', cp.x, cp.z); }
  makePickup('health', 10, -160);
  makePickup('smg', -100, 40);
  G.makePickup = makePickup;

  function updatePickups(dt) {
    for (var i = 0; i < G.pickups.length; i++) {
      var p = G.pickups[i];
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) {
          if (p.kind === 'cash') { var np = randomRoadPoint(); p.x = np.x; p.z = np.z; }
          p.spr.position.set(p.x, 2.2, p.z);
          p.ring.position.set(p.x, 0.1, p.z);
          p.spr.visible = true; p.ring.visible = true; p.active = true;
        }
        continue;
      }
      p.spr.position.y = 2.2 + Math.sin(G.time * 2 + i) * 0.3;
      p.spr.material.rotation = Math.sin(G.time * 0.8 + i) * 0.2;
      var d = G.dist2d(G.player.x, G.player.z, p.x, p.z);
      if (d < 2.6) {
        p.active = false; p.respawn = p.kind === 'cash' ? 25 : (p.kind === 'health' ? 45 : 60);
        p.spr.visible = false; p.ring.visible = false;
        if (p.kind === 'cash') { G.addMoney(150); if (G.ui) G.ui.toast('+$150', 'good'); }
        else if (p.kind === 'health') { G.healPlayer(50); if (G.ui) G.ui.toast('HEALTH +50', 'good'); }
        else { G.weapons[1].mag = 30; G.weapons[1].reserve = 120; G.setWeapon(1); if (G.ui) G.ui.toast('SMG ACQUIRED', 'good'); }
        if (G.audio) G.audio.pickup();
      }
    }
  }

  // ---------------- enter / exit car ----------------
  function nearestCar(maxD) {
    var best = null, bd = maxD;
    var all = G.cars.concat(G.traffic);
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (c.dead || c.isPolice) continue;
      var d = G.dist2d(G.player.x, G.player.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  G.nearestCar = nearestCar;

  function enterExitCar() {
    var p = G.player;
    if (p.inCar) {
      // exit: place player beside the car
      var c = p.car;
      var rx = -Math.cos(c.heading), rz = Math.sin(c.heading);
      p.x = c.x + rx * 2.6; p.z = c.z + rz * 2.6;
      p.y = 0; p.vy = 0; p.vx = 0; p.vz = 0;
      p.yaw = c.heading;
      p.inCar = false; p.car = null;
      p.mesh.visible = true;
      p.mesh.position.set(p.x, 0, p.z);
      p.shadow.visible = true;
      return;
    }
    var car = nearestCar(4.6);
    if (!car) return;
    p.inCar = true; p.car = car;
    car.parked = false;
    if (car.mesh.userData.driver) {
      // the driver bails when you steal their ride
      car.mesh.remove(car.mesh.userData.driver);
      car.mesh.userData.driver = null;
    }
    p.mesh.visible = false;
    p.shadow.visible = false;
    if (car !== G.playerCar && !car.stolen) {
      car.stolen = true;
      G.addHeat(15);
      if (G.ui) G.ui.callout('Stolen! A witness called the SBPD.', 'ELENA · CREW');
    }
    if (G.ui) G.ui.updateWeapon();
  }
  G.enterExitCar = enterExitCar;

  // ---------------- busted / pause / unstick ----------------
  G.busted = function () {
    if (G.state !== 'playing') return;
    G.state = 'busted';
    G.money = Math.max(0, G.money - 500);
    G.heat = 0; G.wanted = 0;
    for (var i = G.police.length - 1; i >= 0; i--) {
      var c = G.police[i];
      G.scene.remove(c.mesh); G.scene.remove(c.shadow);
    }
    G.police.length = 0;
    if (G.heli) { G.scene.remove(G.heli.mesh); if (G.heli.mesh.userData.labelPlane) G.scene.remove(G.heli.mesh.userData.labelPlane); G.heli = null; }
    if (G.activeMission) failMission('BUSTED');
    G.persist();
    if (G.ui) G.ui.showBusted();
  };
  G.respawn = function () {
    var p = G.player;
    p.inCar = false; p.car = null;
    p.x = 10; p.z = -160; p.y = 0; p.vy = 0; p.vx = 0; p.vz = 0;
    p.mesh.visible = true; p.shadow.visible = true;
    p.mesh.position.set(p.x, 0, p.z);
    G.health = 100; G.armour = 50;
    G.cam.yaw = Math.PI; G.cam.targetYaw = Math.PI;
    G.cam.targetOffset = 0; G.cam.targetPitch = 0.32;
    G.state = 'playing';
    if (G.ui) G.ui.showHud();
  };
  G.togglePause = function () {
    if (G.state === 'playing') { G.state = 'paused'; if (G.ui) G.ui.showPause(true); }
    else if (G.state === 'paused') { G.state = 'playing'; if (G.ui) G.ui.showPause(false); }
  };
  G.unstick = function () {
    var p = G.player;
    var rc = G.nearestRoad(p.x);
    if (p.inCar && p.car) { p.car.x = rc; p.car.z = p.z; p.car.vx = 0; p.car.vz = 0; }
    else { p.x = rc; p.vx = 0; p.vz = 0; }
    if (G.ui) G.ui.callout('Unstuck — back on the road.', 'SYSTEM');
  };
  G.startGame = function (fresh) {
    if (fresh) { G.money = 1200; G.save.missionsDone = []; G.save.money = 1200; G.persist(); }
    else G.money = G.save.money;
    G.health = 100; G.armour = 50; G.heat = 0; G.wanted = 0;
    G.state = 'playing';
    if (G.ui) G.ui.showHud();
  };
  G.quitToMenu = function () {
    G.state = 'menu';
    G.save.money = G.money; G.persist();
    if (G.ui) G.ui.showMenu();
  };

  // ---------------- camera ----------------
  function updateCamera(dt) {
    var cam = G.camera;
    if (G.state === 'menu') {
      var a = G.time * 0.045;
      cam.position.set(Math.cos(a) * 130, 55, Math.sin(a) * 130);
      cam.lookAt(0, 8, 0);
      return;
    }
    var p = G.player;
    var tx = p.x, tz = p.z, ty = 2.0;
    if (p.inCar && p.car) { tx = p.car.x; tz = p.car.z; ty = 2.6; }
    // consume mouse/touch drag deltas into smoothed camera targets
    var dx = G.mouse.dx, dy = G.mouse.dy;
    G.mouse.dx = 0; G.mouse.dy = 0;
    G.cam.targetPitch = clamp(G.cam.targetPitch + dy * 0.003, 0.08, 0.85);
    if (p.inCar && p.car) {
      G.cam.targetOffset = clamp(G.cam.targetOffset - dx * 0.0042, -1.2, 1.2);
      if (!G.camDragging) G.cam.targetOffset = G.lerp(G.cam.targetOffset, 0, Math.min(1, 1.4 * dt));
      G.cam.offset = G.lerp(G.cam.offset, G.cam.targetOffset, Math.min(1, 10 * dt));
      var want = p.car.heading + Math.PI + G.cam.offset;
      G.cam.yaw = G.angleLerp(G.cam.yaw, want, Math.min(1, 2.4 * dt));
    } else {
      G.cam.targetYaw -= dx * 0.0042;
      G.cam.yaw = G.angleLerp(G.cam.yaw, G.cam.targetYaw, 1 - Math.exp(-14 * dt));
    }
    G.cam.pitch = G.lerp(G.cam.pitch, G.cam.targetPitch, 1 - Math.exp(-14 * dt));
    var speed = p.inCar && p.car ? (p.car.speed || 0) : Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    var wantDist = (p.inCar ? 12 : 9.5) + Math.min(speed * 0.09, 3.5);
    G.cam.dist = G.lerp(G.cam.dist, wantDist, Math.min(1, 3 * dt));
    var cp = Math.cos(G.cam.pitch), sp2 = Math.sin(G.cam.pitch);
    // keep the camera out of buildings: ray from target toward the camera, clamp dist
    if (G.rayHitBuilding) {
      var ddx = Math.sin(G.cam.yaw) * cp, ddy = sp2, ddz = Math.cos(G.cam.yaw) * cp;
      var hit = G.rayHitBuilding({ x: tx, y: ty, z: tz }, { x: ddx, y: ddy, z: ddz }, G.cam.dist + 0.5);
      if (hit && hit.dist > 0.5) G.cam.dist = Math.max(2.4, Math.min(G.cam.dist, hit.dist - 0.7));
    }
    var cx = tx + Math.sin(G.cam.yaw) * G.cam.dist * cp;
    var cz = tz + Math.cos(G.cam.yaw) * G.cam.dist * cp;
    var cy = ty + G.cam.dist * sp2;
    var k = 1 - Math.exp(-9 * dt);
    cam.position.x += (cx - cam.position.x) * k;
    cam.position.y += (cy - cam.position.y) * k;
    cam.position.z += (cz - cam.position.z) * k;
    // debug: aim the camera at an arbitrary point (e.g. the police heli)
    if (G.debugCamTarget) cam.lookAt(G.debugCamTarget.x, G.debugCamTarget.y, G.debugCamTarget.z);
    else cam.lookAt(tx, ty, tz);
  }

  // ---------------- main loop ----------------
  var STEP = 1 / 120;
  var acc = 0, last = performance.now();
  G.playerSpeed = 0;

  function fixedUpdate(dt) {
    G.time += dt;
    G.clockMin += dt * 0.5;
    if (G.clockMin >= 24 * 60) { G.clockMin -= 24 * 60; G.day++; }
    var inp = G.readInput();
    var p = G.player;

    // enter / exit car (edge-triggered); E near a beacon starts that mission
    if (G.consumeKey('KeyE') || G.consumeTouch('car')) {
      if (p.inCar) enterExitCar();
      else if (nearestCar(4.6)) enterExitCar();
      else {
        var bestM = null, bdM = 12;
        G.missionBeacons.forEach(function (m) {
          if (G.save.missionsDone.indexOf(m.id) >= 0) return;
          var d = G.dist2d(p.x, p.z, m.start.x, m.start.z);
          if (d < bdM) { bdM = d; bestM = m; }
        });
        if (bestM) startMission(bestM);
      }
    }
    if (G.consumeTouch('mission')) G.tryStartNextMission();
    if (G.consumeTouch('cam')) {
      // reset the camera behind the player/car (KeyC / CAM button)
      var pp = G.player;
      if (pp.inCar && pp.car) G.cam.targetYaw = pp.car.heading + Math.PI;
      else G.cam.targetYaw = pp.yaw + Math.PI;
      G.cam.targetOffset = 0;
      G.cam.targetPitch = 0.32;
    }

    // fire (hold)
    if (inp.fire || G.touch.fire) {
      if (G.fireCooldown <= 0) G.shoot();
    }
    G.fireCooldown = Math.max(0, G.fireCooldown - dt);
    if (G.reloading) {
      G.reloadTimer -= dt;
      if (G.reloadTimer <= 0) {
        G.reloading = false;
        var w = G.weapons[G.weaponIdx];
        var need = 30 - w.mag, take = Math.min(need, w.reserve);
        w.mag += take; w.reserve -= take;
        if (G.ui) G.ui.updateWeapon();
      }
    }

    if (p.inCar && p.car) {
      var car = p.car;
      var throttle = inp.fwd;
      var steerIn = -inp.str;   // screen-right = steer right (heading decreases in our convention)
      G.updateCarPhysics(car, throttle, steerIn, inp.brake, inp.nitro, dt);
      p.x = car.x; p.z = car.z;
      G.playerSpeed = car.speed || 0;
      // nitro regen
      if (!inp.nitro) G.nitro = Math.min(100, G.nitro + 7 * dt);
      // car wrecked?
      if (car.condition <= 0) {
        car.condition = 0;
        var bx = car.x, bz = car.z;
        car.dead = true;
        G.scene.remove(car.mesh); G.scene.remove(car.shadow);
        var idx = G.cars.indexOf(car);
        if (idx >= 0) G.cars.splice(idx, 1);
        p.inCar = false; p.car = null;
        p.x = bx + 3; p.z = bz; p.mesh.visible = true; p.shadow.visible = true;
        p.mesh.position.set(p.x, 0, p.z);
        G.damagePlayer(30);
        if (G.ui) G.ui.callout('Your ride is wrecked!', 'ELENA · CREW');
        var boom = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.9 }));
        boom.position.set(bx, 1.5, bz);
        G.scene.add(boom);
        setTimeout(function () { G.scene.remove(boom); }, 600);
      }
    } else {
      G.updatePlayer(dt, inp);
      G.playerSpeed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    }

    G.updateTraffic(dt);
    G.updatePeds(dt);
    G.updatePolice(dt);
    updateMission(dt);
    updatePickups(dt);

    // heat decay: after 18s clean and no cop within 70 and no heli
    G.cleanTimer += dt;
    var nearCop = (G.nearestCop === undefined ? 1e9 : G.nearestCop);
    if (G.heat > 0 && G.cleanTimer > 18 && nearCop > 70 && !G.heli) {
      var before = G.wanted;
      G.heat = Math.max(0, G.heat - 4.5 * dt);
      G.wanted = G.starsFromHeat(G.heat);
      if (G.wanted < before && G.ui) G.ui.onWantedDown(G.wanted);
    }
    // mission beacons pulse
    for (var i = 0; i < G.missionBeacons.length; i++) {
      var b = G.missionBeacons[i];
      if (!b.beacon) continue;
      b.beacon.userData.ring.scale.setScalar(1 + Math.sin(G.time * 3 + i) * 0.12);
      b.beacon.userData.spr.position.y = 7 + Math.sin(G.time * 2 + i) * 0.5;
    }
    if (G.marker.visible) {
      G.marker.userData.ring.scale.setScalar(1 + Math.sin(G.time * 4) * 0.15);
      G.marker.userData.spr.position.y = 7 + Math.sin(G.time * 2.5) * 0.5;
    }
  }

  function loop(t) {
    requestAnimationFrame(loop);
    var dtRaw = Math.min((t - last) / 1000, 0.05);
    last = t;
    if (G.state === 'playing') {
      acc += dtRaw;
      var steps = 0;
      while (acc >= STEP && steps < 10) { fixedUpdate(STEP); acc -= STEP; steps++; }
      if (steps >= 10) acc = 0;
    } else if (G.state === 'menu') {
      G.time += dtRaw;
    }
    updateCamera(dtRaw);
    if (G.updateDecorations) G.updateDecorations(dtRaw);
    G.renderer.render(G.scene, G.camera);
    if (G.ui) G.ui.update(dtRaw);
  }
  requestAnimationFrame(loop);

  // ---------------- debug hooks (headless test) ----------------
  G.debug = {
    state: function () {
      return {
        state: G.state, x: +G.player.x.toFixed(1), z: +G.player.z.toFixed(1),
        inCar: G.player.inCar, speed: +G.playerSpeed.toFixed(1),
        wanted: G.wanted, heat: +G.heat.toFixed(1), money: G.money,
        health: G.health, armour: G.armour,
        mission: G.activeMission ? G.activeMission.def.id : null,
        missionStage: G.activeMission ? G.activeMission.stageIdx : null,
        police: G.police.length, heli: !!G.heli,
        errors: G.errors.slice()
      };
    },
    teleport: function (x, z) {
      var p = G.player;
      if (p.inCar && p.car) { p.car.x = x; p.car.z = z; p.car.vx = 0; p.car.vz = 0; }
      p.x = x; p.z = z; p.vx = 0; p.vz = 0;
    },
    setHeat: function (h) { G.heat = h; G.wanted = G.starsFromHeat(h); },
    startMission: function (i) { G.startMission(G.missions[i]); },
    enterCar: function () { enterExitCar(); },
    setTouch: function (o) { Object.assign(G.touch, o); },
    setCamTarget: function (x, y, z) { G.debugCamTarget = { x: x, y: y, z: z }; },
    clearCamTarget: function () { G.debugCamTarget = null; },
    heliPos: function () {
      return G.heli ? { x: +G.heli.mesh.position.x.toFixed(1), y: +G.heli.mesh.position.y.toFixed(1), z: +G.heli.mesh.position.z.toFixed(1) } : null;
    },
    setTrafficState: function (s) {
      // pin the lights to one phase (0 NS green, 1 NS yellow, 2 EW green,
      // 3 EW yellow) for deterministic red-light tests
      var D = G.DECOR || {};
      D.freezeLights = true;
      D.frozenState = s;
      D.trafficState = -1; // forces the cycle code to re-apply materials
    },
    unfreezeLights: function () { if (G.DECOR) G.DECOR.freezeLights = false; },
    trafficInfo: function () {
      return G.traffic.map(function (c) {
        return {
          x: +c.x.toFixed(1), z: +c.z.toFixed(1), heading: +c.heading.toFixed(2),
          speed: +(c.speed || 0).toFixed(1), driver: !!c.mesh.userData.driver,
          legAxis: c.legAxis, legDir: c.legDir, legEnd: c.legEnd,
          tx: +c.targetX.toFixed(1), tz: +c.targetZ.toFixed(1)
        };
      });
    },
    decor: function () {
      var d = G.DECOR || {};
      return {
        buildings: G.buildings.length, colliders: G.colliders.length,
        gulls: (d.gulls || []).length, clouds: (d.clouds || []).length,
        neonFlicker: (d.neonFlicker || []).length, trafficHeads: (d.trafficHeads || []).length,
        newsHeli: !!d.newsHeli, train: !!d.train, petals: !!d.petals,
        streetLamps: (d.streetLamps || []).length,
        stringBulbs: (d.stringBulbMats || []).length,
        waves: (d.waves || []).length,
        peds: G.peds.length,
        pedsByMode: G.peds.reduce(function (acc, p) { acc[p.mode] = (acc[p.mode] || 0) + 1; return acc; }, {}),
        traffic: G.traffic.length,
        trafficDrivers: G.traffic.filter(function (c) { return c.mesh.userData.driver; }).length,
        trafficState: d.trafficState,
        tallest: G.tallestBuilding || null
      };
    }
  };
  G.ready = true;
})();
