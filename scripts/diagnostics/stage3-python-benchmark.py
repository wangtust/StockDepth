"""Only local Mock, temporary SQLite/files. Never instantiate real providers."""
import argparse
import hashlib
import json
import resource
import sys
import tempfile
import time
import tracemalloc
from importlib.metadata import version
from pathlib import Path
sys.path.insert(0,str(Path('apps/api/tests').resolve()))
from test_stage3_python import MockModel, mock_workflow, initial
from stockdepth.api.usage import UsageRecorder, read_usage
parser=argparse.ArgumentParser();parser.add_argument('--concurrency',type=int,required=True);parser.add_argument('--output',required=True);parser.add_argument('--before',action='store_true');args=parser.parse_args()
if args.before:
    import importlib.util
    import test_stage3_python as mock
    source=Path('var/codex-performance-team/stage3-python-before/apps/api/stockdepth/workflows/setup.py')
    spec=importlib.util.spec_from_file_location('stockdepth.workflows.stage3_before_setup',source)
    before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before);mock.setup=before
rows=[]
for trial in range(5):
    with tempfile.TemporaryDirectory(prefix='stage3-python-') as directory:
        model=MockModel();recorder=UsageRecorder(Path(directory)/'usage.json')
        graph=mock_workflow(args.concurrency,model).compile()
        tracemalloc.start();cpu=time.process_time();wall=time.perf_counter()
        result=graph.invoke(initial(),{'callbacks':[recorder]})
        wall=time.perf_counter()-wall;cpu=time.process_time()-cpu
        _,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
        calls=read_usage(Path(directory)/'usage.json')['calls']
        reports={k:v for k,v in result.items() if k.endswith('_report') or k=='final_trade_decision'}
        rows.append({'trial':trial,'wall_ms':wall*1000,'cpu_ms':cpu*1000,'python_peak_bytes':peak,'process_high_water_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'mock_peak_calls':model._peak,'calls':len(calls),'mock_tokens':sum(c['total_tokens'] for c in calls),'result_sha256':hashlib.sha256(json.dumps(reports,sort_keys=True).encode()).hexdigest()})
output={'before_archive':args.before,'concurrency_setting':args.concurrency,'sdk':{name:version(name) for name in ['langgraph','langgraph-checkpoint-sqlite','langchain-core']},'scope':'local deterministic 25ms Mock model delay; no true model tokens/cost or production benefit evidence; RSS is cumulative process high water','trials':rows}
Path(args.output).write_text(json.dumps(output,indent=2));print(json.dumps(output,indent=2))
