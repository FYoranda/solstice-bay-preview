"""Lights + beach screenshots for SOLSTICE BAY (1280x800).
  1. colorful street lamps — race car driving north on the sakura street
     (string lights + pink/cyan/orange lamp glow + light pools)
  2. beach close-up — on foot on the sand by the umbrellas + volleyball net,
     looking east at the ocean
  3. beach wide — high angle from the boardwalk, beach + pier + ocean
  4. night Shibuya — clock set to 21:30, crossing with neon strips,
     colored corner lamps, traffic lights
Also verifies: car can drive onto the beach to x~245, walking on sand works.
Usage: python3 shot_lights.py [base_url]
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8471"
URL = BASE.rstrip("/") + "/index.html"
OUT = "/tmp/solstice"

def state(page):
    return page.evaluate("window.G && G.debug ? G.debug.state() : null")

def wait_game(page, seconds, timeout=180):
    t0 = page.evaluate("G.time")
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.4)
        if page.evaluate("G.time") - t0 >= seconds:
            return True
    raise TimeoutError("game time did not advance")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(4000)
    print("READY:", page.evaluate("window.G && G.ready"))
    print("DECOR:", page.evaluate("G.debug.decor()"))
    page.click("#btn-start")
    page.wait_for_timeout(800)

    # --- test: walk on the sand eastward (no stuck), on foot first ---
    page.evaluate("G.debug.teleport(225, -20)")
    page.evaluate("G.cam.yaw = -Math.PI / 2")  # look east
    page.evaluate("G.cam.pitch = 0.3")
    x0 = state(page)["x"]
    page.keyboard.down("w")
    try:
        wait_game(page, 2.0)
    finally:
        page.keyboard.up("w")
    print("sand walk: x", x0, "->", state(page)["x"])

    # --- enter the car once (parked car near spawn), reuse it for both drives ---
    page.evaluate("G.debug.teleport(6, 34)")
    page.wait_for_timeout(300)
    page.keyboard.press("e")
    wait_game(page, 0.5)
    if not state(page)["inCar"]:
        page.keyboard.press("e")
        wait_game(page, 0.5)
    print("inCar:", state(page)["inCar"])

    # --- test: car drives onto the beach (east wall is now x=250) ---
    page.evaluate("G.debug.teleport(190, 40)")
    page.evaluate("G.player.car.heading = Math.PI / 2")  # face east (+X)
    page.keyboard.down("w")
    try:
        wait_game(page, 4.0)
    finally:
        page.keyboard.up("w")
    print("beach drive:", state(page))

    # 1. colorful lamps — drive north on the sakura street (x=-38),
    #    passing the string-light span at z=0
    page.evaluate("G.debug.teleport(-38, 45)")
    page.evaluate("G.player.car.heading = Math.PI")  # face north (-Z)
    page.keyboard.down("w")
    try:
        wait_game(page, 2.5)
    finally:
        page.keyboard.up("w")
    print("lamps:", state(page))
    page.screenshot(path=OUT + "/lights1-street.png")

    # 2. beach close-up — on foot by the umbrellas / volleyball, look east
    page.keyboard.press("e")
    wait_game(page, 0.5)
    page.evaluate("G.debug.teleport(224, -8)")
    page.evaluate("G.cam.yaw = -Math.PI / 2")  # look east to the ocean
    page.evaluate("G.cam.pitch = 0.25")
    wait_game(page, 1.0)
    print("beach close:", state(page))
    page.screenshot(path=OUT + "/lights2-beach-close.png")

    # 3. beach wide — level angle from west of the boardwalk (z=40),
    #    looking east: boardwalk + beach + pier + ocean
    page.evaluate("G.debug.teleport(185, 40)")
    page.evaluate("G.cam.yaw = -Math.PI / 2")
    page.evaluate("G.cam.pitch = 0.45")
    wait_game(page, 1.0)
    print("beach wide:", state(page))
    page.screenshot(path=OUT + "/lights3-beach-wide.png")

    # 4. night Shibuya — clock to 21:30, on foot at the SW corner
    #    of the crossing so the player doesn't block the view
    page.evaluate("G.clockMin = 21 * 60 + 30")
    page.evaluate("G.debug.teleport(24, 24)")
    page.evaluate("G.cam.yaw = Math.PI / 4")  # look NE into the crossing
    page.evaluate("G.cam.pitch = 0.35")
    wait_game(page, 1.2)
    print("night:", state(page))
    page.screenshot(path=OUT + "/lights4-night.png")
    print("ERRORS:", errs)
    browser.close()
    print("DONE")
