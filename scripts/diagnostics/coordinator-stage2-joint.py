"""Actual Python Handler + actual TS RunPoller; temporary fixtures, loopback only."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from stockdepth.api import server
from stockdepth.api.report_persistence import ReportPersistence


def main():
    root = Path(__file__).resolve().parents[2]
    counts = {"status": 0, "body": 0}

    class Handler(server.Handler):
        def do_GET(self):
            counts["status" if self.path.startswith("/api/run/status?") else "body"] += 1
            super().do_GET()

    with tempfile.TemporaryDirectory(prefix="stockdepth-coordinator-stage2-") as directory:
        directory = Path(directory)
        run = directory / "runs" / "joint-mock"
        persistence = ReportPersistence()
        persistence.write(run / "reports/market_report.md", "a" * 100000)
        usage = {"calls": [{"call_id": "fixture", "role": "quick", "model_config_id": 7,
                            "provider": "mock", "input_tokens": 10, "output_tokens": 2,
                            "total_tokens": 12, "estimated_cost": "0.000026000000",
                            "pricing_snapshot": {"input": "2.000000000000"}}],
                 "history_complete": False}
        persistence.write(run / "usage.json", json.dumps(usage))
        ts = directory / "joint.ts"
        ts.write_text(r'''
import assert from 'node:assert/strict';
import {writeFile, rename} from 'node:fs/promises';
import {RunPoller} from 'POLLING_MODULE';
async function main() {
 const [base, path, auth] = process.argv.slice(2);
 const url = base + '/api/run?run_id=joint-mock';
 const headers = {Authorization: auth};
 const poller = new RunPoller<any>(url, headers);
 const atomic = async (file:string, text:string) => { await writeFile(path+'/'+file+'.tmp',text); await rename(path+'/'+file+'.tmp',path+'/'+file); };
 const first = await poller.poll(); assert(first.reportsConsistent);
 assert.equal(first.reports![0].content, 'a'.repeat(100000));
 const unchanged = await poller.poll(); assert.equal(unchanged.report_version, first.report_version);
 const usage = first.usage; usage.history_complete = true;
 await atomic('usage.json', JSON.stringify(usage));
 const fresh = await poller.poll(); assert(fresh.usage.history_complete);
 assert.equal(fresh.report_version, first.report_version);
 assert.equal(fresh.usage.calls[0].estimated_cost, '0.000026000000');
 assert.deepEqual(fresh.usage.calls[0].pricing_snapshot, {input:'2.000000000000'});
 assert.equal(fresh.usage.calls[0].provider, 'mock'); assert.equal(fresh.usage.calls[0].role, 'quick');
 assert.equal(fresh.usage.calls[0].model_config_id, 7); assert.equal(fresh.usage.calls[0].total_tokens, 12);
 await atomic('reports/market_report.md', 'b'.repeat(100000));
 const changed = await poller.poll(); assert(changed.reportsConsistent);
 assert.notEqual(changed.report_version, first.report_version); assert.equal(changed.reports![0].content,'b'.repeat(100000));
 const restored = await new RunPoller(url,headers).poll(); assert.equal(restored.reports![0].content,changed.reports![0].content);
 await atomic('reports/final_trade_decision.md', 'Mock HOLD');
 const complete = await poller.poll(); assert.equal(complete.status,'complete'); assert(complete.reportsConsistent);
 await atomic('web_runner.log', 'Analysis failed: isolated fixture');
 const failed = await poller.poll(); assert.equal(failed.status,'failed'); assert.match(failed.runner_log!,/isolated fixture/);
 assert.equal(failed.report_version,complete.report_version);
 const light = await (await fetch(base+'/api/run/status?run_id=joint-mock',{headers})).json();
 assert(light.reports.every((r:any)=>!('content' in r)&&!('path' in r)));
 assert.equal((await fetch(base+'/api/run/status?run_id=joint-mock')).status,401);
 assert.equal((await fetch(base+'/api/run/status?run_id=..%2Foutside',{headers})).status,400);
 console.log('Actual Handler/RunPoller: unchanged, usage-only, Decimal/identity, same-size change, recovery, complete, failed-without-version-change, metadata, auth/path passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''.replace("POLLING_MODULE", str(root / "apps/workers/src/analysis-polling.ts")))
        with patch.object(server, "LOGS_DIR", directory), patch.object(server, "WEB_USERNAME", "mock-user"), patch.object(server, "WEB_PASSWORD", "mock-only"):
            http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            try:
                auth = "Basic " + base64.b64encode(b"mock-user:mock-only").decode()
                env = {k: v for k, v in os.environ.items() if not any(s in k.upper() for s in ("KEY", "TOKEN", "PASSWORD", "POSTGRES", "DATABASE", "MODEL_CONFIG"))}
                subprocess.run([str(root / "apps/workers/node_modules/.bin/tsx"), str(ts),
                                f"http://127.0.0.1:{http.server_port}", str(run), auth],
                               env=env, check=True, timeout=30)
                assert counts == {"status": 10, "body": 4}, counts
                print(json.dumps({"requests": counts, "database": "none", "model_requests": 0}))
            finally:
                http.shutdown()
                http.server_close()
                thread.join(timeout=3)


if __name__ == "__main__":
    main()
