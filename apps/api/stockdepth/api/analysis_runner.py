from __future__ import annotations

import argparse
import datetime as dt
import json
import hashlib
import logging
import os
import atexit
import time
from pathlib import Path

from dotenv import load_dotenv

from stockdepth.api.report_persistence import ReportPersistence, signature
from stockdepth.api.usage import UsageRecorder
from stockdepth.api.execution_metrics import save_execution_metrics
from stockdepth.api.timing import TimingRecorder, CURRENT_TIMING
from stockdepth.data.utils import safe_ticker_component
from stockdepth.default_config import DEFAULT_CONFIG
from stockdepth.workflows.checkpointer import clear_checkpoint, checkpoint_step, get_checkpointer, thread_id
from stockdepth.workflows.trading_graph import StockDepthGraph
from stockdepth.workflows.execution_config import execution_config


REPORT_MAP = {
    "market_report": ("market_report.md", "Market Analyst"),
    "sentiment_report": ("sentiment_report.md", "Sentiment Analyst"),
    "news_report": ("news_report.md", "News Analyst"),
    "fundamentals_report": ("fundamentals_report.md", "Fundamentals Analyst"),
    "investment_plan": ("investment_plan.md", "Research Manager"),
    "trader_investment_plan": ("trader_investment_plan.md", "Trader"),
    "final_trade_decision": ("final_trade_decision.md", "Portfolio Manager"),
}


def write_text(path: Path, content: str, persistence: ReportPersistence | None = None) -> None:
    (persistence or ReportPersistence()).write(path, content)


def save_report_parts(state: dict, report_dir: Path, persistence: ReportPersistence | None = None) -> None:
    for key, (filename, _) in REPORT_MAP.items():
        content = state.get(key)
        if content:
            write_text(report_dir / filename, content, persistence)

    debate = state.get("investment_debate_state") or {}
    if debate.get("bull_history"):
        write_text(report_dir / "bull_history.md", debate["bull_history"], persistence)
    if debate.get("bear_history"):
        write_text(report_dir / "bear_history.md", debate["bear_history"], persistence)
    if debate.get("judge_decision") and not state.get("investment_plan"):
        write_text(report_dir / "investment_plan.md", debate["judge_decision"], persistence)

    risk = state.get("risk_debate_state") or {}
    if risk.get("aggressive_history"):
        write_text(report_dir / "aggressive_history.md", risk["aggressive_history"], persistence)
    if risk.get("conservative_history"):
        write_text(report_dir / "conservative_history.md", risk["conservative_history"], persistence)
    if risk.get("neutral_history"):
        write_text(report_dir / "neutral_history.md", risk["neutral_history"], persistence)
    if risk.get("judge_decision") and not state.get("final_trade_decision"):
        write_text(report_dir / "final_trade_decision.md", risk["judge_decision"], persistence)


def save_progress(state: dict, report_dir: Path, persistence: ReportPersistence | None = None) -> None:
    """Persist public replies and tool results, excluding model reasoning."""
    history_path = report_dir / "progress.json"
    cached = persistence.histories.get(history_path) if persistence else None
    history = dict(cached[1]) if cached and cached[0] == signature(history_path) else (json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {})
    changed = not cached or cached[0] != signature(history_path)
    for message in state.get("messages", []):
        kind = getattr(message, "type", "")
        if kind not in ("ai", "tool"):
            continue
        content = getattr(message, "content", "")
        if isinstance(content, list):
            content = "\n".join(
                block if isinstance(block, str) else block.get("text", "")
                for block in content
                if isinstance(block, str) or isinstance(block, dict) and block.get("type") == "text"
            )
        calls = getattr(message, "tool_calls", [])
        if not content and not calls:
            continue
        title = "模型回复" if kind == "ai" else f"工具结果：{getattr(message, 'name', '') or '数据查询'}"
        body = []
        if content:
            body.append(str(content))
        for call in calls:
            body.append(f"调用工具：{call.get('name', '')}\n\n```json\n{json.dumps(call.get('args', {}), ensure_ascii=False)}\n```")
        public_identity = (getattr(message, 'response_metadata', {}) or {}).get('stockdepth_interaction')
        if kind == 'ai' and isinstance(public_identity, dict):
            safe_identity = {key: public_identity[key] for key in ('agent', 'model')
                             if isinstance(public_identity.get(key), str)}
            if safe_identity:
                body.insert(0, '<!-- stockdepth-interaction ' + json.dumps(safe_identity, ensure_ascii=True).replace('--', r'\u002d\u002d') + ' -->')
        entry = {"title": title, "body": "\n\n".join(body)}
        identity = getattr(message, "id", None) or hashlib.sha256(json.dumps(entry, ensure_ascii=False).encode()).hexdigest()
        if history.get(identity) != entry:
            history[identity] = entry
            changed = True
    if not changed and (report_dir / "progress.md").exists():
        return
    # Keep earlier stages when the graph clears messages between analysts.
    sections = ["# 分析过程"]
    for index, entry in enumerate(history.values(), 1):
        sections.append(f"## {index}. {entry['title']}\n\n{entry['body']}")
    write_text(history_path, json.dumps(history, ensure_ascii=False), persistence)
    write_text(report_dir / "progress.md", "\n\n".join(sections) + "\n", persistence)
    if persistence:
        persistence.histories[history_path] = (signature(history_path), history)


