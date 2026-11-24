"""Retake the beach crowd shot from two palm-free angles.
Candidates: npc2b-beach.png (from south, (210,12) -> net) and
npc2c-beach.png (from north-west, (214,8) -> net).
Usage: python3 shot_npc_fix.py [base_url]
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

    # stage the beach crowd near the net (same staging as shot_npc.py)
    page.evaluate("""() => {
      const w = G.peds.filter(p => p.mode === 'beach');
      if (w[0]) { w[0].x = 224; w[0].z = -8; w[0].tx = 224; w[0].tz = -8; }
      if (w[1]) { w[1].x = 226; w[1].z = 4; w[1].tx = 226; w[1].tz = 4; }
      const s = G.peds.filter(p => p.mode === 'sit');
      if (s[0]) { s[0].x = 226; s[0].z = -32; s[0].yaw = Math.PI / 2; }
    }""")

    # candidate B: from the south, looking north-east at the net
    page.evaluate("G.debug.teleport(210, 12)")
    page.evaluate("G.cam.yaw = -Math.PI / 2")
    page.evaluate("G.cam.pitch = 0.3")
    page.evaluate("G.debug.setCamTarget(233, 2, -16)")
    wait_game(page, 1.0)
    page.screenshot(path=OUT + "/npc2b-beach.png")
    page.evaluate("G.debug.clearCamTarget()")

    # candidate C: from the north-west, closer to the net
    page.evaluate("G.debug.teleport(216, 6)")
    page.evaluate("G.cam.yaw = -Math.PI / 2")
    page.evaluate("G.cam.pitch = 0.28")
    page.evaluate("G.debug.setCamTarget(234, 2, -18)")
    wait_game(page, 1.0)
    page.screenshot(path=OUT + "/npc2c-beach.png")
    page.evaluate("G.debug.clearCamTarget()")
    print("ERRORS:", errors)
    browser.close()
    print("DONE")
