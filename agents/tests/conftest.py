from __future__ import annotations

import sys
from pathlib import Path

# agents/main.py and friends import as `from config import settings`,
# `from services...`, `from agents...` — i.e. relative to agents/ being on
# sys.path. The existing evals/conftest.py relies on the same thing when
# pytest is run from agents/; replicate that here for tests/.
AGENTS_DIR = Path(__file__).parent.parent
if str(AGENTS_DIR) not in sys.path:
    sys.path.insert(0, str(AGENTS_DIR))
