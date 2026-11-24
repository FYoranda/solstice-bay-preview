"""Diagnose the E-to-enter-car path."""
import sys
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
    page.evaluate("G.debug.teleport(5, 33)")
    page.wait_for_timeout(300)
    print("before key, nearestCar:", page.evaluate("G.nearestCar ? (G.nearestCar(4.6) ? G.nearestCar(4.6).type.name : null) : 'no fn'"))
    print("player:", page.evaluate("({x: G.player.x, z: G.player.z, inCar: G.player.inCar})"))
    print("starter car:", page.evaluate("({x: G.cars[0].x, z: G.cars[0].z, name: G.cars[0].type.name})"))
    # press E and immediately check if the keydown registered
    page.keyboard.press("e")
    page.wait_for_timeout(100)
    print("consumeKey(KeyE) right after press:", page.evaluate("G.consumeKey('KeyE')"))
    page.wait_for_timeout(800)
    print("inCar after E:", page.evaluate("G.player.inCar"))
    print("consumeKey(KeyE) again:", page.evaluate("G.consumeKey('KeyE')"))
    # direct call to enterCar
    print("direct enterCar():", page.evaluate("G.debug.enterCar(), G.player.inCar"))
    print("state:", page.evaluate("G.debug.state()"))
    browser.close()
