from __future__ import annotations

import base64
import hmac
import json
import os
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv

from stockdepth.data.utils import safe_ticker_component
from stockdepth.providers.api_key_env import get_api_key_env
from stockdepth.providers.model_catalog import MODEL_OPTIONS


ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = Path(__file__).resolve().parent
LOGS_DIR = Path.home() / ".stockdepth" / "logs"
DEFAULT_DATE = time.strftime("%Y-%m-%d")

JOBS: dict[str, subprocess.Popen] = {}

load_dotenv(ROOT.parents[1] / ".env", override=False)
WEB_USERNAME = os.environ.get("STOCKDEPTH_WEB_USERNAME", "admin")
WEB_PASSWORD = os.environ.get("STOCKDEPTH_WEB_PASSWORD", "")


REPORT_ORDER = [
    ("progress", "分析过程", ["progress.md"]),
    ("market", "Market Analyst", ["market_report.md", "1_analysts/market.md"]),
    ("sentiment", "Sentiment Analyst", ["sentiment_report.md", "1_analysts/sentiment.md"]),
    ("news", "News Analyst", ["news_report.md", "1_analysts/news.md"]),
    ("fundamentals", "Fundamentals Analyst", ["fundamentals_report.md", "1_analysts/fundamentals.md"]),
    ("bull", "Bull Researcher", ["2_research/bull.md"]),
    ("bear", "Bear Researcher", ["2_research/bear.md"]),
    ("research", "Research Manager", ["investment_plan.md", "2_research/manager.md"]),
    ("trader", "Trader", ["trader_investment_plan.md", "3_trading/trader.md"]),
    ("aggressive", "Aggressive Risk", ["4_risk/aggressive.md"]),
    ("conservative", "Conservative Risk", ["4_risk/conservative.md"]),
    ("neutral", "Neutral Risk", ["4_risk/neutral.md"]),
    ("decision", "Portfolio Decision", ["final_trade_decision.md", "5_portfolio/decision.md"]),
    ("complete", "Complete Report", ["complete_report.md"]),
]

LANGUAGE_OPTIONS = [
    ("English (default)", "English"),
    ("Chinese (中文)", "Chinese"),
    ("Japanese (日本語)", "Japanese"),
    ("Korean (한국어)", "Korean"),
    ("Hindi (हिन्दी)", "Hindi"),
    ("Spanish (Español)", "Spanish"),
    ("Portuguese (Português)", "Portuguese"),
    ("French (Français)", "French"),
    ("German (Deutsch)", "German"),
    ("Arabic (العربية)", "Arabic"),
    ("Russian (Русский)", "Russian"),
]

DEPTH_OPTIONS = [
    ("Shallow - Quick research, few debate and strategy discussion rounds", 1),
    ("Medium - Middle ground, moderate debate rounds and strategy discussion", 3),
    ("Deep - Comprehensive research, in depth debate and strategy discussion", 5),
]

ANALYST_OPTIONS = [
    ("Market Analyst", "market"),
    ("Sentiment Analyst", "social"),
    ("News Analyst", "news"),
    ("Fundamentals Analyst", "fundamentals"),
]

