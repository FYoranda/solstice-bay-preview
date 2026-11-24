/* SOLSTICE BAY — ui.js
   HUD, minimap, menus, touch controls, and tiny WebAudio synth.
   Touch layer: FLOATING joystick on the left half (base appears where the
   thumb lands), right buttons (JUMP=jump/handbrake, FIRE, CAR, NITRO, CAM,
   MISSION), and one-finger drag on the right half orbits the camera. */
(function () {
  'use strict';
  var G = window.G;
  var clamp = G.clamp;

  var $ = function (id) { return document.getElementById(id); };
  var hud = $('hud'), menu = $('menu'), pauseMenu = $('pause-menu'), bustedEl = $('busted');
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  G.isTouch = isTouch;

  // ---------------- audio (tiny synth, all offline, guarded) ----------------
  var AudioSys = {
    ctx: null, master: null,
    ensure: function () {
      if (this.ctx) return true;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.14;
        this.master.connect(this.ctx.destination);
        return true;
      } catch (e) { return false; }
    },
    blip: function (freq, dur, type, vol, when) {
      if (!this.ensure()) return;
      try {
        var t = this.ctx.currentTime + (when || 0);
        var o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(vol || 1, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { /* ignore */ }
    },
    noise: function (dur, vol) {
      if (!this.ensure()) return;
      try {
        var len = Math.floor(this.ctx.sampleRate * dur);
        var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        var src = this.ctx.createBufferSource(); src.buffer = buf;
        var g = this.ctx.createGain(); g.gain.value = vol || 1;
        var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
        src.connect(f); f.connect(g); g.connect(this.master);
        src.start();
      } catch (e) { /* ignore */ }
    },
    shot: function () { this.noise(0.09, 0.9); this.blip(160, 0.07, 'square', 0.5); },
    pickup: function () { this.blip(660, 0.09, 'sine', 0.8); this.blip(880, 0.12, 'sine', 0.8, 0.08); },
    mission: function () { this.blip(523, 0.12, 'sine', 0.8); this.blip(659, 0.12, 'sine', 0.8, 0.11); this.blip(784, 0.2, 'sine', 0.9, 0.22); },
    busted: function () { this.blip(392, 0.25, 'sawtooth', 0.5); this.blip(311, 0.35, 'sawtooth', 0.5, 0.22); }
  };
  G.audio = AudioSys;

  // ---------------- toast / callout / flash ----------------
  var toastTimer = null, calloutTimer = null;
  function showToast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'panel ' + (kind || '');
    t.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }
  function showCallout(text, who) {
    var c = $('callout');
    c.innerHTML = (who ? '<b>' + who + ':</b> ' : '') + text;
    c.classList.remove('hidden');
    if (calloutTimer) clearTimeout(calloutTimer);
    calloutTimer = setTimeout(function () { c.classList.add('hidden'); }, 5000);
  }

  // ---------------- UI object ----------------
  var ui = {
    onWantedUp: function (stars) {
      showToast('WANTED — ' + '★'.repeat(stars), 'bad');
      showCallout('The SBPD is on you. Lose them or lay low.', 'SBPD DISPATCH');
    },
    onWantedDown: function (stars) {
      if (stars === 0) showToast('YOU LOST THE COPS', 'good');
    },
    onShoot: function () { /* ammo display refreshes in update() */ },
    toast: showToast,
    callout: showCallout,
    flash: function () {
      var v = $('vignette');
      v.style.opacity = '1';
      setTimeout(function () { v.style.opacity = '0'; }, 130);
    },
    updateWeapon: function () { /* refreshed in update() */ },
    updateMission: function () { /* refreshed in update() */ },
    showHud: function () {
      menu.classList.add('hidden'); pauseMenu.classList.add('hidden'); bustedEl.classList.add('hidden');
      hud.classList.remove('hidden');
      if (isTouch) $('touch-ui').classList.remove('hidden');
    },
    showMenu: function () {
      hud.classList.add('hidden'); pauseMenu.classList.add('hidden'); bustedEl.classList.add('hidden');
      $('touch-ui').classList.add('hidden');
      menu.classList.remove('hidden');
    },
    showPause: function (on) {
      pauseMenu.classList.toggle('hidden', !on);
    },
    showBusted: function () {
      hud.classList.add('hidden');
      $('touch-ui').classList.add('hidden');
      bustedEl.classList.remove('hidden');
      AudioSys.busted();
    }
  };
  G.ui = ui;

  // ---------------- minimap ----------------
  var mm = $('minimap').getContext('2d');
  var MM = 340, lastMm = 0;
  function drawMinimap(now) {
    if (now - lastMm < 90) return;
    lastMm = now;
    var W = G.layout.WORLD + 60, scale = MM / W;   // +60 covers the wide beach east of the city
    mm.clearRect(0, 0, MM, MM);
    mm.fillStyle = '#16324a';   // ocean background beyond the ground canvas
    mm.fillRect(0, 0, MM, MM);
    // city ground (reuse the world canvas), centered in the wider span
    var go = (W - G.layout.WORLD) / 2 * scale;
    if (G.groundCanvas) mm.drawImage(G.groundCanvas, go, go, G.layout.WORLD * scale, G.layout.WORLD * scale);
    function px(wx) { return (wx + W / 2) * scale; }
    function py(wz) { return (wz + W / 2) * scale; }
    // mission target
    if (G.activeMission) {
      var st = G.activeMission.def.stages[G.activeMission.stageIdx];
      var pulse = 5 + Math.sin(now / 160) * 2.5;
      mm.fillStyle = '#7dff8a';
      mm.beginPath(); mm.arc(px(st.x), py(st.z), pulse, 0, Math.PI * 2); mm.fill();
      mm.strokeStyle = '#fff'; mm.lineWidth = 2;
      mm.beginPath(); mm.arc(px(st.x), py(st.z), pulse + 3, 0, Math.PI * 2); mm.stroke();
    }
    // mission beacons
    G.missionBeacons.forEach(function (m) {
      if (G.save.missionsDone.indexOf(m.id) >= 0) return;
      mm.fillStyle = '#ffd76a';
      mm.beginPath(); mm.arc(px(m.start.x), py(m.start.z), 4.5, 0, Math.PI * 2); mm.fill();
      mm.strokeStyle = '#1a0f1e'; mm.lineWidth = 1.5;
      mm.beginPath(); mm.arc(px(m.start.x), py(m.start.z), 4.5, 0, Math.PI * 2); mm.stroke();
    });
    // police
    for (var i = 0; i < G.police.length; i++) {
      mm.fillStyle = (Math.floor(now / 300) % 2 ? '#ff4040' : '#4060ff');
      mm.beginPath(); mm.arc(px(G.police[i].x), py(G.police[i].z), 4, 0, Math.PI * 2); mm.fill();
    }
    if (G.heli) {
      mm.fillStyle = '#ffe9a8';
      mm.beginPath(); mm.arc(px(G.heli.mesh.position.x), py(G.heli.mesh.position.z), 4, 0, Math.PI * 2); mm.fill();
    }
    // gold mission car
    if (G.goldCar && !G.goldCar.dead && G.activeMission && G.activeMission.def.id === 1 && G.activeMission.stageIdx === 0) {
      mm.fillStyle = '#ffd76a';
      mm.beginPath(); mm.arc(px(G.goldCar.x), py(G.goldCar.z), 5, 0, Math.PI * 2); mm.fill();
    }
    // player arrow
    var pxp = px(G.player.x), pyp = py(G.player.z);
    var yaw = G.player.inCar && G.player.car ? G.player.car.heading : G.player.yaw;
    var ang = Math.atan2(Math.cos(yaw), Math.sin(yaw)); // canvas angle of forward
    mm.save();
    mm.translate(pxp, pyp);
    mm.rotate(ang + Math.PI / 2);
    mm.fillStyle = '#fff';
    mm.strokeStyle = '#1a0f1e'; mm.lineWidth = 2;
    mm.beginPath();
    mm.moveTo(0, -9); mm.lineTo(6.5, 7); mm.lineTo(0, 3.5); mm.lineTo(-6.5, 7); mm.closePath();
    mm.fill(); mm.stroke();
    mm.restore();
  }

  // ---------------- HUD update ----------------
  var lastHud = {};
  function setText(id, v) {
    if (lastHud[id] !== v) { lastHud[id] = v; $(id).textContent = v; }
  }
  function setWidth(id, v) {
    if (lastHud[id] !== v) { lastHud[id] = v; $(id).style.width = v; }
  }
  ui.update = function (dt) {
    if (G.state !== 'playing' && G.state !== 'paused') return;
    // money / clock / stars
    setText('money', '$' + Math.floor(G.money).toLocaleString());
    var hh = Math.floor(G.clockMin / 60) % 24, mi = Math.floor(G.clockMin % 60);
    setText('clock', 'DAY ' + G.day + ' · ' + (hh < 10 ? '0' : '') + hh + ':' + (mi < 10 ? '0' : '') + mi);
    var starHtml = '';
    for (var s = 0; s < 5; s++) starHtml += s < G.wanted ? '★' : '<span class="off">★</span>';
    if (lastHud.stars !== starHtml) { lastHud.stars = starHtml; $('stars').innerHTML = starHtml; }
    $('wanted-label').classList.toggle('hidden', G.wanted === 0);
    setWidth('health-fill', clamp(G.health, 0, 100) + '%');
    setWidth('armour-fill', clamp(G.armour, 0, 100) + '%');
    // speed / vehicle
    var mph = Math.round(G.playerSpeed * 2.237);
    setText('speed', mph + ' ');
    var spd = $('speed');
    if (lastHud.mph !== mph) { lastHud.mph = mph; spd.innerHTML = mph + ' <small>MPH</small>'; }
    var vname = G.player.inCar && G.player.car ? G.player.car.type.name : 'ON FOOT';
    setText('veh-name', vname);
    setWidth('veh-cond-fill', (G.player.inCar && G.player.car ? clamp(G.player.car.condition, 0, 100) : 100) + '%');
    setText('nitro-row', G.player.inCar ? 'NITRO ' + Math.round(G.nitro) + '% — SHIFT' : 'NITRO — SHIFT');
    // weapon / ammo
    var w = G.weapons[G.weaponIdx];
    var ammoTxt = w.mag === Infinity ? '∞' : w.mag + ' / ' + w.reserve;
    setText('weapon-name', w.name + (G.reloading ? ' — RELOADING…' : ''));
    setText('ammo-count', G.player.inCar ? '' : ammoTxt);
    // crosshair (on foot only)
    $('crosshair').classList.toggle('hidden', G.player.inCar || G.state !== 'playing');
    // mission box
    var am = G.activeMission;
    $('mission-none').classList.toggle('hidden', !!am);
    $('mission-active').classList.toggle('hidden', !am);
    if (am) {
      setText('m-title', am.def.title);
      setText('m-stage', 'STAGE ' + (am.stageIdx + 1) + '/' + am.def.stages.length);
      setText('m-obj', am.def.stages[am.stageIdx].text);
      var tl = Math.max(0, am.timeLeft);
      setText('m-timer', Math.floor(tl / 60) + ':' + (Math.floor(tl % 60) < 10 ? '0' : '') + Math.floor(tl % 60));
      var st = am.def.stages[am.stageIdx];
      var d = Math.round(G.dist2d(G.player.x, G.player.z, st.x, st.z));
      setText('m-dist', st.type === 'enterCar' ? 'Get in the gold coupe' : d + ' m to target');
      var timerEl = $('m-timer');
      timerEl.style.color = tl < 30 ? '#ff6b6b' : '#ffd76a';
    }
    // interaction prompt
    var prompt = $('prompt'), ptxt = '';
    if (!G.player.inCar) {
      var car = G.nearestCar(4.6);
      if (car) ptxt = '<b>E</b> — Enter ' + car.type.name;
      else {
        for (var i = 0; i < G.missionBeacons.length; i++) {
          var m = G.missionBeacons[i];
          if (G.save.missionsDone.indexOf(m.id) >= 0) continue;
          if (G.dist2d(G.player.x, G.player.z, m.start.x, m.start.z) < 9) { ptxt = '<b>E</b> — Start mission: ' + m.title; break; }
        }
      }
    } else {
      ptxt = '<b>E</b> — Exit car';
    }
    if (ptxt) { prompt.innerHTML = ptxt; prompt.classList.remove('hidden'); }
    else prompt.classList.add('hidden');
    drawMinimap(performance.now());
  };

  // ---------------- menus ----------------
  $('btn-start').addEventListener('click', function () {
    AudioSys.ensure();
    G.startGame(true);
    showCallout('Welcome to Solstice Bay. Find a gold M beacon to start your first job.', 'ELENA · CREW');
  });
  $('btn-continue').addEventListener('click', function () {
    AudioSys.ensure();
    G.startGame(false);
    showCallout('Welcome back. The city missed you.', 'ELENA · CREW');
  });
  $('btn-resume').addEventListener('click', function () { G.togglePause(); });
  $('btn-restart-mission').addEventListener('click', function () {
    if (G.activeMission) {
      var def = G.activeMission.def;
      G.activeMission = null; G.marker.visible = false;
      G.startMission(def);
    }
    G.togglePause();
  });
  $('btn-unstick').addEventListener('click', function () { G.unstick(); G.togglePause(); });
  $('btn-quit').addEventListener('click', function () { G.quitToMenu(); });
  $('btn-respawn').addEventListener('click', function () { G.respawn(); });

  // ---------------- touch controls ----------------
  // FLOATING joystick: there is no fixed stick. A touch starting on the
  // LEFT half of the screen (outside the action buttons) drops the joystick
  // base exactly where the thumb lands; the knob follows the drag from that
  // origin, so drag-up is always forward no matter where the thumb started.
  // Lift the thumb and the stick vanishes until the next touch. A touch
  // starting on the RIGHT half orbits the camera. One full-screen layer
  // (#touch-layer) owns all of this, so no fixed zone can be missed and no
  // HUD element can swallow the touch. The old fixed-base stick only
  // answered when the thumb landed exactly on its circle — touching below
  // it read as full reverse, which is why it felt dead on a real phone
  // even though synthetic pointer events passed in headless tests.
  var touchLayer = $('touch-layer'), joyBase = $('joy-base'), joyKnob = $('joy-knob');
  var joyId = null, camId = null, joyR = 40, joyDZ = 0.08;
  var joyOrigin = null, camLastX = 0, camLastY = 0;
  // small dead zone (8%) so a resting thumb never creeps; smoothstep curve
  // gives fine low-speed control and full deflection at the edge (true analog)
  function joyShow(x, y) {
    joyOrigin = { x: x, y: y };
    joyBase.style.left = x + 'px';
    joyBase.style.top = y + 'px';
    joyBase.classList.add('on');
  }
  function joyHide() {
    joyOrigin = null;
    joyBase.classList.remove('on');
  }
  function joyMove(clientX, clientY) {
    if (!joyOrigin) return;
    var dx = clientX - joyOrigin.x, dy = clientY - joyOrigin.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    var m = 0, ux = 0, uy = 0;
    if (len > 0.01) { ux = dx / len; uy = dy / len; }
    if (len > joyR * joyDZ) {
      m = Math.min(1, (len - joyR * joyDZ) / (joyR * (1 - joyDZ)));
      m = m * m * (3 - 2 * m);
    }
    joyKnob.style.transform = 'translate(' + (ux * m * joyR) + 'px,' + (uy * m * joyR) + 'px)';
    G.touch.joyX = ux * m;
    G.touch.joyY = uy * m;
    G.touch.active = true;
  }
  function joyEnd() {
    joyId = null;
    joyHide();
    joyKnob.style.transform = 'translate(0px,0px)';
    G.touch.joyX = 0; G.touch.joyY = 0; G.touch.active = false;
  }
  function camEnd() { camId = null; G.camDragging = false; }
  touchLayer.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { touchLayer.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (e.clientX < window.innerWidth / 2 && joyId === null) {
      joyId = e.pointerId;
      joyShow(e.clientX, e.clientY);
      joyMove(e.clientX, e.clientY);
    } else if (camId === null) {
      camId = e.pointerId;
      camLastX = e.clientX; camLastY = e.clientY;
      G.camDragging = true;
    }
  });
  touchLayer.addEventListener('pointermove', function (e) {
    if (e.pointerId === joyId) { joyMove(e.clientX, e.clientY); return; }
    if (e.pointerId === camId) {
      G.mouse.dx += (e.clientX - camLastX) * 1.4;
      G.mouse.dy += (e.clientY - camLastY) * 1.4;
      camLastX = e.clientX; camLastY = e.clientY;
    }
  });
  function touchUp(e) {
    if (e.pointerId === joyId) joyEnd();
    else if (e.pointerId === camId) camEnd();
  }
  touchLayer.addEventListener('pointerup', touchUp);
  touchLayer.addEventListener('pointercancel', touchUp);
  touchLayer.addEventListener('lostpointercapture', touchUp);

  function bindHold(id, on, off) {
    var el = $(id);
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); on(); });
    el.addEventListener('pointerup', function () { off(); });
    el.addEventListener('pointercancel', function () { off(); });
    el.addEventListener('pointerleave', function () { off(); });
  }
  function bindTap(id, fn) {
    $(id).addEventListener('pointerdown', function (e) { e.preventDefault(); fn(); });
  }
  bindHold('btn-jump', function () { G.touch.jump = true; }, function () { G.touch.jump = false; });
  bindHold('btn-fire', function () { G.touch.fire = true; }, function () { G.touch.fire = false; });
  bindHold('btn-nitro', function () { G.touch.nitro = true; }, function () { G.touch.nitro = false; });
  bindTap('btn-car', function () { G.touch.car = true; });
  bindTap('btn-mission', function () { G.touch.mission = true; });
  bindTap('btn-pause', function () { G.togglePause && G.togglePause(); });
  bindTap('btn-cam', function () { G.touch.cam = true; }); // reset via game.js (smoothed targets)

  // camera drag on touch now lives on #touch-layer (pointer events, right
  // half); the canvas never receives the touch because the layer sits above
  // it. Desktop mouse drag still uses the canvas mousedown/mousemove
  // handlers in game.js.

  // expose touch test hooks
  G.debugTouch = function () {
    return {
      isTouch: isTouch,
      touchUiVisible: !$('touch-ui').classList.contains('hidden'),
      joy: { x: +G.touch.joyX.toFixed(2), y: +G.touch.joyY.toFixed(2), active: G.touch.active,
             visible: joyBase.classList.contains('on'),
             origin: joyOrigin ? { x: Math.round(joyOrigin.x), y: Math.round(joyOrigin.y) } : null },
      camDragging: !!G.camDragging,
      buttons: ['btn-jump', 'btn-fire', 'btn-car', 'btn-nitro', 'btn-cam', 'btn-mission', 'btn-pause'].map(function (id) {
        var r = $(id).getBoundingClientRect();
        return { id: id, visible: r.width > 0 && r.height > 0, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })
    };
  };

  // menu backdrop: keep the HUD hidden until start
  ui.showMenu();
})();
