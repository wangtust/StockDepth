"""Bounded localhost API/Mock soak. No dotenv, project DB or actual runner."""
import argparse
import base64
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from unittest.mock import patch


def serve(root):
    import dotenv
    with patch.object(dotenv, 'load_dotenv', lambda *a, **k: False):
        from stockdepth.api import server as api
    api.LOGS_DIR = Path(root)
    api.WEB_PASSWORD = 'isolated-fixture'
    api.WEB_USERNAME = 'admin'
    real = subprocess.Popen
    def mock(cmd, **kwargs):
        run_id = cmd[cmd.index('--run-id')+1]
        directory = api.safe_run_dir('MOCK', '2026-10-13', run_id)
        code = 'import time; time.sleep(.025)'
        if run_id.startswith('fail'):
            code += '; raise SystemExit(7)'
        elif run_id.startswith('hang'):
            code = 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)'
        else:
            code += '; from pathlib import Path; p=Path('+repr(str(directory / 'reports'))+'); p.mkdir(exist_ok=True); (p/"final_trade_decision.md").write_text("local Mock decision")'
        return real([sys.executable, '-c', code], stdout=kwargs['stdout'], stderr=kwargs['stderr'], env={'PATH':os.defpath})
    api.subprocess.Popen = mock
    api.main()


def run(args):
    dest = Path(args.output); dest.mkdir(parents=True, exist_ok=True)
    env = {'PATH':os.defpath, 'PYTHONPATH':str(Path('var/codex-performance-team/stage4-python-before/apps/api' if args.before else 'apps/api').resolve()),
           'STOCKDEPTH_WEB_HOST':'127.0.0.1', 'STOCKDEPTH_WEB_PORT':'0'}
    # Child chooses port 0; capture bound address by patching only HTTP server constructor.
    samples=[]; latencies=[]; cycles=0; children=[]
    with tempfile.TemporaryDirectory(prefix='stage4-python-') as directory:
        root=Path(directory)
        def boot(index):
            e=dict(env, STAGE4_PORT_FILE=str(root/'port'))
            (root/'port').unlink(missing_ok=True)
            log=(dest/f'api-{index}.log').open('w')
            p=subprocess.Popen([sys.executable,__file__,'--serve',directory],env=e,stdout=log,stderr=log)
            children.append(p)
            deadline=time.monotonic()+10
            while not (root/'port').exists():
                assert p.poll() is None, 'isolated API exited before ready'
                if time.monotonic()>deadline: raise TimeoutError('API startup')
                time.sleep(.02)
            return p, log, 'http://127.0.0.1:'+ (root/'port').read_text()
        def request(base,path,data=None):
            req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data else None,
                headers={'Authorization':'Basic '+base64.b64encode(b'admin:isolated-fixture').decode(),'Content-Type':'application/json'})
            start=time.monotonic()
            with urllib.request.urlopen(req,timeout=3) as response: result=json.load(response)
            latencies.append((time.monotonic()-start)*1000)
            return result
        model={'id':1,'provider':'openai-compatible','model':'local-mock','api_key':'fixture-only'}
        def start(base,name):
            return request(base,'/api/start',{'run_id':name,'ticker':'MOCK','date':'2026-10-13','models':{'quick':model,'deep':dict(model,id=2)}})
        def status(base,name): return request(base,'/api/run/status?run_id='+name+'&ticker=MOCK&date=2026-10-13')
        def await_status(base,name,expected):
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                value=status(base,name)
                if value['status']==expected: return value
                time.sleep(.02)
            raise AssertionError((name,expected,value))
        def sample(p,start_at):
            data=Path(f'/proc/{p.pid}/status').read_text()
            fields=dict(line.split(':',1) for line in data.splitlines() if ':' in line)
            stat=Path(f'/proc/{p.pid}/stat').read_text().split()
            samples.append({'elapsed_s':round(time.monotonic()-start_at,3),'pid':p.pid,
                'rss_kib':int(fields['VmRSS'].split()[0]),'threads':int(fields['Threads']),
                'fds':len(list(Path(f'/proc/{p.pid}/fd').iterdir())),
                'cpu_s':(int(stat[13])+int(stat[14]))/os.sysconf('SC_CLK_TCK')})
            assert samples[-1]['rss_kib'] < 256*1024
            assert samples[-1]['fds'] < 80 and samples[-1]['threads'] < 24
        begin=time.monotonic()
        p,log,base=boot(1)
        try:
            start(base,'fail-check'); await_status(base,'fail-check','failed')
            # Complete status and failure marker must survive an independent API process.
            start(base,'complete-check'); complete=await_status(base,'complete-check','complete')
            hung=start(base,'hang-check'); time.sleep(.1)
            sample(p,begin)
            t=time.monotonic();p.terminate();p.wait(timeout=6);shutdown=time.monotonic()-t;log.close()
            assert not Path(f'/proc/{hung["pid"]}').exists(), 'owned Mock child survived graceful shutdown'
            p,log,base=boot(2)
            assert status(base,'fail-check')['status']=='failed'
            assert status(base,'hang-check')['status']=='failed'
            assert status(base,'complete-check')['report_version']==complete['report_version']
            assert start(base,'complete-check')['status']=='complete'
            deadline=time.monotonic()+args.seconds
            while time.monotonic()<deadline:
                name=f'soak-{cycles}'; start(base,name); value=await_status(base,name,'complete')
                assert all('content' not in report for report in value['reports'])
                assert 'fixture-only' not in json.dumps(value)
                sample(p,begin); cycles+=1
                time.sleep(.1)
            result={'passed':True,'duration_s':time.monotonic()-begin,'soak_seconds':args.seconds,
                'cycles':cycles,'requests':len(latencies),'http_p50_ms':statistics.median(latencies),
                'http_p95_ms':sorted(latencies)[int(.95*(len(latencies)-1))],
                'shutdown_hanging_child_s':shutdown,'resources':samples,
                'limits':{'rss_mib':256,'fds':80,'threads':24,'request_timeout_s':3,'child_shutdown_timeout_s':6},
                'scope':'localhost Mock spawn only; real Handler/registry; no DB/provider; graceful restart, not crash adoption'}
            (dest/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='resources'},indent=2))
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
                    try: child.wait(timeout=6)
                    except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=3)
            log.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--before',action='store_true');parser.add_argument('--serve');parser.add_argument('--output');parser.add_argument('--seconds',type=float,default=60);args=parser.parse_args()
    if args.serve:
        from http.server import ThreadingHTTPServer
        original=ThreadingHTTPServer.__init__
        def init(self,*a,**k):
            original(self,*a,**k);Path(os.environ['STAGE4_PORT_FILE']).write_text(str(self.server_port))
        ThreadingHTTPServer.__init__=init
        serve(args.serve)
    else: run(args)
