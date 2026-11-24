"""Close-up of a traffic car's driver (reusable driver shot).
Freezes traffic[0] on the road, puts the camera ~4.5 units off its driver
side (south, +z for heading PI/2) and screenshots it. Usage:
python3 shot_driver.py [base_url]  (default http://127.0.0.1:8471)
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
        time.sleep(0.25)
        if page.evaluate("G.time") - t0 >= seconds:
            return True
    raise TimeoutError("game time did not advance")

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
    page.click("#btn-start")
    page.wait_for_timeout(800)
    page.evaluate("G.clockMin = 18 * 60 + 30")
    # freeze a traffic car on the road, driver side (+z) toward the camera
    page.evaluate("""() => {
      const c = G.traffic[0];
      c.dead = true;
      c.x = 20; c.z = 42; c.heading = Math.PI / 2; c.vx = 0; c.vz = 0;
      c.mesh.position.set(20, 0, 42); c.mesh.rotation.y = Math.PI / 2;
      console.log('DRIVER PRESENT:', !!c.mesh.userData.driver);
    }""")
    # player south of the car, slightly off-axis so they don't block the view;
    # yaw 0 puts the camera 9.2 south of the player -> ~5 south of the car.
    # NOTE: wait on GAME time (SwiftShader renders slowly; real-time waits
    # leave the camera mid-lerp from the spawn point).
    # LOW side-on angle: from above, the cabin roof hides the driver — the
    # driver only reads through the side glass at near-horizontal pitch.
    page.evaluate("G.debug.teleport(22, 37.3)")
    page.evaluate("G.cam.yaw = 0; G.cam.targetYaw = 0")
    page.evaluate("G.cam.pitch = 0.06; G.cam.targetPitch = 0.06")
    page.evaluate("G.debug.setCamTarget(20, 1.0, 42)")
    wait_game(page, 1.2)
    page.screenshot(path=OUT + "/traffic1-driver.png")
    print("DRIVER SHOT SAVED")
    browser.close()

print("ERRORS:", errors)
print("FAILED:", failed)
print("STATUS:", "PASS" if not errors and not failed else "FAIL")
sys.exit(0 if not errors and not failed else 1)