PROVIDER_OPTIONS = [
    ("Qwen · DashScope Singapore", "qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
    ("Mimo · OpenAI-compatible", "openai-compatible", "https://token-plan-sgp.xiaomimimo.com/v1"),
    ("Qwen · DashScope US", "qwen-us", "https://dashscope-us.aliyuncs.com/compatible-mode/v1"),
    ("Qwen · DashScope China", "qwen-cn", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    ("OpenAI", "openai", "https://api.openai.com/v1"),
    ("Google", "google", ""),
    ("Anthropic", "anthropic", "https://api.anthropic.com/"),
    ("xAI", "xai", "https://api.x.ai/v1"),
    ("DeepSeek", "deepseek", "https://api.deepseek.com"),
    ("GLM · Z.AI", "glm", "https://api.z.ai/api/paas/v4/"),
    ("GLM · BigModel China", "glm-cn", "https://open.bigmodel.cn/api/paas/v4/"),
    ("MiniMax · Global", "minimax", "https://api.minimax.io/v1"),
    ("MiniMax · China", "minimax-cn", "https://api.minimaxi.com/v1"),
    ("OpenRouter", "openrouter", "https://openrouter.ai/api/v1"),
    ("Azure OpenAI", "azure", ""),
    ("Ollama", "ollama", os.environ.get("OLLAMA_BASE_URL") or "http://localhost:11434/v1"),
]


def model_options(provider: str, mode: str) -> list[dict]:
    if provider == "openrouter":
        return [{"label": "Custom model ID", "value": ""}]
    if provider == "azure":
        return [{"label": "Azure deployment name", "value": ""}]
    options = MODEL_OPTIONS.get(provider, {}).get(mode, [])
    return [{"label": label, "value": "" if value == "custom" else value} for label, value in options]


def web_options() -> dict:
    return {
        "languages": [{"label": label, "value": value} for label, value in LANGUAGE_OPTIONS],
        "depths": [{"label": label, "value": value} for label, value in DEPTH_OPTIONS],
        "analysts": [{"label": label, "value": value} for label, value in ANALYST_OPTIONS],
        "providers": [
            {
                "label": label,
                "value": value,
                "base_url": base_url,
                "quick_models": model_options(value, "quick"),
                "deep_models": model_options(value, "deep"),
            }
            for label, value, base_url in PROVIDER_OPTIONS
        ],
    }


def json_response(handler: SimpleHTTPRequestHandler, payload: object, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler: SimpleHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def unauthorized(handler: SimpleHTTPRequestHandler) -> None:
    body = b"Authentication required\n"
    handler.send_response(401)
    handler.send_header("WWW-Authenticate", 'Basic realm="StockDepth"')
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def authenticated(handler: SimpleHTTPRequestHandler) -> bool:
    if not WEB_PASSWORD:
        return True
    header = handler.headers.get("Authorization", "")
    if not header.startswith("Basic "):
        return False
    try:
        decoded = base64.b64decode(header.removeprefix("Basic "), validate=True).decode("utf-8")
        username, password = decoded.split(":", 1)
    except Exception:
        return False
    return hmac.compare_digest(username, WEB_USERNAME) and hmac.compare_digest(password, WEB_PASSWORD)


def safe_run_id_component(value: str) -> str:
    return safe_ticker_component(value, max_len=120)


def job_key(ticker: str, date: str, run_id: str | None = None) -> str:
    return run_id or f"{ticker}:{date}"


def safe_run_dir(ticker: str, date: str, run_id: str | None = None) -> Path:
    if run_id:
        base = (LOGS_DIR / "runs" / safe_run_id_component(run_id)).resolve()
    else:
        base = (LOGS_DIR / ticker / date).resolve()
    logs = LOGS_DIR.resolve()
    if logs not in base.parents and base != logs:
        raise ValueError("Invalid run path")
    return base


def file_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except FileNotFoundError:
        return 0


def report_dir_for(run_dir: Path) -> Path:
    return run_dir / "reports"


def read_report_files(run_dir: Path) -> list[dict]:
    reports = []
    report_dir = report_dir_for(run_dir)
    for key, title, candidates in REPORT_ORDER:
        for rel in candidates:
            path = report_dir / rel
            if path.exists():
                reports.append(
                    {
                        "key": key,
                        "title": title,
                        "path": str(path),
                        "relative_path": str(path.relative_to(report_dir)),
                        "mtime": path.stat().st_mtime,
                        "size": path.stat().st_size,
                        "content": path.read_text(encoding="utf-8", errors="replace"),
                    }
                )
                break
    return reports


def run_status(run_dir: Path, ticker: str, date: str, run_id: str | None = None) -> str:
    job = JOBS.get(job_key(ticker, date, run_id))
    if job and job.poll() is None:
        return "running"
    runner_log = tail_file(run_dir / "web_runner.log", max_bytes=20000)
    failure_markers = (
        "Traceback (most recent call last)",
        "Error code: 402",
        "Error code: 429",
        "RateLimitError",
        "insufficient_balance",
        "Too many requests",
    )
    if any(marker in runner_log for marker in failure_markers):
        return "failed"
    reports = report_dir_for(run_dir)
    if (reports / "final_trade_decision.md").exists() or (reports / "5_portfolio" / "decision.md").exists():
        return "complete"
    if reports.exists() and any(reports.rglob("*.md")):
        return "partial"
    return "empty"


def list_runs() -> list[dict]:
    runs = []
    if not LOGS_DIR.exists():
        return runs
    for ticker_dir in LOGS_DIR.iterdir():
        if ticker_dir.name == "runs":
            continue
        if not ticker_dir.is_dir():
            continue
        for date_dir in ticker_dir.iterdir():
            if not date_dir.is_dir() or not (date_dir / "reports").exists():
                continue
            report_files = list((date_dir / "reports").rglob("*.md"))
            latest = max([file_mtime(p) for p in report_files] + [file_mtime(date_dir / "latest_state.json")])
            runs.append(
                {
                    "ticker": ticker_dir.name,
                    "date": date_dir.name,
                    "updated_at": latest,
                    "status": run_status(date_dir, ticker_dir.name, date_dir.name),
                    "report_count": len(report_files),
                }
            )
    return sorted(runs, key=lambda item: item["updated_at"], reverse=True)


def tail_file(path: Path, max_bytes: int = 16000) -> str:
    if not path.exists():
        return ""
    size = path.stat().st_size
    with path.open("rb") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
        return f.read().decode("utf-8", errors="replace")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), format % args))

    def do_GET(self) -> None:
        if not authenticated(self):
            unauthorized(self)
            return

        parsed = urlparse(self.path)
        if parsed.path == "/api/options":
            json_response(self, web_options())
            return

        if parsed.path == "/api/runs":
            json_response(self, {"runs": list_runs()})
            return

        if parsed.path == "/api/run":
            query = parse_qs(parsed.query)
            run_id = (query.get("run_id") or [""])[0].strip()
            ticker = (query.get("ticker") or [""])[0]
            date = (query.get("date") or [""])[0]
            if not run_id and (not ticker or not date):
                json_response(self, {"error": "run_id or ticker and date are required"}, 400)
                return
            try:
                run_id = safe_run_id_component(run_id) if run_id else ""
                run_dir = safe_run_dir(ticker, date, run_id or None)
            except ValueError as exc:
                json_response(self, {"error": str(exc)}, 400)
                return
            reports = read_report_files(run_dir)
            json_response(
                self,
                {
                    "ticker": ticker,
                    "date": date,
                    "run_id": run_id or None,
                    "status": run_status(run_dir, ticker, date, run_id or None),
                    "updated_at": max([r["mtime"] for r in reports] + [0]),
                    "reports": reports,
                    "message_log": tail_file(run_dir / "message_tool.log"),
                    "runner_log": tail_file(run_dir / "web_runner.log"),
                },
            )
            return

        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        if not authenticated(self):
            unauthorized(self)
            return

        parsed = urlparse(self.path)
        if parsed.path != "/api/start":
            json_response(self, {"error": "Not found"}, 404)
            return

        try:
            payload = read_json_body(self)
            run_id = str(payload.get("run_id") or "").strip()
            ticker = str(payload.get("ticker") or "").strip().upper()
            date = str(payload.get("date") or DEFAULT_DATE).strip()
            language = str(payload.get("language") or "Chinese")
            depth = int(payload.get("depth") or 1)
            realtime_data = bool(payload.get("realtime_data"))
            provider = str(payload.get("provider") or "").strip()
            base_url = str(payload.get("base_url") or "").strip()
            quick_model = str(payload.get("quick_model") or "").strip()
            deep_model = str(payload.get("deep_model") or "").strip()
            api_key = str(payload.get("api_key") or "").strip()
            if not provider or not quick_model or not deep_model:
                raise ValueError("分析需要数据库中的 Provider、Quick Model 和 Deep Model 配置")
            if get_api_key_env(provider) and not api_key:
                raise ValueError("所选数据库模型缺少 API Key")
            analysts = payload.get("analysts") or ["market", "news", "fundamentals"]
            if not ticker:
                raise ValueError("ticker is required")
            if depth not in (1, 3, 5):
                raise ValueError("depth must be 1, 3, or 5")
            if not isinstance(analysts, list) or not analysts:
                raise ValueError("analysts must be a non-empty list")
            if run_id:
                run_id = safe_run_id_component(run_id)

            key = job_key(ticker, date, run_id or None)
            existing = JOBS.get(key)
            if existing and existing.poll() is None:
                json_response(
                    self,
                    {
                        "ticker": ticker,
                        "date": date,
                        "run_id": run_id or None,
                        "status": "already-running",
                    },
                )
                return

            run_dir = safe_run_dir(ticker, date, run_id or None)
            run_dir.mkdir(parents=True, exist_ok=True)
            log_file = run_dir / "web_runner.log"
            cmd = [
                sys.executable,
                str(WEB_DIR / "analysis_runner.py"),
                "--ticker",
                ticker,
                "--date",
                date,
                "--language",
                language,
                "--depth",
                str(depth),
                "--analysts",
                ",".join(str(a) for a in analysts),
                "--checkpoint",
            ]
            if provider:
                cmd.extend(["--provider", provider])
            if base_url:
                cmd.extend(["--base-url", base_url])
            if quick_model:
                cmd.extend(["--quick-model", quick_model])
            if deep_model:
                cmd.extend(["--deep-model", deep_model])
            if run_id:
                cmd.extend(["--run-id", run_id])
            if realtime_data:
                cmd.append("--realtime-data")
            env = os.environ.copy()
            env.setdefault("PYTHONUNBUFFERED", "1")
            api_key_env = get_api_key_env(provider) if provider else None
            if api_key and api_key_env:
                env[api_key_env] = api_key
            with log_file.open("wb") as out:
                process = subprocess.Popen(cmd, cwd=str(ROOT), stdout=out, stderr=subprocess.STDOUT, env=env)
            JOBS[key] = process
            json_response(
                self,
                {
                    "ticker": ticker,
                        "date": date,
                        "run_id": run_id or None,
                        "realtime_data": realtime_data,
                        "status": "started",
                    "pid": process.pid,
                },
            )
        except Exception as exc:
            json_response(self, {"error": str(exc)}, 400)


def main() -> None:
    host = os.environ.get("STOCKDEPTH_WEB_HOST", "0.0.0.0")
    port = int(os.environ.get("STOCKDEPTH_WEB_PORT", "8008"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"StockDepth web viewer running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
