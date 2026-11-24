"""Retake only shots 3 and 4 for SOLSTICE BAY with aimed camera targets.
  3. beach wide — player at (185,47), camera aimed at the beach/pier (245,3,40)
  4. night Shibuya — player south of the crossing (38,62), camera aimed at
     the crossing center (38,3,38); clock 21:30
Usage: python3 shot_lights_fix.py [base_url]
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
    page.click("#btn-start")
    page.wait_for_timeout(800)

    # 3. beach wide — aim the camera at the beach + pier, clear of the palm
    page.evaluate("G.debug.teleport(185, 47)")
    page.evaluate("G.cam.yaw = -Math.PI / 2")
    page.evaluate("G.cam.pitch = 0.45")
    page.evaluate("G.debug.setCamTarget(245, 3, 40)")
    wait_game(page, 1.0)
    print("beach wide:", state(page))
    page.screenshot(path=OUT + "/lights3-beach-wide.png")
    page.evaluate("G.debug.clearCamTarget()")

    # 4. night Shibuya — aim the camera at the crossing center
    page.evaluate("G.clockMin = 21 * 60 + 30")
    page.evaluate("G.debug.teleport(38, 62)")
    page.evaluate("G.cam.yaw = 0")
    page.evaluate("G.cam.pitch = 0.35")
    page.evaluate("G.debug.setCamTarget(38, 3, 38)")
    wait_game(page, 1.2)
    print("night:", state(page))
    page.screenshot(path=OUT + "/lights4-night.png")
    page.evaluate("G.debug.clearCamTarget()")
    print("ERRORS:", errs)
    browser.close()
    print("DONE")
