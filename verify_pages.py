"""Verify the LIVE GitHub Pages URL loads the game with 0 console errors.
Usage: python3 verify_pages.py [pages_url]
"""
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://fyoranda.github.io/solstice-bay-preview/"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--disable-dev-shm-usage",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs, failed = [], []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("requestfailed", lambda r: failed.append(r.url))
    page.on("response", lambda r: failed.append(r.url + " -> " + str(r.status)) if r.status >= 400 else None)
    # retry a few times: GitHub Pages first build can take ~1 min
    for attempt in range(6):
        resp = page.goto(URL, wait_until="load", timeout=60000)
        print("attempt", attempt + 1, "HTTP", resp.status if resp else None)
        if resp and resp.status == 200:
            break
        time.sleep(20)
    page.wait_for_timeout(5000)
    ready = page.evaluate("window.G && G.ready")
    print("G.ready:", ready)
    print("THREE:", page.evaluate("typeof THREE"))
    print("TITLE:", page.title())
    # click start and confirm the game actually runs
    if ready:
        page.click("#btn-start")
        page.wait_for_timeout(1500)
        print("STATE:", page.evaluate("G.state"))
        page.screenshot(path="/tmp/solstice/pages-live.png")
    print("CONSOLE ERRORS:", len(errs), errs[:5])
    print("FAILED REQUESTS:", len(failed), failed[:5])
    browser.close()
    print("LIVE OK" if ready and not errs and not failed else "LIVE CHECK FAILED")
