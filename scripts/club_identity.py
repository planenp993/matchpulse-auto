"""Shared, reviewed club identities. No fuzzy matching at runtime."""
import json
import unicodedata
from pathlib import Path

REGISTRY = Path(__file__).resolve().parents[1] / "docs/data/club_aliases.json"
ALIASES = json.loads(REGISTRY.read_text(encoding="utf-8"))["aliases"]


def normal(name):
    text = "".join(
        c for c in unicodedata.normalize("NFKD", str(name or ""))
        if not unicodedata.combining(c)
    ).replace("&", " and ").lower()
    return " ".join("".join(c if c.isalnum() else " " for c in text).split())


def club_key(name):
    key = normal(name)
    return ALIASES.get(key, key)
