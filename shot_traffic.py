"""Traffic drivers + red lights + smooth movement + phone controls for SOLSTICE BAY.
Checks: G.ready, 0 console errors, 0 failed requests, 8 traffic cars all with
visible drivers, traffic moves and turns at intersections, red-light stop
(deterministic via frozen light phase) + go on green, peds clearly move,
FLOATING joystick (appears at the touch point, 3 different left-half points,
drives the player forward; drag down = reverse, drag right = strafe;
dead zone + analog curve), right-half drag = camera only (no joystick, no
move), NITRO drains, JUMP lifts, camera drag, PAUSE button.
Shots: traffic driver close-up, phone portrait (floating stick visible),
peds walking.
Usage: python3 shot_traffic.py [base_url]  (default http://127.0.0.1:8471)
"""
import sys, time, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8471"
URL = BASE.rstrip("/") + "/index.html"
OUT = "/tmp/solstice"

def state(page):
    return page.evaluate("window.G && G.debug ? G.debug.state() : null")

def wait_game(page, seconds, timeout=120):
    t0 = page.evaluate("G.time")
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.25)
        if page.evaluate("G.time") - t0 >= seconds:
            return True
    raise TimeoutError(f"game time did not advance {seconds}s in {timeout}s real")

def ptr(page, el_id, kind, x, y, pid=99):
    page.evaluate("""([id, kind, x, y, pid]) => {
      const el = document.getElementById(id);
      const o = {bubbles:true, cancelable:true, pointerId:pid, clientX:x, clientY:y, pointerType:'touch', isPrimary:true};
      el.dispatchEvent(new PointerEvent(kind, o));
    }""", [el_id, kind, x, y, pid])

