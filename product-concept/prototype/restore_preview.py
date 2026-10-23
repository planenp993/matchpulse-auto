#!/usr/bin/env python3
"""Restore the frozen 2026-10-23 research snapshot; no network or publication."""
import gzip
from pathlib import Path
root=Path(__file__).resolve().parent
target=root/'dist'/'data.js'
target.write_bytes(gzip.decompress((target.with_suffix('.js.gz')).read_bytes()))
print(f'Restored {target.name}. Open dist/index.html or serve the dist directory.')
