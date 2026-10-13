#!/usr/bin/env python3
"""Independent, bounded stage4 verification; logs stay in coordinator directory."""
from pathlib import Path
import subprocess,json,concurrent.futures,sys
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'var/codex-performance-team/stage4-coordinator-logs'; OUT.mkdir(parents=True,exist_ok=True)
PY='/home/ubuntu/miniforge3/envs/stockdepth/bin/python'
def node_script(name):
 f=ROOT/'scripts/diagnostics'/name
 source=f.read_text().replace('/var/performance/stage4-worker','/var/codex-performance-team/stage4-coordinator-logs')
 if name=='worker-stage4-soak.cjs':
  source=source.replace("await stop([...workers][0],'SIGKILL')","await stop([...workers].find(c=>[...active].some(k=>k.startsWith(c.pid+':'))),'SIGKILL')")
 return ['node','-e',"const M=require('node:module');const m=new M("+json.dumps(str(f))+");m.filename="+json.dumps(str(f))+";m.paths=M._nodeModulePaths("+json.dumps(str(f.parent))+");m._compile("+json.dumps(source)+","+json.dumps(str(f))+");"]
jobs=[('python',[PY,'-m','pytest','apps/api/tests','-m','not integration','-q'],180),('web-types',['apps/web/node_modules/.bin/tsc','--noEmit','-p','apps/web/tsconfig.json'],120),('worker-types',['apps/workers/node_modules/.bin/tsc','--noEmit','-p','apps/workers/tsconfig.json'],120),('migrations',['node_modules/.bin/drizzle-kit','check'],60)]
for n in ['browser','http','soak','regression','polling']:
 cmd=node_script('worker-stage4-'+n+'.cjs');
 if n=='browser':cmd+=['--','coordinator-fixture','after']
 jobs.append((n,cmd,180))
jobs.append(('browser-before',node_script('worker-stage4-browser.cjs')+['--','coordinator-fixture','before'],60))
jobs.append(('graph-soak',[PY,'scripts/diagnostics/stage4-python-graph-soak.py','--seconds','15','--output',str(OUT/'graph-soak.json')],65))
jobs += [('api-isolation',[PY,'scripts/diagnostics/stage4-python-isolation.py','--seconds','60','--output',str(OUT/'api-isolation')],100),('graph-recovery',[PY,'scripts/diagnostics/stage3-python-recovery.py',str(OUT/'graph-recovery.json')],65),('joint',[PY,'scripts/diagnostics/coordinator-stage2-joint.py'],65)]
def run(job):
 import os,time
 name,cmd,limit=job; env=os.environ.copy();env['PYTHONPATH']='apps/api'; start=time.monotonic()
 with (OUT/(name+'.log')).open('w') as log:
  try: code=subprocess.run(cmd,cwd=ROOT/'apps/web' if name=='migrations' else ROOT,env=env,stdout=log,stderr=log,timeout=limit).returncode
  except subprocess.TimeoutExpired:code=124
 return {'name':name,'command':cmd,'exit_code':code,'seconds':time.monotonic()-start,'log':str((OUT/(name+'.log')).relative_to(ROOT))}
# Database suites sequential; no concurrent migration fixtures. Type/Python independent.
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: results=list(pool.map(run,jobs[:3]))
for job in jobs[3:]:
 r=run(job);results.append(r);print(r['name'],r['exit_code'],flush=True)
 (OUT/'verification.json').write_text(json.dumps(results,indent=2)+'\n')
sys.exit(0 if all(r['exit_code']==0 for r in results) else 1)