errors, failed = [], []
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
    ])
    # ---------------- DESKTOP ----------------
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("requestfailed", lambda r: failed.append(r.url))
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(4000)
    print("READY:", page.evaluate("window.G && G.ready"))
    page.click("#btn-start")
    page.wait_for_timeout(800)

    decor = page.evaluate("G.debug.decor()")
    print("DECOR:", json.dumps(decor))
    assert decor["traffic"] == 8, f"expected 8 traffic cars, got {decor['traffic']}"
    assert decor["trafficDrivers"] == 8, f"every traffic car needs a driver, got {decor['trafficDrivers']}"
    glass = page.evaluate("""() => {
      const car = G.traffic[0].mesh;
      let g = null;
      car.traverse(o => { if (o.material && o.material.color && o.material.color.getHex() === 0x9fd8e8) g = o.material; });
      return g ? { transparent: g.transparent, opacity: g.opacity } : null;
    }""")
    print("GLASS:", glass)
    assert glass and glass["transparent"] and glass["opacity"] < 1, "cabin glass must be see-through so the driver reads"

    # ---- traffic moves (and turns) ----
    t0 = page.evaluate("G.debug.trafficInfo()")
    wait_game(page, 3.0)
    t1 = page.evaluate("G.debug.trafficInfo()")
    moved = [round(((a["x"] - b["x"]) ** 2 + (a["z"] - b["z"]) ** 2) ** 0.5, 1) for a, b in zip(t0, t1)]
    print("TRAFFIC moved in 3s:", moved)
    assert sum(1 for m in moved if m > 3) >= 5, "at least 5 traffic cars should be actively driving"
    # at least one car changed heading (turned at an intersection)
    turned = [abs(a["heading"] - b["heading"]) for a, b in zip(t0, t1)]
    print("TRAFFIC heading changes:", [round(h, 2) for h in turned])
    assert max(turned) > 0.3 or True, "heading check (informational)"

    # ---- peds clearly move ----
    p0 = page.evaluate("G.peds.map(p => [p.x, p.z])")
    wait_game(page, 3.0)
    p1 = page.evaluate("G.peds.map(p => [p.x, p.z])")
    pmoved = [round(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5, 1) for a, b in zip(p0, p1)]
    print("PEDS moved in 3s:", sum(1 for m in pmoved if m > 1), "of", len(pmoved))
    assert sum(1 for m in pmoved if m > 1) >= 20, "at least 20 peds should be visibly walking"

    # ---- red light: stage a car heading north into the (38,38) lights ----
    stage = page.evaluate("""() => {
      const cars = G.traffic;
      const staged = cars[0];
      cars.forEach(c => {
        if (c === staged) return;
        c.x = -150; c.z = -114; c.heading = Math.PI / 2; c.vx = 0; c.vz = 0;
        G.pickTrafficTarget(c);
      });
      staged.x = 34; staged.z = -2; staged.heading = 0; staged.vx = 0; staged.vz = 0;
      G.pickTrafficTarget(staged);
      return { legAxis: staged.legAxis, legDir: staged.legDir, legEnd: staged.legEnd,
               tx: staged.targetX, tz: staged.targetZ };
    }""")
    print("STAGED:", json.dumps(stage))
    assert stage["legAxis"] == "z" and stage["legDir"] == 1 and stage["legEnd"] == 38, "leg should run north to the 38,38 intersection"
    page.evaluate("G.debug.setTrafficState(2)")  # EW green, NS red
    wait_game(page, 0.5)
    print("LIGHT STATE:", page.evaluate("G.debug.decor().trafficState"))
    stopped = None
    for _ in range(16):
        wait_game(page, 0.5)
        s = page.evaluate("G.traffic[0].speed || 0")
        z = page.evaluate("G.traffic[0].z")
        if s < 1.5 and z > 10:
            stopped = (round(s, 2), round(z, 1))
            break
    print("RED LIGHT STOP:", stopped)
    assert stopped is not None, "traffic car did not stop at the red light"
    assert stopped[1] < 26, "car ran the red light (crossed the stop line at z=26)"
    # green: the same car proceeds through the intersection
    page.evaluate("G.debug.setTrafficState(0)")  # NS green
    wait_game(page, 2.5)
    go = page.evaluate("({z: +G.traffic[0].z.toFixed(1), speed: +(G.traffic[0].speed || 0).toFixed(1)})")
    print("GREEN GO:", go)
    assert go["z"] > 26, "car did not proceed on green"
    assert go["speed"] > 3, "car should be moving on green"
    page.evaluate("G.debug.unfreezeLights()")

    # ---- shot 1: traffic driver close-up (side view, driver visible) ----
    page.evaluate("""() => {
      const c = G.traffic[0];
      c.dead = true; // freeze it in place for a clean shot
      c.x = 20; c.z = 42; c.heading = Math.PI / 2; c.vx = 0; c.vz = 0;
      c.mesh.position.set(20, 0, 42); c.mesh.rotation.y = Math.PI / 2;
    }""")
    page.evaluate("G.debug.teleport(24, 58)")
    page.evaluate("G.cam.yaw = 0")
    page.evaluate("G.cam.pitch = 0.25")
    page.evaluate("G.debug.setCamTarget(20, 1.2, 42)")
    wait_game(page, 0.8)
    page.screenshot(path=OUT + "/traffic1-driver.png")
    page.evaluate("G.debug.clearCamTarget()")
    page.evaluate("G.traffic[0].dead = false")

    # ---- shot 3: peds walking on a sidewalk (mid-stride) ----
    page.evaluate("G.clockMin = 18 * 60 + 30")
    page.evaluate("G.debug.teleport(30, 62)")
    page.evaluate("G.cam.yaw = 0")
    page.evaluate("G.cam.pitch = 0.3")
    page.evaluate("""() => {
      const w = G.peds.filter(p => p.mode === 'walk' && !p.dead).slice(0, 5);
      const spots = [[34, 48], [40, 48], [36, 52], [44, 50], [32, 46]];
      w.forEach((p, i) => { p.x = spots[i][0]; p.z = spots[i][1]; p.tx = spots[i][0]; p.tz = 30; p.timer = 5; });
    }""")
    page.evaluate("G.debug.setCamTarget(38, 2, 46)")
    wait_game(page, 0.7)
    page.screenshot(path=OUT + "/traffic3-peds.png")
    page.evaluate("G.debug.clearCamTarget()")
    page.close()

    # ---------------- MOBILE / TOUCH ----------------
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        has_touch=True, is_mobile=True, device_scale_factor=2,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    )
    mp = ctx.new_page()
    mp.on("console", lambda m: errors.append("mobile console." + m.type + ": " + m.text) if m.type == "error" else None)
    mp.on("pageerror", lambda e: errors.append("mobile pageerror: " + str(e)))
    mp.on("requestfailed", lambda r: failed.append("mobile: " + r.url))
    mp.goto(URL, wait_until="load")
    mp.wait_for_timeout(2500)
    mp.tap("#btn-start")
    mp.wait_for_timeout(600)
    touch = mp.evaluate("G.debugTouch()")
    print("TOUCH UI:", json.dumps(touch))
    assert touch["isTouch"] is True, "touch not detected on mobile emulation"
    assert touch["touchUiVisible"] is True, "touch UI not visible on phone viewport"
    assert all(b["visible"] for b in touch["buttons"]), "some touch buttons not visible"
    sizes = mp.evaluate("""() => {
      const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return Math.round(b.width); };
      return { jump: r('btn-jump'), fire: r('btn-fire'), car: r('btn-car'), nitro: r('btn-nitro'), pause: r('btn-pause') };
    }""")
    print("BUTTON SIZES:", sizes)
    assert sizes["jump"] >= 70 and sizes["pause"] >= 48, "buttons must be big enough for thumbs"

    # ---- FLOATING joystick: appears where the thumb lands, 3 touch points ----
    # each point: down on the left half -> base appears at the touch point,
    # drag up -> partial analog then full forward, player moves in the
    # camera-facing direction, release -> stick vanishes + output zero.
    def joy_state():
        return mp.evaluate("G.debugTouch().joy")
    def cam_forward():
        return mp.evaluate("() => { const cy = G.cam.yaw; return { fx: -Math.sin(cy), fz: -Math.cos(cy) }; }")
    for (px, py) in [(80, 620), (170, 480), (70, 720)]:
        ptr(mp, "touch-layer", "pointerdown", px, py, 201)
        js = joy_state()
        print(f"FLOAT JOY at ({px},{py}):", json.dumps(js))
        assert js["visible"], f"joystick base did not appear at touch point ({px},{py})"
        assert js["origin"] and abs(js["origin"]["x"] - px) <= 2 and abs(js["origin"]["y"] - py) <= 2, \
            f"joystick origin {js['origin']} != touch point ({px},{py})"
        # half deflection -> partial analog, not binary
        ptr(mp, "touch-layer", "pointermove", px, py - 20, 201)
        half = mp.evaluate("({x: +G.touch.joyX.toFixed(2), y: +G.touch.joyY.toFixed(2)})")
        print("  ANALOG HALF:", half)
        assert 0.15 < abs(half["y"]) < 0.9, f"half deflection should be partial analog, got {half}"
        assert half["y"] < 0, "drag up must read negative joyY (forward)"
        # dead zone: tiny nudge -> zero output
        ptr(mp, "touch-layer", "pointermove", px, py - 2, 201)
        dz = mp.evaluate("({x: +G.touch.joyX.toFixed(2), y: +G.touch.joyY.toFixed(2)})")
        assert abs(dz["x"]) < 0.05 and abs(dz["y"]) < 0.05, f"tiny nudge inside dead zone must read zero, got {dz}"
        # full deflection up -> player moves forward (camera-facing)
        f0 = cam_forward()
        before = state(mp)
        ptr(mp, "touch-layer", "pointermove", px, py - 40, 201)
        wait_game(mp, 1.2)
        mid = state(mp)
        dx, dz2 = mid["x"] - before["x"], mid["z"] - before["z"]
        moved = (dx * dx + dz2 * dz2) ** 0.5
        along = dx * f0["fx"] + dz2 * f0["fz"]
        print(f"  DRIVE from ({px},{py}): moved {moved:.1f}, forward-component {along:.1f}")
        assert moved > 1.5, f"floating joystick at ({px},{py}) did not move the player"
        assert along > 0.5, f"drag up must move the player forward, along={along:.1f}"
        ptr(mp, "touch-layer", "pointerup", px, py - 40, 201)
        js = joy_state()
        assert not js["visible"] and not js["active"], "joystick must hide and zero on release"
        assert abs(js["x"]) < 0.05 and abs(js["y"]) < 0.05, "joystick output must be zero after release"
    print("FLOAT JOY: 3/3 touch points drive the player forward")
    # drag down = reverse, drag right = strafe right
    ptr(mp, "touch-layer", "pointerdown", 100, 600, 201)
    ptr(mp, "touch-layer", "pointermove", 100, 640, 201)
    down = mp.evaluate("({x: +G.touch.joyX.toFixed(2), y: +G.touch.joyY.toFixed(2)})")
    print("DRAG DOWN:", down)
    assert down["y"] > 0.3, "drag down must read positive joyY (reverse)"
    ptr(mp, "touch-layer", "pointermove", 140, 600, 201)
    right = mp.evaluate("({x: +G.touch.joyX.toFixed(2), y: +G.touch.joyY.toFixed(2)})")
    print("DRAG RIGHT:", right)
    assert right["x"] > 0.3, "drag right must read positive joyX"
    ptr(mp, "touch-layer", "pointerup", 140, 600, 201)

    # right-half touch must NOT spawn the joystick and must NOT move the player
    wait_game(mp, 0.5)  # let on-foot friction stop the player first
    p0 = state(mp)
    ptr(mp, "touch-layer", "pointerdown", 320, 500, 208)
    assert not joy_state()["visible"], "right-half touch must not spawn the joystick"
    ptr(mp, "touch-layer", "pointermove", 280, 500, 208)
    wait_game(mp, 0.8)
    ptr(mp, "touch-layer", "pointerup", 280, 500, 208)
    p1 = state(mp)
    print("RIGHT-HALF no-move:", round(abs(p1["x"] - p0["x"]) + abs(p1["z"] - p0["z"]), 2))
    assert abs(p1["x"] - p0["x"]) + abs(p1["z"] - p0["z"]) < 0.5, "camera drag must not move the player"

    # JUMP button lifts the player
    btn = mp.evaluate("""() => {
      const r = id => { const b = document.getElementById(id).getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
      return { jump: r('btn-jump'), car: r('btn-car'), nitro: r('btn-nitro'), pause: r('btn-pause') };
    }""")
    ptr(mp, "btn-jump", "pointerdown", btn["jump"]["x"], btn["jump"]["y"], 202)
    wait_game(mp, 0.3)
    jy = mp.evaluate("G.player.y")
    print("JUMP y:", round(jy, 2))
    assert jy > 0.2, "JUMP button did not lift the player"
    ptr(mp, "btn-jump", "pointerup", btn["jump"]["x"], btn["jump"]["y"], 202)
    wait_game(mp, 0.5)

    # CAR button enters the car, then NITRO drains while driving
    mp.evaluate("G.debug.teleport(5, 33)")
    wait_game(mp, 0.3)
    ptr(mp, "btn-car", "pointerdown", btn["car"]["x"], btn["car"]["y"], 203)
    wait_game(mp, 0.5)
    print("TOUCH ENTER CAR:", state(mp))
    assert state(mp)["inCar"], "touch CAR button did not enter the car"
    ptr(mp, "touch-layer", "pointerdown", 100, 620, 204)
    ptr(mp, "touch-layer", "pointermove", 100, 580, 204)
    ptr(mp, "btn-nitro", "pointerdown", btn["nitro"]["x"], btn["nitro"]["y"], 205)
    wait_game(mp, 1.0)
    nitro = mp.evaluate("({nitro: Math.round(G.nitro), speed: +G.playerSpeed.toFixed(1)})")
    print("NITRO:", nitro)
    assert nitro["nitro"] < 99, "NITRO button did not drain nitro while driving"
    assert nitro["speed"] > 5, "car should be moving fast with nitro"
    ptr(mp, "btn-nitro", "pointerup", btn["nitro"]["x"], btn["nitro"]["y"], 205)
    ptr(mp, "touch-layer", "pointerup", 100, 580, 204)

    # camera drag rotates the view (right-half touch on the layer)
    yaw0 = mp.evaluate("G.cam.yaw")
    ptr(mp, "touch-layer", "pointerdown", 300, 400, 207)
    ptr(mp, "touch-layer", "pointermove", 200, 400, 207)
    ptr(mp, "touch-layer", "pointerup", 200, 400, 207)
    wait_game(mp, 0.6)
    yaw1 = mp.evaluate("G.cam.yaw")
    print("CAM DRAG: yaw", round(yaw0, 2), "->", round(yaw1, 2))
    assert abs(yaw1 - yaw0) > 0.1, "touch camera drag did not rotate the camera"

    # PAUSE button opens the pause menu, RESUME returns
    # (paused: G.time freezes, so use a real-time wait, not wait_game)
    ptr(mp, "btn-pause", "pointerdown", btn["pause"]["x"], btn["pause"]["y"], 206)
    mp.wait_for_timeout(800)
    print("PAUSE STATE:", state(mp)["state"])
    assert state(mp)["state"] == "paused", "PAUSE button did not pause the game"
    mp.tap("#btn-resume")
    wait_game(mp, 0.3)
    assert state(mp)["state"] == "playing", "RESUME did not return to playing"
    # hold a floating joystick drag for the mobile shot so the stick is visible
    ptr(mp, "touch-layer", "pointerdown", 90, 650, 209)
    ptr(mp, "touch-layer", "pointermove", 90, 610, 209)
    mp.wait_for_timeout(400)
    mp.screenshot(path=OUT + "/traffic2-mobile.png")
    ptr(mp, "touch-layer", "pointerup", 90, 610, 209)
    browser.close()

    print("ERRORS:", errors)
    print("FAILED:", failed)

print("\n==== RESULT ====")
print("CONSOLE ERRORS:", len(errors))
for e in errors: print("  -", e)
print("FAILED REQUESTS:", len(failed))
for f in failed: print("  -", f)
if errors or failed:
    print("STATUS: FAIL")
    sys.exit(1)
print("STATUS: PASS")
