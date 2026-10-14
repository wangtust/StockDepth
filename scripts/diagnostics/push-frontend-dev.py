#!/usr/bin/env python3
"""Publish an explicit coordinator-reviewed file list; never push main or force."""
import json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def main(stage):
    base=ROOT/'var/codex-frontend-team'
    receipt=json.loads((base/f'stage{stage}-coordinator.receipt.json').read_text())
    assert receipt['status']=='complete', 'Stage not accepted'
    assert git('branch','--show-current')=='dev', 'Must publish from dev'
    assert not git('diff','--cached','--name-only'), 'Existing staged changes need review'
    paths=receipt.get('commit_paths',[])
    assert paths and len(paths)==len(set(paths)), 'Explicit reviewed file list required'
    for p in paths:
        assert isinstance(p,str) and not p.startswith('/') and '..' not in Path(p).parts
        assert p=='PLAN.md' or p.startswith(('apps/web/','docs/','scripts/diagnostics/frontend-','scripts/tests/frontend-')) or p=='scripts/diagnostics/push-frontend-dev.py', 'Frontend paths only'
        assert '/app/api/' not in p and not p.endswith('/actions.ts') and '/lib/db/' not in p and '/migrations/' not in p, 'Frozen backend path'
        assert not any(part in ('node_modules','var','.next','.venv','__pycache__') or part.startswith('.env') for part in Path(p).parts), 'Private/runtime path'
    remote=git('ls-remote','--heads','origin','refs/heads/dev')
    if remote:
        git('fetch','origin','dev')
        subprocess.run(['git','merge-base','--is-ancestor','FETCH_HEAD','HEAD'],cwd=ROOT,check=True)
    git('add','--',*paths)
    if git('diff','--cached','--name-only'):
        git('diff','--cached','--check')
        git('commit','-m',f'ui: complete verified frontend phase {stage}')
    sha=git('rev-parse','HEAD')
    subprocess.run(['git','push','origin','HEAD:refs/heads/dev'],cwd=ROOT,check=True)
    assert git('ls-remote','--heads','origin','refs/heads/dev').split()[0]==sha
    (base/f'stage{stage}-push.json').write_text(json.dumps({'branch':'dev','commit':sha,'status':'verified'},indent=2)+'\n')
    print('Verified dev push:',sha)
if __name__=='__main__':main(int(sys.argv[1]))
