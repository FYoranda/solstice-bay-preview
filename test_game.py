"""Headless test for SOLSTICE BAY (test mode ?test=1, low-res render).
Waits are driven by GAME time (polls G.time) because swiftshader on the
small EC2 renders slowly — real-time waits would race the frame loop.
Desktop: load, 0 console errors, 0 failed requests, drive/turn/jump,
enter+exit car, wall collision (no pass-through, no stick), mission flow,
police chase + heli.
Mobile (touch emulation): touch UI visible, joystick drives, buttons work,
camera drag rotates view.
Usage: python3 test_game.py [base_url]  (default http://127.0.0.1:8471)
"""
import sys, time, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8471"
URL = BASE.rstrip("/") + "/index.html?test=1"
OUT = "/tmp/solstice"

def state(page):
    return page.evaluate("window.G && G.debug ? G.debug.state() : null")

def wait_game(page, seconds, timeout=120):
    """Wait until G.time has advanced by `seconds` (game time)."""
    t0 = page.evaluate("G.time")
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.25)
        t = page.evaluate("G.time")
        if t - t0 >= seconds:
            return True
    raise TimeoutError(f"game time did not advance {seconds}s in {timeout}s real")

def hold_key(page, key, game_seconds):
    page.keyboard.down(key)
    try:
        wait_game(page, game_seconds)
    finally:
        page.keyboard.up(key)

