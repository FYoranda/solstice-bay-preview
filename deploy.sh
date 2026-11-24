#!/bin/bash
# Deploy SOLSTICE BAY to a NEW GitHub repo + GitHub Pages.
# NEVER prints the token. Run on EC2.
set -u
REPO="solstice-bay-preview"
OWNER="FYoranda"
SRC="$HOME/solstice-bay-preview"
PUB="$HOME/solstice-publish"

# --- read PAT from ~/.git-credentials (format https://user:TOKEN@github.com) ---
CRED=$(grep -m1 github.com "$HOME/.git-credentials" 2>/dev/null || true)
if [ -z "$CRED" ]; then echo "ERR: no github credential in ~/.git-credentials"; exit 1; fi
TOKEN=$(echo "$CRED" | sed -E 's|https://[^:]+:([^@]+)@.*|\1|')
if [ -z "$TOKEN" ]; then echo "ERR: could not parse token"; exit 1; fi

AUTH=(-H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json")
API="https://api.github.com"

# --- 1. check repo exists ---
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$API/repos/$OWNER/$REPO")
echo "repo check: HTTP $CODE"
if [ "$CODE" = "404" ]; then
  echo "creating repo $OWNER/$REPO ..."
  RESP=$(curl -s -X POST "${AUTH[@]}" -d "{\"name\":\"$REPO\",\"description\":\"SOLSTICE BAY — sunset coastal open-world crime game (preview)\",\"private\":false}" "$API/user/repos")
  echo "$RESP" | grep -o '"full_name": *"[^"]*"' | head -1
  echo "$RESP" | grep -o '"message": *"[^"]*"' | head -1
elif [ "$CODE" = "200" ]; then
  echo "repo already exists — using it (NOT touching make-gta-6)"
else
  echo "ERR: unexpected repo check HTTP $CODE"; exit 1
fi

# --- 2. clean publish folder (game only, no test scripts) ---
rm -rf "$PUB"
mkdir -p "$PUB/js"
cp "$SRC/index.html" "$SRC/README.md" "$PUB/"
cp "$SRC/js/three.min.js" "$SRC/js/world.js" "$SRC/js/game.js" "$SRC/js/ui.js" "$PUB/js/"
echo "publish folder:"
find "$PUB" -type f | sort

# --- 3. push to main ---
cd "$PUB" || exit 1
git init -q
git checkout -q -b main
git add -A
git -c user.name="FYoranda" -c user.email="fyoranda@gmail.com" commit -qm "SOLSTICE BAY preview — sunset open-world crime game (offline, Three.js vendored)"
git remote add origin "https://$TOKEN@github.com/$OWNER/$REPO.git"
git push -f -q -u origin main 2>&1 | sed 's/[A-Za-z0-9_]\{20,\}/<token>/g'
echo "push exit: $?"

# --- 4. enable GitHub Pages (main, root) ---
sleep 2
RESP=$(curl -s -X POST "${AUTH[@]}" -d '{"source":{"branch":"main","path":"/"}}' "$API/repos/$OWNER/$REPO/pages")
echo "pages enable response:"
echo "$RESP" | head -c 600; echo
echo "---"
echo "Pages URL: https://$OWNER.github.io/$REPO/"
echo "Repo URL:  https://github.com/$OWNER/$REPO"
