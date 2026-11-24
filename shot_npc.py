"""NPC + player-outfit verification and screenshots for SOLSTICE BAY.
Checks: G.ready, 0 console errors, 0 failed requests, ped counts by mode,
player outfit (jacket/beanie/shoes children), walk + jump, sitters stay put,
beach walkers move, volley players hop, beach walker flees from a fast car.
Shots: npc1-street.png (Shibuya crowd + clothed player), npc2-beach.png
(volleyball + sitters + walkers + clothed player).
Usage: python3 shot_npc.py [base_url]  (default http://127.0.0.1:8471)
"""
import sys, time, json
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

def hold_key(page, key, game_seconds):
    page.keyboard.down(key)
    try:
        wait_game(page, game_seconds)
    finally:
        page.keyboard.up(key)

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

    # ---- counts + player outfit ----
    decor = page.evaluate("G.debug.decor()")
    print("DECOR:", json.dumps(decor))
    assert decor["peds"] == 44, f"expected 44 peds, got {decor['peds']}"
    assert decor["pedsByMode"] == {"walk": 34, "beach": 4, "sit": 4, "volley": 2}, \
        f"unexpected modes: {decor['pedsByMode']}"
    outfit = page.evaluate("""() => {
      const m = G.player.mesh;
      const cols = {};
      m.children.forEach(c => { if (c.material && c.material.color) {
        const h = c.material.color.getHex();
        cols[h] = (cols[h] || 0) + 1; } });
      const shoes = [];
      m.userData.legL.children.forEach(c => shoes.push(c.material.color.getHex()));
      m.userData.legR.children.forEach(c => shoes.push(c.material.color.getHex()));
      return { children: m.children.length, colors: cols, shoes: shoes };
    }""")
    print("OUTFIT:", json.dumps(outfit))
    assert outfit["children"] == 14, "player mesh should have 14 children (outfit parts)"
    assert outfit["colors"].get("16726814", 0) == 5, "jacket 0xff3b1e should appear 5x (2 panels + collar + 2 arms)"
    assert outfit["colors"].get("16765471", 0) == 2, "beanie 0xffd21f should appear 2x"
    assert outfit["shoes"] == [15921906, 15921906], "white shoes on both legs"

    # ---- walk + jump: clothes follow the player ----
    page.evaluate("G.debug.teleport(6, 34)")
    wait_game(page, 0.3)
    before = state(page)
    hold_key(page, "w", 1.0)
    page.keyboard.press("Space")
    wait_game(page, 0.5)
    after = state(page)
    moved = ((after["x"] - before["x"]) ** 2 + (after["z"] - before["z"]) ** 2) ** 0.5
    print("WALK:", before, "->", after, "moved", round(moved, 1))
    assert moved > 1.5, "player did not walk"
    meshpos = page.evaluate("({x: G.player.mesh.position.x, z: G.player.mesh.position.z, kids: G.player.mesh.children.length})")
    print("MESH FOLLOWS:", meshpos)
    assert abs(meshpos["x"] - after["x"]) < 0.2 and abs(meshpos["z"] - after["z"]) < 0.2
    assert meshpos["kids"] == 14, "outfit lost children while walking"

    # ---- sitters stay put, legs out ----
    sit = page.evaluate("""() => {
      const s = G.peds.filter(p => p.mode === 'sit');
      return s.map(p => ({x: +p.x.toFixed(1), z: +p.z.toFixed(1),
        legL: +p.mesh.userData.legL.rotation.x.toFixed(2)}));
    }""")
    wait_game(page, 2.0)
    sit2 = page.evaluate("""() => {
      const s = G.peds.filter(p => p.mode === 'sit');
      return s.map(p => ({x: +p.x.toFixed(1), z: +p.z.toFixed(1),
        legL: +p.mesh.userData.legL.rotation.x.toFixed(2)}));
    }""")
    print("SITTERS t0:", json.dumps(sit))
    print("SITTERS t+2s:", json.dumps(sit2))
    assert len(sit) == 4 and all(s["legL"] < -1.2 for s in sit2), "sitters should sit with legs out"
    assert all(abs(a["x"] - b["x"]) < 0.1 and abs(a["z"] - b["z"]) < 0.1
               for a, b in zip(sit, sit2)), "sitters moved!"

    # ---- beach walkers move ----
    bw0 = page.evaluate("G.peds.filter(p => p.mode === 'beach').map(p => [p.x, p.z])")
    wait_game(page, 2.0)
    bw1 = page.evaluate("G.peds.filter(p => p.mode === 'beach').map(p => [p.x, p.z])")
    bw_moved = [round(((a[0]-b[0])**2 + (a[1]-b[1])**2) ** 0.5, 1) for a, b in zip(bw0, bw1)]
    print("BEACH WALKERS moved:", bw_moved)
    assert sum(1 for m in bw_moved if m > 1) >= 3, "beach walkers should stroll"

    # ---- volley players shuffle + hop ----
    hops = []
    for _ in range(6):
        hops.append(page.evaluate("Math.max(...G.peds.filter(p => p.mode === 'volley').map(p => p.hopY))"))
        wait_game(page, 0.8)
    vol = page.evaluate("G.peds.filter(p => p.mode === 'volley').map(p => [Math.round(p.x), Math.round(p.z)])")
    print("VOLLEY hops:", [round(h, 2) for h in hops], "positions:", vol)
    assert max(hops) > 0.2, "volley players should hop"
    assert all(225 <= v[0] <= 235 and -26 <= v[1] <= -14 for v in vol), "volley players off the court"

    # ---- flee: fast car passes a beach walker, it runs away ----
    tgt = page.evaluate("""() => {
      const w = G.peds.find(p => p.mode === 'beach' && !p.dead);
      return {x: w.x, z: w.z};
    }""")
    print("FLEE TARGET walker at:", tgt)
    page.evaluate("G.debug.teleport(5, 33)")
    wait_game(page, 0.3)
    page.keyboard.press("e")
    wait_game(page, 0.4)
    assert state(page)["inCar"], "could not enter car for flee test"
    page.evaluate(f"G.debug.teleport({tgt['x'] - 20}, {tgt['z'] + 6})")
    page.evaluate("G.player.car.heading = Math.PI / 2")  # face east, toward the walker
    before_flee = page.evaluate("G.peds.filter(p => p.mode === 'beach').map(p => [p.x, p.z])")
    hold_key(page, "w", 1.6)
    after_flee = page.evaluate("G.peds.filter(p => p.mode === 'beach').map(p => [p.x, p.z])")
    flee_moved = [round(((a[0]-b[0])**2 + (a[1]-b[1])**2) ** 0.5, 1) for a, b in zip(before_flee, after_flee)]
    print("FLEE moved:", flee_moved)
    assert max(flee_moved) > 2, "no beach walker fled from the fast car"
    page.keyboard.press("e")  # exit car
    wait_game(page, 0.4)

    # ---- shot 1: street crowd at Shibuya (sunset, lamps on) ----
    page.evaluate("G.clockMin = 18 * 60 + 30")
    page.evaluate("G.debug.teleport(38, 62)")
    page.evaluate("G.cam.yaw = 0")
    page.evaluate("G.cam.pitch = 0.32")
    page.evaluate("""() => {
      // stage the Shibuya-zone crowd into the frame for the shot
      const z = G.peds.filter(p => p.zone && p.zone.x1 === 22);
      const spots = [[34, 46], [42, 44], [38, 48]];
      z.forEach((p, i) => { if (spots[i]) { p.x = spots[i][0]; p.z = spots[i][1]; p.tx = p.x; p.tz = p.z; } });
    }""")
    page.evaluate("G.debug.setCamTarget(38, 3, 38)")
    wait_game(page, 1.0)
    print("SHOT1 state:", state(page))
    page.screenshot(path=OUT + "/npc1-street.png")
    page.evaluate("G.debug.clearCamTarget()")

    # ---- shot 2: beach crowd (volley + sitter + walkers) ----
    page.evaluate("G.debug.teleport(212, -4)")
    page.evaluate("G.cam.yaw = -Math.PI / 2")
    page.evaluate("G.cam.pitch = 0.3")
    page.evaluate("""() => {
      // stage two beach walkers and one sitter near the net for the shot
      const w = G.peds.filter(p => p.mode === 'beach');
      if (w[0]) { w[0].x = 224; w[0].z = -8; w[0].tx = 224; w[0].tz = -8; }
      if (w[1]) { w[1].x = 226; w[1].z = 4; w[1].tx = 226; w[1].tz = 4; }
      const s = G.peds.filter(p => p.mode === 'sit');
      if (s[0]) { s[0].x = 226; s[0].z = -32; s[0].yaw = Math.PI / 2; }
    }""")
    page.evaluate("G.debug.setCamTarget(234, 2, -18)")
    wait_game(page, 1.0)
    print("SHOT2 state:", state(page))
    page.screenshot(path=OUT + "/npc2-beach.png")
    page.evaluate("G.debug.clearCamTarget()")

    print("ERRORS:", errors)
    print("FAILED:", failed)
    browser.close()

print("\n==== RESULT ====")
print("CONSOLE ERRORS:", len(errors))
for e in errors: print("  -", e)
print("FAILED REQUESTS:", len(failed))
for f in failed: print("  -", f)
if errors or failed:
    print("STATUS: FAIL")
    sys.exit(1)
print("STATUS: PASS")
