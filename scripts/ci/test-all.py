"""Phase1 offline CI entry. Browser installation is an explicit setup command."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--suite', choices=['all', 'python', 'frontend'], default='all')
options = parser.parse_args()
spec = importlib.util.spec_from_file_location('env_check', root / 'scripts/ci/env-check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
check.check()
if options.suite in ('all', 'python'):
    subprocess.run([sys.executable, 'scripts/ci/test-python.py'], cwd=root, check=True)
if options.suite in ('all', 'frontend'):
    subprocess.run(['node', 'scripts/ci/test-frontend.cjs'], cwd=root, check=True)