def build_complete_report(state: dict, ticker: str) -> str:
    sections = [
        f"# Trading Analysis Report: {ticker}",
        f"Generated: {dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
    ]

    if state.get("decision_rating"):
        sections.append("Validated rating: " + state["decision_rating"])
    if state.get("research_status"):
        sections.append("Research completeness: " + ", ".join(f"{k}: {v}" for k, v in state["research_status"].items()))

    if state.get("market_evidence"):
        sections.append("## Market Evidence\n\n" + state["market_evidence"])
    if state.get("memory_note"):
        sections.append("Memory note: " + state["memory_note"])
    if state.get("portfolio_context"):
        sections.append(state["portfolio_context"])

    analyst_parts = []
    for key in ("market_report", "sentiment_report", "news_report", "fundamentals_report"):
        title = REPORT_MAP[key][1]
        if state.get(key):
            analyst_parts.append(f"### {title}\n\n{state[key]}")
    if analyst_parts:
        sections.append("## I. Analyst Team Reports\n\n" + "\n\n".join(analyst_parts))

    debate = state.get("investment_debate_state") or {}
    research_parts = []
    if debate.get("bull_history"):
        research_parts.append(f"### Bull Researcher\n\n{debate['bull_history']}")
    if debate.get("bear_history"):
        research_parts.append(f"### Bear Researcher\n\n{debate['bear_history']}")
    manager = state.get("investment_plan") or debate.get("judge_decision")
    if manager:
        research_parts.append(f"### Research Manager\n\n{manager}")
    if research_parts:
        sections.append("## II. Research Team Decision\n\n" + "\n\n".join(research_parts))

    if state.get("trader_investment_plan"):
        sections.append("## III. Trading Team Plan\n\n### Trader\n\n" + state["trader_investment_plan"])

    risk = state.get("risk_debate_state") or {}
    risk_parts = []
    if risk.get("aggressive_history"):
        risk_parts.append(f"### Aggressive Analyst\n\n{risk['aggressive_history']}")
    if risk.get("conservative_history"):
        risk_parts.append(f"### Conservative Analyst\n\n{risk['conservative_history']}")
    if risk.get("neutral_history"):
        risk_parts.append(f"### Neutral Analyst\n\n{risk['neutral_history']}")
    if risk_parts:
        sections.append("## IV. Risk Management Team Decision\n\n" + "\n\n".join(risk_parts))

    decision = state.get("final_trade_decision") or risk.get("judge_decision")
    if decision:
        sections.append("## V. Portfolio Manager Decision\n\n### Portfolio Manager\n\n" + decision)

    return "\n\n".join(sections) + "\n"


def publishable_state(state: dict, workflow_version: int) -> dict:
    """Do not publish a tradable PM report before v2 validation completes."""
    if workflow_version < 2 or state.get("decision_rating"):
        return state
    public = {k: v for k, v in state.items() if k != "final_trade_decision"}
    public["risk_debate_state"] = {k: v for k, v in (state.get("risk_debate_state") or {}).items()
                                  if k != "judge_decision"}
    return public


