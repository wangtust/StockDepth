"""Two independent local Mock processes; only disposable SQLite and usage files."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path('apps/api/tests').resolve()))
from test_stage3_python import MockModel, mock_workflow, initial
from langgraph.checkpoint.sqlite import SqliteSaver
from stockdepth.api.usage import UsageRecorder, read_usage

if len(sys.argv)>2:
    mode,root,concurrency=sys.argv[1],Path(sys.argv[2]),int(sys.argv[3])
    model=MockModel();recorder=UsageRecorder(root/'usage.json')
    if mode=='fail': model._fail.add('news')
    workflow=mock_workflow(concurrency,model)
    config={'configurable':{'thread_id':'stage3-disposable'},'callbacks':[recorder]}
    with SqliteSaver.from_conn_string(str(root/'checkpoint.sqlite')) as saver:
        graph=workflow.compile(checkpointer=saver)
        if mode=='fail':
            try: graph.invoke(initial(),config)
            except RuntimeError as error: assert str(error)=='local mock interruption'
            else: raise AssertionError('Mock interruption did not happen')
            output={'calls':dict(model._calls),'pid':os.getpid()}
        else:
            result=graph.invoke(None,config)
            assert result['final_trade_decision']=='market: deterministic report|news: deterministic report|social: deterministic report|fundamentals: deterministic report'
            assert model._calls['market']==0 and model._calls['news']==1
            calls=read_usage(root/'usage.json')['calls']
            assert len(calls)==9 and sum(c['status']=='failed' for c in calls)==1
            assert sum(c['total_tokens'] or 0 for c in calls)==120
            output={'calls':dict(model._calls),'pid':os.getpid(),'successful_mock_tokens':120,'recorded_calls':len(calls),'failed_calls':1,'report_consistent':True}
    (root/(mode+'.json')).write_text(json.dumps(output))
else:
    results=[]
    for concurrency in [1,2]:
        with tempfile.TemporaryDirectory(prefix='stage3-recovery-') as directory:
            for mode in ['fail','resume']:
                subprocess.run([sys.executable,__file__,mode,directory,str(concurrency)],check=True)
            fail=json.loads((Path(directory)/'fail.json').read_text());resume=json.loads((Path(directory)/'resume.json').read_text())
            assert fail['pid']!=resume['pid']
            results.append({'concurrency':concurrency,'first_process':fail,'second_process':resume})
    Path(sys.argv[1]).write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
