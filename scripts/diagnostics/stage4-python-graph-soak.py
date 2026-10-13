"""Bounded disposable SQLite graph regression with stage3 local Mock nodes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import sys
import tempfile
import time
sys.path.insert(0, str(Path('apps/api/tests').resolve()))
from test_stage3_python import MockModel, mock_workflow, initial
from langgraph.checkpoint.sqlite import SqliteSaver
from stockdepth.api.usage import UsageRecorder, read_usage

parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--seconds',type=float,default=15);args=parser.parse_args()
assert 0 < args.seconds <= 60
results=[]
for concurrency in [1,2]:
    with tempfile.TemporaryDirectory(prefix='stage4-graph-') as directory:
        root=Path(directory);model=MockModel(); workflow=mock_workflow(concurrency,model)
        recorder=UsageRecorder(root/'usage.json'); samples=[]; cycles=0; digest=None
        with SqliteSaver.from_conn_string(str(root/'checkpoint.sqlite')) as saver:
            graph=workflow.compile(checkpointer=saver); begin=time.monotonic();cpu=time.process_time()
            while time.monotonic()-begin < args.seconds:
                value=graph.invoke(initial(),{'configurable':{'thread_id':f'isolated-{cycles}'},'callbacks':[recorder]})
                current=hashlib.sha256(value['final_trade_decision'].encode()).hexdigest()
                if digest is None: digest=current
                assert current == digest
                cycles+=1
                fields=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
                samples.append({'elapsed_s':time.monotonic()-begin,'cpu_s':time.process_time()-cpu,
                    'rss_kib':int(fields['VmRSS'].split()[0]),'fds':len(list(Path('/proc/self/fd').iterdir())),
                    'checkpoint_bytes':sum(p.stat().st_size for p in root.glob('checkpoint.sqlite*'))})
                assert samples[-1]['rss_kib'] < 300*1024 and samples[-1]['fds'] < 80
        usage=read_usage(root/'usage.json');calls=usage['calls']
        assert len(calls)==cycles*8
        assert sum(c['total_tokens'] or 0 for c in calls)==cycles*120
        results.append({'concurrency':concurrency,'cycles':cycles,'mock_calls':len(calls),
            'mock_tokens':cycles*120,'decision_sha256':digest,'samples':samples,
            'duration_s':time.monotonic()-begin,'rss_limit_mib':300})
Path(args.output).write_text(json.dumps({'passed':True,'results':results,'scope':'local Mock graph; temporary SQLite and usage only; no runner CLI or real model'},indent=2))
print(json.dumps([{k:v for k,v in r.items() if k!='samples'} for r in results],indent=2))
