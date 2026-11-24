"""Tokyo screenshots for SOLSTICE BAY (full quality, 1280x800).
  1. neon Shibuya crossing — race car driving north through the scramble
  2. sakura street — on foot looking north down the sakura-lined road
  3. torii gate — plaza park, torii + stone lanterns + sakura
  4. police heli chase — beach at sunset, camera aimed at the SBPD heli
Usage: python3 shot_tokyo.py [base_url]
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

    # 1. race car through the Shibuya scramble crossing (38,38)
    page.evaluate("G.debug.teleport(6, 34)")
    page.wait_for_timeout(300)
    page.keyboard.press("e")
    wait_game(page, 0.5)
    if not state(page)["inCar"]:
        page.keyboard.press("e")
        wait_game(page, 0.5)
    print("inCar:", state(page)["inCar"])
    page.evaluate("G.debug.teleport(38, 66)")
    page.evaluate("G.player.car.heading = Math.PI")  # face north (-Z)
    page.keyboard.down("w")
    try:
        wait_game(page, 2.2)
    finally:
        page.keyboard.up("w")
    print("crossing:", state(page))
    page.screenshot(path=OUT + "/tokyo1-crossing.png")

    # 2. sakura street, on foot in the middle of the road looking north
    page.keyboard.press("e")
    wait_game(page, 0.5)
    page.evaluate("G.debug.teleport(-38, 80)")
    page.evaluate("G.cam.yaw = 0")  # look north (-Z) down the sakura street
    page.evaluate("G.cam.pitch = 0.3")
    wait_game(page, 0.8)
    print("sakura:", state(page))
    page.screenshot(path=OUT + "/tokyo2-sakura.png")

    # 3. torii gate in the plaza park
    page.evaluate("G.debug.teleport(-12, -10)")
    page.evaluate("G.debug.setCamTarget(-22, 4, -22)")
    page.evaluate("G.cam.pitch = 0.3")
    wait_game(page, 0.8)
    print("torii:", state(page))
    page.screenshot(path=OUT + "/tokyo3-torii.png")
    page.evaluate("G.debug.clearCamTarget()")

    # 4. police heli over the city at sunset — shoot from the Shibuya crossing
    # (open intersection, no palms in the sight line), camera aimed at the
    # SBPD heli when it swings to the west side so the skyline is behind it
    page.evaluate("G.debug.setHeat(65)")
    page.evaluate("G.debug.teleport(38, 38)")
    # wait until the heli has settled onto its orbit near the player
    t_end = time.time() + 90
    while time.time() < t_end:
        hp = page.evaluate("G.debug.heliPos()")
        st = state(page)
        if hp and ((hp["x"] - st["x"]) ** 2 + (hp["z"] - st["z"]) ** 2) ** 0.5 < 40:
            break
        time.sleep(0.5)
    wait_game(page, 3.0)
    print("chase:", state(page), "heli:", page.evaluate("G.debug.heliPos()"))
    # wait (game time) for the heli to orbit to the west side of the player
    t_end = time.time() + 60
    while time.time() < t_end:
        hp = page.evaluate("G.debug.heliPos()")
        st = state(page)
        if hp and hp["x"] < st["x"] - 10 and abs(hp["z"] - st["z"]) < 12:
            break
        time.sleep(0.5)
        page.evaluate("G.time")  # keep the loop alive
    print("heli west:", page.evaluate("G.debug.heliPos()"))
    page.evaluate("""(() => {
      const h = G.debug.heliPos();
      if (h) G.debug.setCamTarget(h.x, h.y + 4, h.z);
    })()""")
    page.evaluate("G.cam.pitch = 0.25")
    wait_game(page, 0.6)
    page.screenshot(path=OUT + "/tokyo4-heli.png")
    page.evaluate("G.debug.clearCamTarget()")
    print("ERRORS:", errs)
    browser.close()
    print("DONE")
