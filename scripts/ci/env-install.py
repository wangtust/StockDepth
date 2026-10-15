"""One CI install entry; run in a clean clone with Python3.11/Node22/root pnpm."""
import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import shutil

ROOT = Path(__file__).resolve().parents[2]


def run(args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', choices=['all', 'node', 'python'], default='all',
                        help='Install only the dependencies needed by this CI job')
    parser.add_argument('--venv', type=Path,
                        help='New disposable virtualenv path; must not already exist')
    options = parser.parse_args()
    if options.scope != 'node' and options.venv is None:
        parser.error('--venv is required for Python installation')
    spec = importlib.util.spec_from_file_location('env_check', ROOT / 'scripts/ci/env-check.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.check()
    if (ROOT / '.env').exists():
        raise RuntimeError('CI install requires a clean clone without root .env')
    target = options.venv.resolve() if options.scope != 'node' else None
    if target is not None and target.exists():
        raise RuntimeError('Refusing to reuse an existing Python environment')
    if options.scope in ('all', 'node'):
        run(['pnpm', 'install', '--frozen-lockfile'])
    if options.scope == 'node':
        return
    # Resolve launcher symlinks so relocatable Python distributions find stdlib.
    try:
        run([str(Path(sys.executable).resolve()), '-m', 'venv', str(target)])
        python = str(target / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'))
        run([python, '-m', 'pip', 'install', '--require-hashes', '-r',
             'apps/api/requirements-ci.lock'])
        run([python, '-m', 'pip', 'install', '--no-deps', '--no-build-isolation', './apps/api'])
        run([python, '-m', 'pip', 'check'])
    except BaseException:
        if target.exists():
            shutil.rmtree(target)
        raise
    print(f'Installed. Test interpreter: {python}; owner must finally remove disposable workspace/venv.')


if __name__ == '__main__':
    main()
