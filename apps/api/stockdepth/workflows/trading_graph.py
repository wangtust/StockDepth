# StockDepth/graph/trading_graph.py

import logging
import math
from copy import deepcopy
import os
from pathlib import Path
import json
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple, List, Optional

import yfinance as yf

logger = logging.getLogger(__name__)

from langgraph.prebuilt import ToolNode

from stockdepth.providers import create_llm_client
from stockdepth.providers.request_gate import RequestGate

from stockdepth.agents import *
from stockdepth.default_config import DEFAULT_CONFIG
from stockdepth.agents.utils.memory import TradingMemoryLog
from stockdepth.data.utils import safe_ticker_component
from stockdepth.agents.utils.agent_states import (
    AgentState,
    InvestDebateState,
    RiskDebateState,
)
from stockdepth.data.config import set_config

# Import the new abstract tool methods from agent_utils
from stockdepth.agents.utils.agent_utils import (
    get_stock_data,
    get_indicators,
    get_fundamentals,
    get_balance_sheet,
    get_cashflow,
    get_income_statement,
    get_news,
    get_insider_transactions,
    get_global_news
)

from .checkpointer import checkpoint_step, clear_checkpoint, get_checkpointer, thread_id
from .conditional_logic import ConditionalLogic
from .setup import GraphSetup
from .analyst_execution import effective_analyst_concurrency
from .propagation import Propagator
from .reflection import Reflector
from .signal_processing import SignalProcessor


