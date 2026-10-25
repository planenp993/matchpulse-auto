"""Build a single offline HTML preview. Uses only bundled public research data."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/"docs"
html=(DOC/"scout.html").read_text(encoding="utf-8")
css=(DOC/"scout.css").read_text(encoding="utf-8")
model=(DOC/"model-core.js").read_text(encoding="utf-8")
core=(DOC/"scout-core.js").read_text(encoding="utf-8")
markets=(DOC/"scout-markets.js").read_text(encoding="utf-8")
ui=(DOC/"scout.js").read_text(encoding="utf-8")
bundle={
 "history":json.loads((DOC/"data/history.json").read_text(encoding="utf-8")),
 "fixtures":json.loads((DOC/"data/fixtures.json").read_text(encoding="utf-8")),
 "status":json.loads((DOC/"data/status.json").read_text(encoding="utf-8")),
}
payload=json.dumps(bundle,ensure_ascii=False,separators=(",",":")).replace("</","<\\/")
html=html.replace('<link rel="stylesheet" href="scout.css">','<style>'+css+'</style>')
for n,source in [("model-core.js",model),("scout-core.js",core),("scout-markets.js",markets),("scout.js",ui)]:
 marker=f'<script src="{n}"></script>'
 replacement='<script>'+source.replace("</script","<\\/script")+'</script>'
 if n=="scout.js":
  replacement='<script>window.SCOUT_EMBEDDED_DATA='+payload+';</script>'+replacement
 if marker not in html:raise RuntimeError(f"Missing script {marker}")
 html=html.replace(marker,replacement)
assert 'scout.css' not in html and 'src="scout.js"' not in html
out=ROOT/"scout-offline.html"
out.write_text(html,encoding="utf-8")
print(f"Built {out.name}: {out.stat().st_size:,} bytes | {len(bundle['history'])} finished and {len(bundle['fixtures'])} fixture rows")
