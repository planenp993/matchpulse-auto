from pathlib import Path
import gzip
p=Path(__file__).resolve().parent/'dist'
(p/'data.js').write_bytes(gzip.decompress((p/'data.js.gz').read_bytes()))
print('Restored dated demonstration snapshot; no network.')
