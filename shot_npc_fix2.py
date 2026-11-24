"""Retake the beach crowd shot using the same recipe as npc1-street
(player south of the subject, camera yaw 0 looking north, target directly
ahead) so the player lands center-bottom instead of at the screen edge.
Player at (230,2), target the net (230,2,-20): volley players + sitter +
walkers + ocean in frame.
Usage: python3 shot_npc_fix2.py [base_url]
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8471"
URL = BASE.rstrip("/") + "/index.html"
OUT = "/tmp/solstice"

def wait_game(page, seconds, timeout=180):
    t0 = page.evaluate("G.time")
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.4)
        if page.evaluate("G.time") - t0 >= seconds:
            return True
    raise TimeoutError("game time did not advance")

errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(4000)
    print("READY:", page.evaluate("window.G && G.ready"))
    page.click("#btn-start")
    page.wait_for_timeout(800)
    page.evaluate("G.clockMin = 18 * 60 + 30")

    page.evaluate("""() => {
      const w = G.peds.filter(p => p.mode === 'beach');
      if (w[0]) { w[0].x = 222; w[0].z = -12; w[0].tx = 222; w[0].tz = -12; }
      if (w[1]) { w[1].x = 238; w[1].z = -10; w[1].tx = 238; w[1].tz = -10; }
      const s = G.peds.filter(p => p.mode === 'sit');
      if (s[0]) { s[0].x = 226; s[0].z = -32; s[0].yaw = Math.PI / 2; }
    }""")

    page.evaluate("G.debug.teleport(230, 2)")
    page.evaluate("G.cam.yaw = 0")
    page.evaluate("G.cam.pitch = 0.3")
    page.evaluate("G.debug.setCamTarget(230, 2, -20)")
    wait_game(page, 1.0)
    page.screenshot(path=OUT + "/npc2d-beach.png")
    page.evaluate("G.debug.clearCamTarget()")
    print("ERRORS:", errors)
    browser.close()
    print("DONE")
