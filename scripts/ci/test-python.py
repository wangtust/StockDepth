"""Run existing offline tests in a clean clone using the locked Python3.11 env."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import json

root = Path(__file__).resolve().parents[2]
if sys.version_info[:2] != (3, 11):
    raise SystemExit('Python3.11 is required')
if (root / '.env').exists():
    raise SystemExit('Run in a clean clone without root .env')
env = {key: value for key, value in os.environ.items()
       if key in ('PATH', 'SYSTEMROOT', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'VIRTUAL_ENV')}
env.update(PYTHONPATH=str(root / 'apps/api'), STOCKDEPTH_TEST_OFFLINE='1')
output = tempfile.TemporaryDirectory(prefix='stockdepth-python-')
try:
    env.update(STOCKDEPTH_RESULTS_DIR=str(Path(output.name) / 'results'),
               STOCKDEPTH_CACHE_DIR=str(Path(output.name) / 'cache'),
               STOCKDEPTH_MEMORY_LOG_PATH=str(Path(output.name) / 'memory.md'))
    subprocess.run([sys.executable, '-m', 'pytest', '-c', 'apps/api/pyproject.toml',
                    'apps/api/tests', '-m', 'not integration', '-q', '-ra'],
                   cwd=root, env=env, check=True)
finally:
    output.cleanup()
    print(json.dumps({'cleanup': 'python synthetic output', 'removed': not Path(output.name).exists()}))
