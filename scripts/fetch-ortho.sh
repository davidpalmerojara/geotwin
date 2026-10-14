#!/usr/bin/env bash
# Optional: puts a downloaded copy of the PNOA orthophoto of Laguna de Duero (XYZ tiles z13-z19,
# CC-BY 4.0 scne.es, cedido por © Instituto Geográfico Nacional) in apps/web/public/ortho/, the
# viewer's first source. Without it the viewer asks the IDEE and IGN servers directly.
#
#   scripts/fetch-ortho.sh                 # downloads pnoa-laguna-z13-19.zip from release data-laguna
#   scripts/fetch-ortho.sh ruta/al/zip     # uses a zip you already have
#
# The zip is made by descargar_pnoa_laguna.py (see docs/laguna-de-duero.md). It is treated as
# untrusted: it is unpacked into a new folder, and anything other than z/x/y.jpg tiles (JPEG
# content) and LEEME.txt makes the script stop without touching apps/web/public/ortho/.
# Downloading needs the GitHub CLI (gh) logged in, or GITHUB_TOKEN, because the repo is private.
set -euo pipefail

REPO=${REPO:-davidpalmerojara/geotwin-cloud}
TAG=${TAG:-data-laguna}
ASSET=${ASSET:-pnoa-laguna-z13-19.zip}
root=$(cd "$(dirname "$0")/.." && pwd)
dest="$root/apps/web/public/ortho"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() {
  echo "fetch-ortho: $*" >&2
  exit 1
}
command -v unzip >/dev/null || fail "hace falta unzip"

zip="${1:-}"
if [ -z "$zip" ]; then
  zip="$work/$ASSET"
  if command -v gh >/dev/null && gh release download "$TAG" -R "$REPO" -p "$ASSET" -D "$work" 2>/dev/null; then
    :
  else
    auth=()
    [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
    id=$(curl -fsSL "${auth[@]}" "https://api.github.com/repos/$REPO/releases/tags/$TAG" |
      ASSET="$ASSET" python3 -I -c 'import json, os, sys
for a in json.load(sys.stdin).get("assets", []):
    if a["name"] == os.environ["ASSET"]:
        print(a["id"])') || fail "no se pudo leer la release $TAG de $REPO"
    [ -n "$id" ] || {
      echo "fetch-ortho: la release $TAG aún no tiene $ASSET; el visor usará los servidores PNOA."
      exit 0
    }
    curl -fsSL "${auth[@]}" -H "Accept: application/octet-stream" \
      "https://api.github.com/repos/$REPO/releases/assets/$id" -o "$zip" ||
      fail "no se pudo descargar $ASSET"
  fi
fi
[ -f "$zip" ] || fail "no existe $zip"

# Only z/x/y.jpg (z 13-19), their folders and LEEME.txt: no other files, no absolute paths, no ..
bad=$(unzip -Z1 "$zip" | grep -Ev '^(LEEME\.txt|1[3-9]/|1[3-9]/[0-9]+/|1[3-9]/[0-9]+/[0-9]+\.jpg)$' || true)
[ -z "$bad" ] || fail "el zip contiene entradas no permitidas: $(echo "$bad" | head -5 | tr '\n' ' ')"
unzip -q "$zip" -d "$work/unzip"
# Symbolic links or special files would not show in the listing check above.
[ -z "$(find "$work/unzip" ! -type f ! -type d)" ] || fail "el zip contiene enlaces o ficheros especiales"
count=0
while IFS= read -r -d '' tile; do
  [ "$(head -c 3 "$tile" | od -An -tx1 | tr -d ' \n')" = ffd8ff ] || fail "$tile no es un JPEG"
  count=$((count + 1))
done < <(find "$work/unzip" -name '*.jpg' -print0)
[ "$count" -gt 0 ] || fail "el zip no tiene teselas"
[ -f "$work/unzip/LEEME.txt" ] || fail "falta LEEME.txt (la atribución)"

rm -rf "$dest"
mkdir -p "$dest"
cp -R "$work/unzip/." "$dest/"
echo "fetch-ortho: $count teselas en apps/web/public/ortho/ ($(du -sh "$dest" | cut -f1))."
echo "fetch-ortho: $(head -c 300 "$dest/LEEME.txt")"
