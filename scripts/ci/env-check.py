"""Validate CI runtimes without loading dotenv or contacting services."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def check():
    if sys.version_info[:2] != (3, 11):
        raise RuntimeError("CI requires Python 3.11")
    node = subprocess.check_output(["node", "--version"], text=True).strip()
    if node.split('.')[0] != 'v22':
        raise RuntimeError(f"CI requires Node 22, found {node}")
    target = json.loads((ROOT / 'package.json').read_text())['packageManager']
    pnpm = subprocess.check_output(['pnpm', '--version'], cwd=ROOT, text=True).strip()
    if target != f'pnpm@{pnpm}':
        raise RuntimeError(f"CI requires {target}, found pnpm@{pnpm}")
    print(json.dumps({'node': node, 'packageManager': target,
                      'python': sys.version.split()[0]}))


if __name__ == '__main__':
    check()
