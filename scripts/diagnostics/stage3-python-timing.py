"""Local Mock timing spans, including archived pre-stage graph setup."""
import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path('apps/api/tests').resolve()))
import test_stage3_python as mock
from stockdepth.api.timing import TimingRecorder
parser=argparse.ArgumentParser();parser.add_argument('--before',action='store_true');parser.add_argument('--concurrency',required=True,type=int);parser.add_argument('--directory',required=True);args=parser.parse_args()
if args.before:
    source=Path('var/codex-performance-team/stage3-python-before/apps/api/stockdepth/workflows/setup.py')
    spec=importlib.util.spec_from_file_location('stockdepth.workflows.stage3_before_setup',source)
    before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before);mock.setup=before
recorder=TimingRecorder(Path(args.directory),job_id='local-mock-only')
model=mock.MockModel();graph=mock.mock_workflow(args.concurrency,model).compile()
start=time.perf_counter();result=graph.invoke(mock.initial(),{'callbacks':[recorder]});elapsed=(time.perf_counter()-start)*1000;recorder.close()
summary=json.loads((Path(args.directory)/'timing-summary.json').read_text())
models=[g for g in summary['groups'] if g['kind']=='model'];assert sum(g['count'] for g in models)==8
print(json.dumps({'before':args.before,'configured_concurrency':args.concurrency,'actual_peak':model._peak,'wall_ms':elapsed,'model_spans':models,'note':'Nested wrapper spans overlap inner nodes; do not add all Agent spans as wall time. Mock timing only.'},indent=2))
