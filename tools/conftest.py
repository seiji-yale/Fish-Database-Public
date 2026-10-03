import sys
from pathlib import Path

# Let tests import the standalone scripts that live next to them (tools/mirror/*.py, tools/import/*.py).
for sub in ("mirror", "import"):
    sys.path.insert(0, str(Path(__file__).parent / sub))
