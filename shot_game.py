"""Full-quality screenshots for SOLSTICE BAY (no test mode, 1280x800).
Stages 4 scenes via debug hooks and screenshots each:
  1. driving west down the avenue toward the sunset
  2. on foot at the beach, looking back at the city + sunset
  3. mission active (plaza beacon in view)
  4. police chase (camera aimed at the nearest police car)
Usage: python3 shot_game.py [base_url]
"""
import sys, time, math
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
    page.click("#btn-start")
    page.wait_for_timeout(800)

    # 1. driving west on the avenue (road z=38) toward the sunset
    page.evaluate("G.debug.teleport(6, 34)")
    page.wait_for_timeout(300)
    page.keyboard.press("e")
    wait_game(page, 0.5)
    if not state(page)["inCar"]:
        page.keyboard.press("e")
        wait_game(page, 0.5)
    print("inCar:", state(page)["inCar"])
    page.evaluate("G.debug.teleport(150, 38)")
    page.evaluate("G.player.car.heading = -Math.PI/2")  # face -X (west, sunset)
    page.keyboard.down("w")
    try:
        wait_game(page, 1.6)
    finally:
        page.keyboard.up("w")
    print("drive:", state(page))
    page.screenshot(path=OUT + "/final1-drive.png")

    # 2. on foot at the beach, looking west at the city + sunset
    page.keyboard.press("e")
    wait_game(page, 0.5)
    page.evaluate("G.debug.teleport(208, 0)")
    page.evaluate("G.cam.yaw = Math.PI/2")  # look -X (west)
    page.evaluate("G.cam.pitch = 0.28")
    wait_game(page, 0.6)
    print("beach:", state(page))
    page.screenshot(path=OUT + "/final2-beach.png")

    # 3. mission active — player south of the plaza beacon, looking north at it
    page.evaluate("G.debug.startMission(0)")
    page.evaluate("G.debug.teleport(0, 20)")
    page.evaluate("G.cam.yaw = 0")  # look -Z (north, toward beacon at 0,0)
    page.evaluate("G.cam.pitch = 0.3")
    wait_game(page, 0.6)
    print("mission:", state(page))
    page.screenshot(path=OUT + "/final3-mission.png")

    # 4. police chase — on foot on the avenue, camera aimed at nearest police car
    page.evaluate("G.debug.setHeat(65)")
    page.evaluate("G.debug.teleport(0, 38)")
    wait_game(page, 3.0)
    # aim camera at the nearest police car
    page.evaluate("""(() => {
      const p = G.player, pol = G.police || [];
      let best = null, bd = 1e9;
      for (const c of pol) { const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2; if (d < bd) { bd = d; best = c; } }
      if (best) {
        const dx = best.x - p.x, dz = best.z - p.z;
        G.cam.yaw = Math.atan2(-dx, -dz);
        G.cam.pitch = 0.25;
      }
    })()""")
    wait_game(page, 0.4)
    print("chase:", state(page))
    page.screenshot(path=OUT + "/final4-chase.png")
    print("ERRORS:", errs)
    browser.close()
    print("DONE")
