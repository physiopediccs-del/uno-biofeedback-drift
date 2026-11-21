from pathlib import Path
import sys
root = Path(__file__).resolve().parent
parts = ("geometry", "spectators", "world", "car", "drive", "matrices", "pavement", "occlusion", "visibility", "canopy", "ambient", "render", "hud", "main")
script = '\n'.join((root / (name + '.js')).read_text() for name in parts)
out = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root.parent / 'index.html'
out.write_text((root / 'page.html').read_text().replace('/*__GAME__*/', script))
print(f'{out.name}  {out.stat().st_size:,} bytes')