def save_state_json(state: dict, path: Path, persistence: ReportPersistence | None = None) -> None:
    payload = {k: v for k, v in state.items() if k != "messages"}
    (persistence or ReportPersistence()).save_state(payload, path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run StockDepth and save live markdown reports.")
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--language", default="English")
    parser.add_argument("--depth", type=int, default=1, choices=(1, 3, 5))
    parser.add_argument("--analysts", default="market,news,fundamentals")
    parser.add_argument("--asset-type", default="stock")
    parser.add_argument("--provider", default=None)
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--quick-model", default=None)
    parser.add_argument("--deep-model", default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--realtime-data", action="store_true")
    parser.add_argument("--checkpoint", action="store_true")
    parser.add_argument("--analyst-concurrency", type=int, choices=(1, 2, 4), default=None)
    parser.add_argument("--max-tool-rounds", type=int, default=None)
    parser.add_argument("--memory-owner", default=None)
    parser.add_argument("--portfolio-file", default=None)
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("stockdepth").setLevel(logging.INFO)
    args = parse_args()
    # The web server injects the selected model's key into this process.
    # Local defaults must not overwrite credentials supplied for this run.
    load_dotenv(Path(__file__).resolve().parents[4] / ".env", override=False)

    if args.date != dt.date.fromisoformat(args.date).isoformat():
        raise ValueError("Analysis date must use YYYY-MM-DD")
    ticker = args.ticker.strip().upper()
    run_id = args.run_id.strip() if args.run_id else None
    analysts = [item.strip() for item in args.analysts.split(",") if item.strip()]
    config = DEFAULT_CONFIG.copy()
    config["max_debate_rounds"] = args.depth
    config["max_risk_discuss_rounds"] = args.depth
    config["output_language"] = args.language
    config["realtime_data"] = args.realtime_data
    config["analysis_date"] = args.date
    config["analysis_ticker"] = ticker
    portfolio = None
    portfolio_raw = Path(args.portfolio_file).read_text() if args.portfolio_file else os.environ.get("STOCKDEPTH_PORTFOLIO_CONTEXT")
    if portfolio_raw:
        from stockdepth.agents.portfolio import PortfolioContext
        portfolio = PortfolioContext.model_validate_json(portfolio_raw)
        config["portfolio_fingerprint"] = portfolio.fingerprint()
    if args.analyst_concurrency is not None:
        config["analyst_concurrency_limit"] = args.analyst_concurrency
    if args.max_tool_rounds is not None:
        config["max_tool_rounds"] = args.max_tool_rounds
    if run_id and not args.memory_owner:
        # An unscoped SaaS run must not read the CLI global memory file.
        config["memory_log_path"] = None
    elif args.memory_owner:
        config["memory_owner"] = args.memory_owner
    model_configs = json.loads(os.environ.get("STOCKDEPTH_MODEL_CONFIGS", "{}"))
    if model_configs:
        if not all(isinstance(model_configs.get(role), dict) for role in ("quick", "deep")):
            raise ValueError("Both Quick and Deep model configurations are required")
        config["model_configs"] = model_configs
        config["llm_provider"] = model_configs["quick"]["provider"]
        config["backend_url"] = model_configs["quick"].get("base_url")
        config["quick_think_llm"] = model_configs["quick"]["model"]
        config["deep_think_llm"] = model_configs["deep"]["model"]
    else:
        if not args.provider or not args.quick_model or not args.deep_model:
            raise ValueError("Analysis models must be supplied from the database configuration")
        config["llm_provider"] = args.provider
        config["backend_url"] = args.base_url or None
        config["quick_think_llm"] = args.quick_model
        config["deep_think_llm"] = args.deep_model

    safe_ticker = safe_ticker_component(ticker)
    if run_id:
        run_dir = Path(config["results_dir"]) / "runs" / safe_ticker_component(run_id, max_len=120)
    else:
        run_dir = Path(config["results_dir"]) / safe_ticker / args.date
    if run_id:
        config["run_state_dir"] = str(run_dir / "state_logs")
    report_dir = run_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    persistence = ReportPersistence()
    resume = args.checkpoint and checkpoint_step(config["data_cache_dir"], ticker, args.date, run_id=run_id) is not None
    frozen = execution_config(run_dir, config, analysts, resume=resume, owner=args.memory_owner)
    config["workflow_version"] = frozen["workflow_version"]
    config["frozen_analyst_concurrency"] = frozen["analyst_concurrency_limit"]
    config["max_tool_rounds"] = frozen["max_tool_rounds"]

    job_id = os.environ.get("STOCKDEPTH_JOB_ID")
    callbacks = [UsageRecorder(run_dir / "usage.json", job_id=int(job_id) if job_id else None)]
    timing = None
    if os.environ.get('STOCKDEPTH_TIMING_ENABLED', 'true').lower() != 'false':
        timing = TimingRecorder(run_dir, job_id=int(job_id) if job_id else None)
        CURRENT_TIMING.set(timing)
        callbacks.append(timing)
        atexit.register(timing.close)
    started_at = time.perf_counter()
    succeeded = False
    graph = StockDepthGraph(selected_analysts=analysts, debug=False, config=config, callbacks=callbacks)
    graph.ticker = ticker
    if config["workflow_version"] == 1:
        graph._resolve_pending_entries(ticker)

    state = graph.propagator.create_initial_state(ticker, args.date, asset_type=args.asset_type)
    from stockdepth.agents.context import instrument_context
    state["instrument_context"] = instrument_context(state)
    state["portfolio_context"] = portfolio.render() if portfolio else ""
    graph_args = graph.propagator.get_graph_args()
    graph_args.setdefault("config", {})["callbacks"] = callbacks
    checkpointer_ctx = None
    stream_input = state
    final_state = {}
    if args.checkpoint:
        checkpointer_ctx = get_checkpointer(config["data_cache_dir"], ticker, run_id=run_id)
        saver = checkpointer_ctx.__enter__()
        graph.graph = graph.workflow.compile(checkpointer=saver)
        graph_args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = thread_id(
            ticker,
            args.date,
            run_id=run_id,
        )
        step = checkpoint_step(config["data_cache_dir"], ticker, args.date, run_id=run_id)
        if step is None:
            print(f"Checkpoint: starting fresh for {ticker} {args.date}", flush=True)
        else:
            print(f"Checkpoint: resuming from step {step} for {ticker} {args.date}", flush=True)
            # None resumes pending work; passing the initial state restarts
            # the graph's entry node even when a checkpoint already exists.
            stream_input = None
            final_state.update(graph.graph.get_state(graph_args["config"]).values)

    try:
        for namespace, chunk in graph.graph.stream(stream_input, subgraphs=True, **graph_args):
            if namespace:
                # Private tool histories reach live progress without being
                # merged into sibling/parent analyst inputs.
                save_progress(chunk, report_dir, persistence)
                continue
            final_state.update(chunk)
            save_progress(final_state, report_dir, persistence)
            public = publishable_state(final_state, frozen["workflow_version"])
            save_report_parts(public, report_dir, persistence)
            persistence.save_complete(public, report_dir / "complete_report.md", ticker, build_complete_report)
            save_state_json(final_state, run_dir / "latest_state.json", persistence)
            if timing:
                timing.flush()

        if frozen["workflow_version"] >= 2 and not final_state.get("decision_rating"):
            raise RuntimeError("Final decision validation did not complete")
        if final_state.get("final_trade_decision"):
            graph.curr_state = final_state
            graph._log_state(args.date, final_state)
            graph.memory_log.store_decision(
                ticker=ticker,
                trade_date=args.date,
                final_trade_decision=final_state["final_trade_decision"],
            )
            if args.checkpoint:
                clear_checkpoint(config["data_cache_dir"], ticker, args.date, run_id=run_id)
            print(graph.process_signal(final_state["final_trade_decision"]))
            succeeded = True
    finally:
        try:
            save_execution_metrics(run_dir, frozen, time.perf_counter() - started_at, succeeded, persistence)
            if final_state:
                save_progress(final_state, report_dir, persistence)
                public = publishable_state(final_state, frozen["workflow_version"])
                save_report_parts(public, report_dir, persistence)
                persistence.save_complete(public, report_dir / "complete_report.md", ticker, build_complete_report)
                save_state_json(final_state, run_dir / "latest_state.json", persistence)
                print(f"Reports saved under: {report_dir}")
        finally:
            if checkpointer_ctx is not None:
                checkpointer_ctx.__exit__(None, None, None)
            if timing:
                timing.close()
            CURRENT_TIMING.set(None)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error)
        try:
            configs = json.loads(os.environ.get("STOCKDEPTH_MODEL_CONFIGS", "{}"))
            for config in configs.values():
                secret = config.get("api_key") if isinstance(config, dict) else None
                if secret:
                    message = message.replace(secret, "[redacted]")
        except (TypeError, ValueError):
            pass
        logging.error("Analysis failed: %s", message)
        raise SystemExit(1)