class StockDepthGraph:
    """Main class that orchestrates the trading agents framework."""

    def __init__(
        self,
        selected_analysts=["market", "social", "news", "fundamentals"],
        debug=False,
        config: Dict[str, Any] = None,
        callbacks: Optional[List] = None,
    ):
        """Initialize the trading agents graph and components.

        Args:
            selected_analysts: List of analyst types to include
            debug: Whether to run in debug mode
            config: Configuration dictionary. If None, uses default config
            callbacks: Optional list of callback handlers (e.g., for tracking LLM/tool stats)
        """
        self._managed_execution = not config or "workflow_version" not in config
        self.selected_analysts = list(selected_analysts)
        self.debug = debug
        self.config = config or DEFAULT_CONFIG
        self.callbacks = callbacks or []

        # Update the interface's config
        set_config(self.config)

        # Create necessary directories
        os.makedirs(self.config["data_cache_dir"], exist_ok=True)
        os.makedirs(self.config["results_dir"], exist_ok=True)

        # Initialize LLMs with provider-specific thinking configuration
        configs = self.config.get("model_configs") or {}
        self.deep_thinking_llm = self._make_role_llm("deep", configs.get("deep"))
        self.quick_thinking_llm = self._make_role_llm("quick", configs.get("quick"))
        
        self.memory_log = TradingMemoryLog(self.config)

        # Create tool nodes
        self.tool_nodes = self._create_tool_nodes()

        # Initialize components
        self.conditional_logic = ConditionalLogic(
            max_debate_rounds=self.config["max_debate_rounds"],
            max_risk_discuss_rounds=self.config["max_risk_discuss_rounds"],
        )
        self.graph_setup = GraphSetup(
            self.quick_thinking_llm,
            self.deep_thinking_llm,
            self.tool_nodes,
            self.conditional_logic,
            analyst_concurrency_limit=(self.config["frozen_analyst_concurrency"]
                                       if "frozen_analyst_concurrency" in self.config
                                       else effective_analyst_concurrency(self.config)),
            workflow_version=self.config.get("workflow_version", 1),
            max_tool_rounds=self.config.get("max_tool_rounds", 5),
            memory_node=self._memory_node,
        )

        self.propagator = Propagator(
            max_recur_limit=self.config.get("max_recur_limit", 100),
        )
        self.reflector = Reflector(self.quick_thinking_llm)
        self.signal_processor = SignalProcessor(self.quick_thinking_llm)

        # State tracking
        self.curr_state = None
        self.ticker = None
        self.log_states_dict = {}  # date to full state dict

        # Set up the graph: keep the workflow for recompilation with a checkpointer.
        self.workflow = self.graph_setup.setup_graph(self.selected_analysts)
        self.graph = self.workflow.compile()
        self._checkpointer_ctx = None

    def _memory_node(self, state):
        # Historical runs must never settle outcomes using prices fetched today.
        as_of = state["trade_date"]
        note = []
        if as_of >= datetime.now().strftime("%Y-%m-%d"):
            try:
                self._resolve_pending_entries(state["company_of_interest"])
            except Exception as error:
                note.append(f"Memory settlement unavailable ({type(error).__name__}); previous lessons only.")
        try:
            context = self.memory_log.get_past_context(state["company_of_interest"], as_of=as_of)
        except Exception as error:
            context = ""
            note.append(f"Memory read unavailable ({type(error).__name__}); analysis continues without lessons.")
        return {"past_context": context, "memory_note": " ".join(note)}

    def _get_provider_kwargs(self) -> Dict[str, Any]:
        """Get provider-specific kwargs for LLM client creation."""
        kwargs = {}
        provider = self.config.get("llm_provider", "").lower()

        if provider == "google":
            thinking_level = self.config.get("google_thinking_level")
            if thinking_level:
                kwargs["thinking_level"] = thinking_level

        elif provider == "openai":
            reasoning_effort = self.config.get("openai_reasoning_effort")
            if reasoning_effort:
                kwargs["reasoning_effort"] = reasoning_effort

        elif provider == "anthropic":
            effort = self.config.get("anthropic_effort")
            if effort:
                kwargs["effort"] = effort

        return kwargs

    def _make_role_llm(self, role: str, model_config: Optional[dict] = None):
        if model_config:
            provider = str(model_config["provider"])
            model = str(model_config["model"])
            base_url = model_config.get("base_url")
            kwargs = self._get_provider_kwargs_for(provider)
            kwargs["api_key"] = model_config.get("api_key")
            kwargs.update(model_config.get("options") or {})
            kwargs["rate_limit_scope"] = f"model-config-{model_config.get('id')}"
            prices = model_config.get("prices")
            metadata = {"model_role": role, "model_config_id": model_config.get("id"),
                        "model_provider": provider, "model_name": model,
                        "pricing_snapshot": prices}
        else:
            provider = self.config["llm_provider"]
            model = self.config["deep_think_llm"] if role == "deep" else self.config["quick_think_llm"]
            base_url = self.config.get("backend_url")
            kwargs = self._get_provider_kwargs()
            metadata = {"model_role": role, "model_provider": provider, "model_name": model}
        capacity = kwargs.pop("request_concurrency", 4)
        # All SDKs receive explicit finite deadlines/retry budgets, including
        # native providers. Queuing is bounded separately by the same timeout.
        timeout = kwargs.setdefault("timeout", 600)
        retries = kwargs.setdefault("max_retries", int(os.environ.get("STOCKDEPTH_MODEL_MAX_RETRIES", "2")))
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 3600:
            raise ValueError("Model timeout must be between 0 and 3600 seconds")
        if type(retries) is not int or not 0 <= retries <= 5:
            raise ValueError("Model retries must be between 0 and 5")
        scope = f"{provider}:{(base_url or 'default').rstrip('/')}:{metadata.get('model_config_id', 'cli')}"
        gate = RequestGate(scope, capacity, wait_timeout=timeout)
        kwargs["callbacks"] = [gate, *self.callbacks]
        llm = create_llm_client(provider=provider, model=model, base_url=base_url, **kwargs).get_llm()
        # Model methods such as bind_tools/with_structured_output bypass a
        # with_config wrapper. Keep identity on the model used by every path.
        llm.metadata = {**(llm.metadata or {}), **deepcopy(metadata)}
        return llm

    def _get_provider_kwargs_for(self, provider: str) -> Dict[str, Any]:
        provider = provider.lower()
        if provider == "google" and self.config.get("google_thinking_level"):
            return {"thinking_level": self.config["google_thinking_level"]}
        if provider == "openai" and self.config.get("openai_reasoning_effort"):
            return {"reasoning_effort": self.config["openai_reasoning_effort"]}
        if provider == "anthropic" and self.config.get("anthropic_effort"):
            return {"effort": self.config["anthropic_effort"]}
        return {}

    def _create_tool_nodes(self) -> Dict[str, ToolNode]:
        """Create tool nodes for different data sources using abstract methods."""
        nodes = {
            "market": ToolNode(
                [
                    # Core stock data tools
                    get_stock_data,
                    # Technical indicators
                    get_indicators,
                ]
            ),
            "social": ToolNode(
                [
                    # News tools for social media analysis
                    get_news,
                ]
            ),
            "news": ToolNode(
                [
                    # News and insider information
                    get_news,
                    get_global_news,
                    get_insider_transactions,
                ]
            ),
            "fundamentals": ToolNode(
                [
                    # Fundamental analysis tools
                    get_fundamentals,
                    get_balance_sheet,
                    get_cashflow,
                    get_income_statement,
                ]
            ),
        }
        if self.config.get("workflow_version", 1) >= 3:
            from stockdepth.agents.runtime_tools import analyst_tools
            nodes = {key: ToolNode(analyst_tools(list(node.tools_by_name.values()))) for key, node in nodes.items()}
        return nodes

    def _resolve_benchmark(self, ticker: str) -> str:
        """Pick the benchmark ticker for alpha calculation against ``ticker``.

        ``config["benchmark_ticker"]`` overrides everything when set; otherwise
        the suffix map matches the ticker's exchange suffix (e.g. ``.T`` for
        Tokyo). US-listed tickers without a dotted suffix fall through to the
        empty-suffix entry (SPY by default). Unrecognised suffixes (including
        US tickers with dots like ``BRK.B``) also fall back to the empty-suffix
        entry, which is the right default because the alpha calculation works
        in USD.
        """
        explicit = self.config.get("benchmark_ticker")
        if explicit:
            return explicit
        benchmark_map = self.config.get("benchmark_map", {})
        ticker_upper = ticker.upper()
        for suffix, benchmark in benchmark_map.items():
            if suffix and ticker_upper.endswith(suffix.upper()):
                return benchmark
        return benchmark_map.get("", "SPY")

    def _fetch_returns(
        self, ticker: str, trade_date: str, holding_days: int = 5,
        benchmark: str = "SPY",
    ) -> Tuple[Optional[float], Optional[float], Optional[int]]:
        """Fetch raw and alpha return for ticker over holding_days from trade_date.

        ``benchmark`` is the index used as the alpha baseline (resolved by the
        caller via ``_resolve_benchmark``). Returns ``(raw_return, alpha_return,
        actual_holding_days)`` or ``(None, None, None)`` if price data is
        unavailable (too recent, delisted, or network error).
        """
        try:
            start = datetime.strptime(trade_date, "%Y-%m-%d")
            end = start + timedelta(days=holding_days + 7)  # buffer for weekends/holidays
            end_str = end.strftime("%Y-%m-%d")

            stock = yf.Ticker(ticker).history(start=trade_date, end=end_str)
            bench = yf.Ticker(benchmark).history(start=trade_date, end=end_str)

            if len(stock) < 2 or len(bench) < 2:
                return None, None, None

            actual_days = min(holding_days, len(stock) - 1, len(bench) - 1)
            raw = float(
                (stock["Close"].iloc[actual_days] - stock["Close"].iloc[0])
                / stock["Close"].iloc[0]
            )
            bench_ret = float(
                (bench["Close"].iloc[actual_days] - bench["Close"].iloc[0])
                / bench["Close"].iloc[0]
            )
            alpha = raw - bench_ret
            return raw, alpha, actual_days
        except Exception as e:
            logger.warning(
                "Could not resolve outcome for %s on %s vs %s (will retry next run): %s",
                ticker, trade_date, benchmark, e,
            )
            return None, None, None

    def _resolve_pending_entries(self, ticker: str) -> None:
        """Resolve pending log entries for ticker at the start of a new run.

        Fetches returns for each same-ticker pending entry, generates reflections,
        then writes all updates in a single atomic batch write to avoid redundant I/O.
        Skips entries whose price data is not yet available (too recent or delisted).

        Trade-off: only same-ticker entries are resolved per run.  Entries for
        other tickers accumulate until that ticker is run again.
        """
        pending = [e for e in self.memory_log.get_pending_entries() if e["ticker"] == ticker]
        if not pending:
            return

        benchmark = self._resolve_benchmark(ticker)
        updates = []
        for entry in pending:
            raw, alpha, days = self._fetch_returns(
                ticker, entry["date"], benchmark=benchmark,
            )
            if raw is None:
                continue  # price not available yet — try again next run
            reflection = self.reflector.reflect_on_final_decision(
                final_decision=entry.get("decision", ""),
                raw_return=raw,
                alpha_return=alpha,
                benchmark_name=benchmark,
            )
            updates.append({
                "ticker": ticker,
                "trade_date": entry["date"],
                "raw_return": raw,
                "alpha_return": alpha,
                "holding_days": days,
                "reflection": reflection,
            })

        if updates:
            self.memory_log.batch_update_with_outcomes(updates)

    def propagate(self, company_name, trade_date, asset_type: str = "stock"):
        """Run the trading agents graph for a company on a specific date.

        ``asset_type`` selects between the stock pipeline (default) and the
        crypto pipeline (``"crypto"``) shipped in #567 — the CLI auto-detects
        from the ticker; programmatic callers pass it explicitly. When
        ``checkpoint_enabled`` is set in config, the graph is recompiled with
        a per-ticker SqliteSaver so a crashed run can resume from the last
        successful node on a subsequent invocation with the same ticker+date.
        """
        self.ticker = company_name

        if self._managed_execution:
            from .execution_config import execution_config
            self.config = {**self.config, "analysis_ticker": company_name, "analysis_date": str(trade_date)}
            manifest_dir = (Path(self.config["results_dir"]) / safe_ticker_component(company_name)
                            / str(trade_date) / "execution")
            datetime.strptime(str(trade_date), "%Y-%m-%d")
            manifest_dir.mkdir(parents=True, exist_ok=True)
            resume = (self.config.get("checkpoint_enabled") and
                      checkpoint_step(self.config["data_cache_dir"], company_name, str(trade_date)) is not None)
            frozen = execution_config(manifest_dir, self.config, self.selected_analysts, resume=resume)
            self.config["workflow_version"] = frozen["workflow_version"]
            set_config(self.config)
            self.tool_nodes = self._create_tool_nodes()
            self.workflow = GraphSetup(
                self.quick_thinking_llm, self.deep_thinking_llm, self.tool_nodes, self.conditional_logic,
                analyst_concurrency_limit=frozen["analyst_concurrency_limit"],
                workflow_version=frozen["workflow_version"], max_tool_rounds=frozen["max_tool_rounds"],
                memory_node=self._memory_node,
            ).setup_graph(self.selected_analysts)
            self.graph = self.workflow.compile()
        if self.config.get("workflow_version", 1) == 1:
            self._resolve_pending_entries(company_name)

        # Recompile with a checkpointer if the user opted in.
        if self.config.get("checkpoint_enabled"):
            self._checkpointer_ctx = get_checkpointer(
                self.config["data_cache_dir"], company_name
            )
            saver = self._checkpointer_ctx.__enter__()
            self.graph = self.workflow.compile(checkpointer=saver)

            step = checkpoint_step(
                self.config["data_cache_dir"], company_name, str(trade_date)
            )
            if step is not None:
                logger.info(
                    "Resuming from step %d for %s on %s", step, company_name, trade_date
                )
            else:
                logger.info("Starting fresh for %s on %s", company_name, trade_date)

        try:
            return self._run_graph(company_name, trade_date, asset_type=asset_type)
        finally:
            if self._checkpointer_ctx is not None:
                self._checkpointer_ctx.__exit__(None, None, None)
                self._checkpointer_ctx = None
                self.graph = self.workflow.compile()

    def _run_graph(self, company_name, trade_date, asset_type: str = "stock"):
        """Execute the graph and write the resulting state to disk and memory log."""
        # Initialize state — inject memory log context for PM.
        past_context = self.memory_log.get_past_context(company_name, as_of=str(trade_date)) if self.config.get("workflow_version", 1) == 1 else ""
        init_agent_state = self.propagator.create_initial_state(
            company_name, trade_date, asset_type=asset_type, past_context=past_context
        )
        from stockdepth.agents.context import instrument_context
        init_agent_state["instrument_context"] = instrument_context(init_agent_state)
        args = self.propagator.get_graph_args()

        # Inject thread_id so same ticker+date resumes, different date starts fresh.
        if self.config.get("checkpoint_enabled"):
            tid = thread_id(company_name, str(trade_date))
            args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = tid

        stream_input = init_agent_state
        if self.config.get("checkpoint_enabled") and self.graph.get_state(args["config"]).next:
            stream_input = None

        if self.debug:
            trace = []
            for chunk in self.graph.stream(stream_input, **args):
                if len(chunk["messages"]) == 0:
                    pass
                else:
                    chunk["messages"][-1].pretty_print()
                    trace.append(chunk)
            # Streamed chunks are per-node deltas. Merge them so the returned
            # state matches what graph.invoke() yields in the non-debug path.
            final_state = {}
            for chunk in trace:
                final_state.update(chunk)
        else:
            final_state = self.graph.invoke(stream_input, **args)

        # Store current state for reflection.
        self.curr_state = final_state

        # Log state to disk.
        self._log_state(trade_date, final_state)

        # Store decision for deferred reflection on the next same-ticker run.
        self.memory_log.store_decision(
            ticker=company_name,
            trade_date=trade_date,
            final_trade_decision=final_state["final_trade_decision"],
        )

        # Clear checkpoint on successful completion to avoid stale state.
        if self.config.get("checkpoint_enabled"):
            clear_checkpoint(
                self.config["data_cache_dir"], company_name, str(trade_date)
            )

        return final_state, self.process_signal(final_state["final_trade_decision"])

    def _log_state(self, trade_date, final_state):
        """Log the final state to a JSON file."""
        self.log_states_dict[str(trade_date)] = {
            "company_of_interest": final_state["company_of_interest"],
            "trade_date": final_state["trade_date"],
            "market_report": final_state["market_report"],
            "sentiment_report": final_state["sentiment_report"],
            "news_report": final_state["news_report"],
            "fundamentals_report": final_state["fundamentals_report"],
            "investment_debate_state": {
                "bull_history": final_state["investment_debate_state"]["bull_history"],
                "bear_history": final_state["investment_debate_state"]["bear_history"],
                "history": final_state["investment_debate_state"]["history"],
                "current_response": final_state["investment_debate_state"][
                    "current_response"
                ],
                "judge_decision": final_state["investment_debate_state"][
                    "judge_decision"
                ],
            },
            "trader_investment_decision": final_state["trader_investment_plan"],
            "risk_debate_state": {
                "aggressive_history": final_state["risk_debate_state"]["aggressive_history"],
                "conservative_history": final_state["risk_debate_state"]["conservative_history"],
                "neutral_history": final_state["risk_debate_state"]["neutral_history"],
                "history": final_state["risk_debate_state"]["history"],
                "judge_decision": final_state["risk_debate_state"]["judge_decision"],
            },
            "investment_plan": final_state["investment_plan"],
            "final_trade_decision": final_state["final_trade_decision"],
            "market_snapshot": final_state.get("market_snapshot"),
            "market_evidence": final_state.get("market_evidence"),
            "portfolio_context": final_state.get("portfolio_context"),
            "memory_note": final_state.get("memory_note"),
        }

        # Save to file. Reject ticker values that would escape the
        # results directory when joined as a path component.
        safe_ticker = safe_ticker_component(self.ticker)
        directory = (Path(self.config["run_state_dir"]) if self.config.get("run_state_dir")
                     else Path(self.config["results_dir"]) / safe_ticker / "StockDepthStrategy_logs")
        directory.mkdir(parents=True, exist_ok=True)

        log_path = directory / f"full_states_log_{trade_date}.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(self.log_states_dict[str(trade_date)], f, indent=4)

    def process_signal(self, full_signal):
        """Process a signal to extract the core decision."""
        return self.signal_processor.process_signal(full_signal)
