"""Compile the reviewed JSON registry into its dependency-free browser asset."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def render(aliases):
    value = json.dumps(aliases, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return ("/* Generated from docs/data/club_aliases.json; edit the registry. */\n"
            "(function(root){'use strict';const aliases=" + value + ";\n"
            "if(typeof module==='object'&&module.exports)module.exports=aliases;\n"
            "else root.MatchpulseClubAliases=aliases;\n"
            "})(typeof globalThis!=='undefined'?globalThis:this);\n")


if __name__ == "__main__":
    data = json.loads((ROOT / "docs/data/club_aliases.json").read_text(encoding="utf-8"))
    (ROOT / "docs/club-aliases.js").write_text(render(data["aliases"]), encoding="utf-8")
