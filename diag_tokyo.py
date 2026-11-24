"""Diagnostic shots: menu orbit view + konbini front view (identify the white slab).
Usage: python3 diag_tokyo.py [base_url]
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8471"
URL = BASE.rstrip("/") + "/index.html"
OUT = "/tmp/solstice"

def wait_game(page, seconds, timeout=120):
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
    # menu orbit view (camera circles the city)
    wait_game(page, 2.0)
    page.screenshot(path=OUT + "/diag-menu.png")
    page.click("#btn-start")
    page.wait_for_timeout(800)
    # konbini front: stand on road z=-38 north of the konbini, look south at it
    page.evaluate("G.debug.teleport(66, -40)")
    page.evaluate("G.cam.yaw = Math.PI")  # look south (+Z)
    page.evaluate("G.cam.pitch = 0.3")
    wait_game(page, 0.8)
    page.screenshot(path=OUT + "/diag-konbini.png")
    # neon street: on road x=38 at z=0, look north at the buildings flanking the road
    page.evaluate("G.debug.teleport(38, 20)")
    page.evaluate("G.cam.yaw = 0")
    page.evaluate("G.cam.pitch = 0.3")
    wait_game(page, 0.8)
    page.screenshot(path=OUT + "/diag-neon.png")
    print("ERRORS:", errs)
    browser.close()
    print("DONE")
