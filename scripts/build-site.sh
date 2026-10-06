#!/usr/bin/env bash
# Assembles the static site into a folder (default _site) for GitHub Pages.
#
# Usage: scripts/build-site.sh [folder] [build id]
#
# Browsers keep module files for a while, and Pages lets them. After a release a visitor could get
# the new index.html together with old cached modules, which breaks the page. So the build id is
# added to the address of every file of the editor: the entry script, the stylesheet and every
# relative import. The modules of classic.html are left alone.
set -euo pipefail

out="${1:-_site}"
build="${2:-dev}"

rm -rf "$out"
mkdir -p "$out"
cp -r index.html classic.html app.css style.css js lib lzma data assets logo_*.mp4 logo_repeat.gif "$out"/

# Relative imports: `from "./x.mjs"` and `import("./x.mjs")`
rewrite='s#(from[[:space:]]*["'"'"'])(\.{1,2}/[^"'"'"']+\.m?js)(["'"'"'])#\1\2?v='"$build"'\3#g;'
rewrite+='s#(import\([[:space:]]*["'"'"'])(\.{1,2}/[^"'"'"']+\.m?js)(["'"'"']\))#\1\2?v='"$build"'\3#g'

while IFS= read -r file; do
  sed -E -i "$rewrite" "$file"
done < <(
  {
    find "$out/js/render" "$out/js/pack" "$out/js/ui" "$out/js/model" "$out/js/cache" "$out/lib" \
      -type f \( -name '*.mjs' -o -name '*.js' \) ! -name 'three.module.min.js'
    echo "$out/js/app.mjs"
    echo "$out/js/editor.mjs"
  }
)

sed -E -i \
  -e "s#src=\"js/app\.mjs\"#src=\"js/app.mjs?v=$build\"#" \
  -e "s#href=\"app\.css\"#href=\"app.css?v=$build\"#" \
  -e "s#<meta name=\"build\" content=\"dev\" />#<meta name=\"build\" content=\"$build\" />#" \
  "$out/index.html"

grep -q "app.mjs?v=$build" "$out/index.html"
grep -q "content=\"$build\"" "$out/index.html"
grep -q "three.module.min.js?v=$build" "$out/js/render/Scene.mjs"
