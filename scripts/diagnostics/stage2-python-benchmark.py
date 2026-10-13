"""Isolated persistence benchmark; no providers, project DB or services."""
import json
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch
from langchain_core.messages import AIMessage
from stockdepth.api import analysis_runner as runner

if '--before' in sys.argv:
    import importlib.util
    source = Path('var/codex-performance-team/stage2-python-before/apps/api/stockdepth/api/analysis_runner.py')
    spec = importlib.util.spec_from_file_location('stage2_before_runner', source)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)

results=[]
for trial in range(3):
    counters={'replaces':0,'bytes_written':0,'json_dumps':0}
    original_replace=Path.replace; original_write=Path.write_text; original_dumps=json.dumps
    def replace(self,*args,**kwargs):
        counters['replaces']+=1
        counters['bytes_written']+=self.stat().st_size
        return original_replace(self,*args,**kwargs)
    def write(self,data,*args,**kwargs):
        return original_write(self,data,*args,**kwargs)
    def dumps(*args,**kwargs):
        counters['json_dumps']+=1
        return original_dumps(*args,**kwargs)
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory); reports=root/'reports'
        persistence=runner.ReportPersistence() if hasattr(runner,'ReportPersistence') else None
        options={'persistence':persistence} if persistence else {}
        state={'market_report':'报告'*50000,'messages':[AIMessage(content='public mock reply',id='reply')]}
        start=time.perf_counter()
        with patch.object(Path,'replace',replace),patch.object(Path,'write_text',write),patch.object(json,'dumps',dumps):
            for event in range(100):
                runner.save_progress(state,reports,**options)
                runner.save_report_parts(state,reports,**options)
                if persistence:
                    persistence.save_complete(state,reports/'complete_report.md','MOCK',runner.build_complete_report)
                else:
                    runner.write_text(reports/'complete_report.md',runner.build_complete_report(state,'MOCK'))
                runner.save_state_json(state,root/'latest_state.json',**options)
        counters['elapsed_ms']=(time.perf_counter()-start)*1000
    results.append(counters)
Path(sys.argv[1]).write_text(original_dumps({'scenario':'100 repeated graph events, 300KB report, local mock message, 3 trials','trials':results},indent=2))
print(original_dumps(results,indent=2))
