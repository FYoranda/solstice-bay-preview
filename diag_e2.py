"""Diagnose E handling WITHOUT stealing the keypress + measure frame rate."""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8471/index.html"
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: print("PAGEERROR:", e))
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(3000)
    page.click("#btn-start")
    page.wait_for_timeout(800)
    # frame rate: sample G.time twice, 2s apart
    t0 = page.evaluate("G.time")
    time.sleep(2)
    t1 = page.evaluate("G.time")
    print("game-time advanced in 2s real:", round(t1 - t0, 2), "s (expect ~2.0 if loop runs full speed)")
    # E test without manual consume
    page.evaluate("G.debug.teleport(5, 33)")
    page.wait_for_timeout(300)
    page.keyboard.press("e")
    for wait in (500, 1000, 2000):
        page.wait_for_timeout(wait)
        print(f"inCar after E +{wait}ms more:", page.evaluate("G.player.inCar"))
        if page.evaluate("G.player.inCar"):
            break
    print("errors:", page.evaluate("G.errors.slice(0,3)"))
    browser.close()
