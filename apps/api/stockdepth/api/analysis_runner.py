from __future__ import annotations

import argparse
import datetime as dt
import json
import hashlib
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from stockdepth.data.utils import safe_ticker_component
from stockdepth.default_config import DEFAULT_CONFIG
from stockdepth.workflows.checkpointer import clear_checkpoint, checkpoint_step, get_checkpointer, thread_id
from stockdepth.workflows.trading_graph import StockDepthGraph


REPORT_MAP = {
    "market_report": ("market_report.md", "Market Analyst"),
    "sentiment_report": ("sentiment_report.md", "Sentiment Analyst"),
    "news_report": ("news_report.md", "News Analyst"),
    "fundamentals_report": ("fundamentals_report.md", "Fundamentals Analyst"),
    "investment_plan": ("investment_plan.md", "Research Manager"),
    "trader_investment_plan": ("trader_investment_plan.md", "Trader"),
    "final_trade_decision": ("final_trade_decision.md", "Portfolio Manager"),
}


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def save_report_parts(state: dict, report_dir: Path) -> None:
    for key, (filename, _) in REPORT_MAP.items():
        content = state.get(key)
        if content:
            write_text(report_dir / filename, content)

    debate = state.get("investment_debate_state") or {}
    if debate.get("bull_history"):
        write_text(report_dir / "bull_history.md", debate["bull_history"])
    if debate.get("bear_history"):
        write_text(report_dir / "bear_history.md", debate["bear_history"])
    if debate.get("judge_decision") and not state.get("investment_plan"):
        write_text(report_dir / "investment_plan.md", debate["judge_decision"])

    risk = state.get("risk_debate_state") or {}
    if risk.get("aggressive_history"):
        write_text(report_dir / "aggressive_history.md", risk["aggressive_history"])
    if risk.get("conservative_history"):
        write_text(report_dir / "conservative_history.md", risk["conservative_history"])
    if risk.get("neutral_history"):
        write_text(report_dir / "neutral_history.md", risk["neutral_history"])
    if risk.get("judge_decision") and not state.get("final_trade_decision"):
        write_text(report_dir / "final_trade_decision.md", risk["judge_decision"])


def save_progress(state: dict, report_dir: Path) -> None:
    """Persist public replies and tool results, excluding model reasoning."""
    history_path = report_dir / "progress.json"
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {}
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
        entry = {"title": title, "body": "\n\n".join(body)}
        identity = getattr(message, "id", None) or hashlib.sha256(json.dumps(entry, ensure_ascii=False).encode()).hexdigest()
        history[identity] = entry
    # Keep earlier stages when the graph clears messages between analysts.
    sections = ["# 分析过程"]
    for index, entry in enumerate(history.values(), 1):
        sections.append(f"## {index}. {entry['title']}\n\n{entry['body']}")
    write_text(history_path, json.dumps(history, ensure_ascii=False))
    write_text(report_dir / "progress.md", "\n\n".join(sections) + "\n")


def build_complete_report(state: dict, ticker: str) -> str:
    sections = [
        f"# Trading Analysis Report: {ticker}",
        f"Generated: {dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
    ]

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


def save_state_json(state: dict, path: Path) -> None:
    payload = {k: v for k, v in state.items() if k != "messages"}
    write_text(path, json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run StockDepth and save live markdown reports.")
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--language", default="Chinese")
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
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("stockdepth").setLevel(logging.INFO)
    args = parse_args()
    # The web server injects the selected model's key into this process.
    # Local defaults must not overwrite credentials supplied for this run.
    load_dotenv(Path(__file__).resolve().parents[4] / ".env", override=False)

    ticker = args.ticker.strip().upper()
    run_id = args.run_id.strip() if args.run_id else None
    analysts = [item.strip() for item in args.analysts.split(",") if item.strip()]
    config = DEFAULT_CONFIG.copy()
    config["max_debate_rounds"] = args.depth
    config["max_risk_discuss_rounds"] = args.depth
    config["output_language"] = args.language
    config["realtime_data"] = args.realtime_data
    if not args.provider or not args.quick_model or not args.deep_model:
        raise ValueError("分析模型必须由数据库配置传入")
    config["llm_provider"] = args.provider
    config["backend_url"] = args.base_url or None
    config["quick_think_llm"] = args.quick_model
    config["deep_think_llm"] = args.deep_model

    safe_ticker = safe_ticker_component(ticker)
    if run_id:
        run_dir = Path(config["results_dir"]) / "runs" / safe_ticker_component(run_id, max_len=120)
    else:
        run_dir = Path(config["results_dir"]) / safe_ticker / args.date
    report_dir = run_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    graph = StockDepthGraph(selected_analysts=analysts, debug=False, config=config)
    graph.ticker = ticker
    graph._resolve_pending_entries(ticker)

    state = graph.propagator.create_initial_state(ticker, args.date, asset_type=args.asset_type)
    graph_args = graph.propagator.get_graph_args()
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
        for chunk in graph.graph.stream(stream_input, **graph_args):
            final_state.update(chunk)
            save_progress(final_state, report_dir)
            save_report_parts(final_state, report_dir)
            write_text(report_dir / "complete_report.md", build_complete_report(final_state, ticker))
            save_state_json(final_state, run_dir / "latest_state.json")

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
    finally:
        if final_state:
            save_progress(final_state, report_dir)
            save_report_parts(final_state, report_dir)
            write_text(report_dir / "complete_report.md", build_complete_report(final_state, ticker))
            save_state_json(final_state, run_dir / "latest_state.json")
            print(f"Reports saved under: {report_dir}")
        if checkpointer_ctx is not None:
            checkpointer_ctx.__exit__(None, None, None)


if __name__ == "__main__":
    main()
