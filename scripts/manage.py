"""Local process lifecycle for the StockDepth workspace."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'var/processes.json'
RUNTIME = Path(os.environ['STOCKDEPTH_RUNTIME_BIN'])
SERVICES = {
    'api': (ROOT / 'apps/api', [str(RUNTIME / 'python'), '-m', 'stockdepth.api.server']),
    'web': (ROOT / 'apps/web', [str(RUNTIME / 'pnpm'), 'start', '--hostname', '0.0.0.0']),
    'analysis': (ROOT / 'apps/workers', [str(RUNTIME / 'tsx'), 'src/analysis-worker.ts']),
    'market': (ROOT / 'apps/workers', [str(RUNTIME / 'tsx'), 'src/market-worker.ts']),
    'paper': (ROOT / 'apps/workers', [str(RUNTIME / 'tsx'), 'src/paper-trader-worker.ts']),
}


def live(record):
    try:
        pid = record['pid']
        fields = Path(f'/proc/{pid}/stat').read_text().split()
        return fields[2] != 'Z' and fields[21] == record['start']
    except (OSError, KeyError):
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'status', 'restart', 'build'])
    parser.add_argument('services', nargs='*')
    args = parser.parse_args()
    names = args.services or ['api', 'web', 'analysis', 'market']
    if any(name not in SERVICES for name in names):
        parser.error('services must be api, web, analysis, paper or market')
    ROOT.joinpath('var').mkdir(exist_ok=True)
    records = json.loads(STATE.read_text()) if STATE.exists() else {}
    env = os.environ.copy()
    env.update({key: value for key, value in dotenv_values(ROOT / '.env').items() if value is not None})
    env['DOTENV_CONFIG_PATH'] = str(ROOT / '.env')
    env['PATH'] = str(RUNTIME) + ':' + env.get('PATH', '')
    env['PYTHONPATH'] = str(ROOT / 'apps/api')
    env['PYTHONUNBUFFERED'] = '1'
    if args.action == 'build':
        raise SystemExit(subprocess.run([str(RUNTIME / 'pnpm'), 'build'], cwd=ROOT / 'apps/web', env=env).returncode)
    if args.action in ('start', 'restart') and 'web' in names:
        if not (ROOT / 'apps/web/.next/BUILD_ID').exists():
            raise SystemExit('请先运行 ./bin/stockdepth build，生成生产构建。')
    if args.action in ('start', 'restart'):
        result = subprocess.run(
            [str(RUNTIME / 'node'), str(ROOT / 'scripts/initialize-database.cjs')],
            cwd=ROOT, env=env,
        )
        if result.returncode:
            raise SystemExit('启动已停止：请修复数据库连接、权限或初始化错误。')
    for name in names:
        record = records.get(name, {})
        if args.action in ('stop', 'restart') and live(record):
            os.killpg(record['pid'], signal.SIGTERM)
            for _ in range(50):
                if not live(record):
                    break
                time.sleep(0.1)
            records.pop(name, None)
        if args.action in ('start', 'restart'):
            if live(records.get(name, {})):
                print(f'{name}: already running ({records[name]["pid"]})')
                continue
            cwd, command = SERVICES[name]
            with (ROOT / 'var' / f'{name}.log').open('ab') as log:
                process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            time.sleep(0.4)
            if process.poll() is not None:
                raise SystemExit(f'{name}: start failed; inspect var/{name}.log')
            records[name] = {'pid': process.pid, 'start': Path(f'/proc/{process.pid}/stat').read_text().split()[21]}
            STATE.write_text(json.dumps(records, indent=2))
            if name == 'api':
                for _ in range(50):
                    try:
                        urllib.request.urlopen('http://127.0.0.1:8008', timeout=1)
                        break
                    except urllib.error.HTTPError:
                        break  # Auth challenge proves the server is listening.
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise SystemExit('api: readiness failed; inspect var/api.log')
        record = records.get(name, {})
        print(f'{name}: {"running (" + str(record["pid"]) + ")" if live(record) else "stopped"}')
    STATE.write_text(json.dumps(records, indent=2))


if __name__ == '__main__':
    main()