def main():
    errors, failed = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
        ])
        # ---------------- DESKTOP ----------------
        page = browser.new_page(viewport={"width": 960, "height": 600})
        page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("requestfailed", lambda r: failed.append(r.url))
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(3000)
        print("READY:", page.evaluate("window.G && G.ready"), "TEST_MODE:", page.evaluate("G.TEST_MODE"))
        print("THREE:", page.evaluate("typeof THREE"))
        page.click("#btn-start")
        page.wait_for_timeout(600)

        # enter the starter car (teleport next to it first)
        page.evaluate("G.debug.teleport(5, 33)")
        page.wait_for_timeout(300)
        page.keyboard.press("e")
        wait_game(page, 0.4)
        if not state(page)["inCar"]:
            page.keyboard.press("e")
            wait_game(page, 0.4)
        print("ENTER CAR:", state(page))
        assert state(page)["inCar"], "could not enter the car with E"

        # drive forward ~2s game time (starter car faces +X/east)
        hold_key(page, "w", 2.0)
        s1 = state(page)
        print("AFTER DRIVE:", s1)
        moved = ((s1["x"] - 6) ** 2 + (s1["z"] - 34) ** 2) ** 0.5
        print("DISTANCE DRIVEN:", round(moved, 1))
        assert moved > 10, "car did not drive forward"
        # hard turn while driving
        page.keyboard.down("w")
        page.keyboard.down("a")
        try:
            wait_game(page, 1.2)
        finally:
            page.keyboard.up("a")
            page.keyboard.up("w")
        print("AFTER TURN:", state(page))
        page.screenshot(path=OUT + "/shot1-drive.png")

        # car wall test: drive into a building, must not pass through
        b = page.evaluate("G.buildings[0]")
        print("BUILDING0:", b)
        page.evaluate(f"G.debug.teleport({b['x']}, {b['z'] - b['d']/2 - 6})")
        page.evaluate("G.player.car.heading = 0")  # face +Z (south)
        hold_key(page, "w", 1.6)
        s3 = state(page)
        face = b["z"] - b["d"] / 2
        print("CAR WALL:", s3, "face z=", face)
        assert s3["z"] < face - 0.5, "car passed through the wall!"
        assert s3["z"] > face - 4, "car stopped too far from the wall"
        # drive away again (not stuck)
        z_before = s3["z"]
        hold_key(page, "s", 0.8)
        s3b = state(page)
        print("CAR UNSTUCK (reversed):", s3b)
        assert s3b["z"] < z_before - 1, "car stuck against the wall!"

        # exit car, walk + jump
        page.keyboard.press("e")
        wait_game(page, 0.4)
        print("EXITED:", state(page))
        assert not state(page)["inCar"], "could not exit the car"
        page.keyboard.down("w")
        try:
            wait_game(page, 1.0)
            page.keyboard.press("Space")
            wait_game(page, 0.5)
        finally:
            page.keyboard.up("w")
        print("ON FOOT:", state(page))
        page.screenshot(path=OUT + "/shot2-foot.png")

        # on-foot wall test: walk into the same building, must slide not stick
        page.evaluate(f"G.debug.teleport({b['x']}, {b['z'] - b['d']/2 - 3})")
        hold_key(page, "w", 1.2)
        s4 = state(page)
        print("FOOT WALL:", s4, "face z=", face)
        assert s4["z"] < face - 0.3, "player passed through the wall!"
        x_before = s4["x"]
        hold_key(page, "a", 0.8)
        s4b = state(page)
        print("FOOT SLIDE:", s4b, "dx=", round(s4b["x"] - x_before, 1))
        assert abs(s4b["x"] - x_before) > 1, "player stuck on the wall (cannot slide)!"

        # mission flow: start mission 0, teleport to stage target, advance
        page.evaluate("G.debug.startMission(0)")
        wait_game(page, 0.3)
        print("MISSION START:", state(page))
        page.evaluate("G.debug.teleport(0, 0)")
        wait_game(page, 0.5)
        s5 = state(page)
        print("MISSION STAGE ADVANCE:", s5)
        assert s5["missionStage"] == 1, "mission stage did not advance on reaching target"
        page.evaluate("G.debug.teleport(0, -12)")
        wait_game(page, 0.3)
        page.screenshot(path=OUT + "/shot3-mission.png")

        # police chase + heli
        page.evaluate("G.debug.setHeat(65)")
        wait_game(page, 2.5)
        s6 = state(page)
        print("CHASE:", s6)
        assert s6["wanted"] == 4, "wanted should be 4 stars at heat 65"
        assert s6["police"] >= 1, "no police spawned"
        assert s6["heli"] is True, "heli should be up at 3+ stars"
        page.screenshot(path=OUT + "/shot4-chase.png")

        # shooting (no errors)
        page.mouse.click(480, 300)
        wait_game(page, 0.3)
        print("AFTER SHOT:", state(page))
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

        # floating joystick drag up (forward): pointer events on the touch layer,
        # base must appear exactly at the touch point (left half)
        before = state(mp)
        mp.evaluate("""() => {
          const layer = document.getElementById('touch-layer');
          const o = (x, y) => ({bubbles:true, cancelable:true, pointerId:99, clientX:x, clientY:y, pointerType:'touch', isPrimary:true});
          layer.dispatchEvent(new PointerEvent('pointerdown', o(100, 620)));
          layer.dispatchEvent(new PointerEvent('pointermove', o(100, 580)));
        }""")
        joy = mp.evaluate("G.debugTouch().joy")
        print("FLOAT JOY:", json.dumps(joy))
        assert joy["visible"] and joy["origin"] == {"x": 100, "y": 620}, "floating joystick must appear at the touch point"
        wait_game(mp, 1.2)
        mid = state(mp)
        print("JOYSTICK DRIVE:", "before=", before, "after=", mid)
        moved = abs(mid["x"] - before["x"]) + abs(mid["z"] - before["z"])
        assert moved > 1.5, "joystick did not move the player!"
        mp.evaluate("""() => {
          const layer = document.getElementById('touch-layer');
          layer.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, cancelable:true, pointerId:99, clientX:100, clientY:580, pointerType:'touch', isPrimary:true}));
        }""")
        assert not mp.evaluate("G.debugTouch().joy.visible"), "joystick must hide on release"
        # tap CAR button to enter the car (teleport next to it first)
        mp.evaluate("G.debug.teleport(5, 33)")
        wait_game(mp, 0.3)
        mp.evaluate("""() => {
          const el = document.getElementById('btn-car');
          const b = el.getBoundingClientRect();
          const o = {bubbles:true, cancelable:true, pointerId:101, clientX:b.left+b.width/2, clientY:b.top+b.height/2, pointerType:'touch', isPrimary:true};
          el.dispatchEvent(new PointerEvent('pointerdown', o));
        }""")
        wait_game(mp, 0.5)
        print("TOUCH ENTER CAR:", state(mp))
        assert state(mp)["inCar"], "touch CAR button did not enter the car"
        # camera drag via pointer events on the touch layer (right half)
        yaw0 = mp.evaluate("G.cam.yaw")
        mp.evaluate("""() => {
          const layer = document.getElementById('touch-layer');
          const o = (x, y) => ({bubbles:true, cancelable:true, pointerId:7, clientX:x, clientY:y, pointerType:'touch', isPrimary:true});
          layer.dispatchEvent(new PointerEvent('pointerdown', o(300, 400)));
          layer.dispatchEvent(new PointerEvent('pointermove', o(200, 400)));
          layer.dispatchEvent(new PointerEvent('pointerup', o(200, 400)));
        }""")
        wait_game(mp, 0.4)
        yaw1 = mp.evaluate("G.cam.yaw")
        print("CAM DRAG: yaw", round(yaw0, 2), "->", round(yaw1, 2))
        assert abs(yaw1 - yaw0) > 0.1, "touch camera drag did not rotate the camera!"
        mp.screenshot(path=OUT + "/shot5-mobile.png")
        browser.close()

    print("\n==== RESULT ====")
    print("CONSOLE ERRORS:", len(errors))
    for e in errors: print("  -", e)
    print("FAILED REQUESTS:", len(failed))
    for f in failed: print("  -", f)
    if errors or failed:
        print("STATUS: FAIL")
        sys.exit(1)
    print("STATUS: PASS")

if __name__ == "__main__":
    main()
