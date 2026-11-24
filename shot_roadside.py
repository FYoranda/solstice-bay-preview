"""Roadside placement fix for SOLSTICE BAY: trees/lamps must sit on the sidewalk,
not in the middle of the road.
Checks: G.ready, 0 console errors, 0 failed requests,
G.checkRoadside() -> 0 props on the road (audit of every placed roadside prop),
drive the player car straight down road x=38 (north) and road z=-38 (east)
without stalling, traffic cars keep moving.
Shots: main road from the front (trees/lamps on the edges, clear asphalt),
Shibuya intersection with traffic passing.
Usage: python3 shot_roadside.py [base_url]  (default http://127.0.0.1:8471)
"""
import sys, time, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8471"
URL = BASE.rstrip("/") + "/index.html?test=1"
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

def hold_key(page, key, game_seconds):
    page.keyboard.down(key)
    try:
        wait_game(page, game_seconds)
    finally:
        page.keyboard.up(key)

def drive_straight(page, seconds, axis):
    """Hold W for `seconds` game time, sampling position; return (progress, max_stall)."""
    samples = []  # (game_time, axis_pos)
    t0 = page.evaluate("G.time")
    page.keyboard.down("w")
    deadline = time.time() + 150
    try:
        while time.time() < deadline:
            s = state(page)
            samples.append((page.evaluate("G.time") - t0, s["x"] if axis == "x" else s["z"]))
            if samples[-1][0] >= seconds:
                break
            time.sleep(0.25)
    finally:
        page.keyboard.up("w")
    progress = samples[-1][1] - samples[0][1]
    # max stall: largest game-time window with < 1 unit of axis progress
    max_stall = 0.0
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            if samples[j][1] - samples[i][1] < 1.0:
                max_stall = max(max_stall, samples[j][0] - samples[i][0])
            else:
                break
    return progress, max_stall, samples

errors, failed = [], []
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("requestfailed", lambda r: failed.append(r.url))
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(4000)
    print("READY:", page.evaluate("window.G && G.ready"))
    assert page.evaluate("window.G && G.ready"), "game did not load"
    page.click("#btn-start")
    page.wait_for_timeout(800)

    # ---- 1. roadside audit: no prop on the road ----
    audit = page.evaluate("G.checkRoadside()")
    print("ROADSIDE AUDIT total:", audit["total"], "onRoad:", len(audit["onRoad"]))
    by_kind = {}
    for p in page.evaluate("G.roadsideProps"):
        by_kind[p["kind"]] = by_kind.get(p["kind"], 0) + 1
    print("BY KIND:", json.dumps(by_kind))
    if audit["onRoad"]:
        print("ON-ROAD PROPS:", json.dumps(audit["onRoad"][:20]))
    assert len(audit["onRoad"]) == 0, f"{len(audit['onRoad'])} props still on the road!"

    # ---- 2. screenshot: main road from the front (trees/lamps on edges) ----
    page.evaluate("G.debug.teleport(38, -140)")
    page.evaluate("G.debug.setCamTarget(38, 3, -40)")
    wait_game(page, 1.0)
    page.screenshot(path=OUT + "/roadside1-road.png")
    page.evaluate("G.debug.clearCamTarget()")

    # ---- 3. screenshot: Shibuya intersection with traffic ----
    page.evaluate("G.debug.teleport(24, 24)")
    page.evaluate("G.debug.setCamTarget(38, 2, 38)")
    wait_game(page, 3.0)
    page.screenshot(path=OUT + "/roadside2-crossing.png")
    page.evaluate("G.debug.clearCamTarget()")

    # ---- 4. drive north down road x=38 (right-hand lane x=42, heading 0 = +Z) ----
    page.evaluate("G.debug.teleport(5, 33)")
    page.wait_for_timeout(300)
    page.keyboard.press("e")
    wait_game(page, 0.4)
    if not state(page)["inCar"]:
        page.keyboard.press("e")
        wait_game(page, 0.4)
    assert state(page)["inCar"], "could not enter the car with E"
    page.evaluate("G.debug.teleport(42, -150)")
    page.evaluate("G.player.car.heading = 0")
    page.evaluate("G.player.car.vx = 0; G.player.car.vz = 0;")
    prog, stall, _ = drive_straight(page, 12, "z")
    print("DRIVE NORTH x=38: progress z =", round(prog, 1), "max stall =", round(stall, 2), "s")
    assert prog > 70, f"car did not get down road x=38 (progress {prog})"
    assert stall < 2.5, f"car stalled {stall}s on road x=38 (tree/lamp in the way?)"

    # ---- 5. drive east down road z=-38 (right-hand lane z=-42, heading PI/2 = +X) ----
    page.evaluate("G.debug.teleport(-150, -42)")
    page.evaluate("G.player.car.heading = Math.PI / 2")
    page.evaluate("G.player.car.vx = 0; G.player.car.vz = 0;")
    prog2, stall2, _ = drive_straight(page, 12, "x")
    print("DRIVE EAST z=-38: progress x =", round(prog2, 1), "max stall =", round(stall2, 2), "s")
    assert prog2 > 70, f"car did not get down road z=-38 (progress {prog2})"
    assert stall2 < 2.5, f"car stalled {stall2}s on road z=-38 (tree/lamp in the way?)"

    # ---- 6. traffic keeps moving ----
    t0 = page.evaluate("G.debug.trafficInfo()")
    wait_game(page, 3.0)
    t1 = page.evaluate("G.debug.trafficInfo()")
    moved = sum(1 for a, b in zip(t0, t1)
                if ((b["x"] - a["x"]) ** 2 + (b["z"] - a["z"]) ** 2) ** 0.5 > 2)
    print("TRAFFIC MOVED:", moved, "/", len(t0))
    assert moved >= 6, "traffic is stuck (trees/lamps blocking roads?)"

    print("CONSOLE ERRORS:", len(errors), errors[:5])
    print("FAILED REQUESTS:", len(failed), failed[:5])
    assert not errors, f"console errors: {errors[:3]}"
    assert not failed, f"failed requests: {failed[:3]}"
    print("STATUS: PASS")
    browser.close()
