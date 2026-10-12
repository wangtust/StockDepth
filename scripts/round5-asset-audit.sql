BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'asset_counts' AS audit, (SELECT count(*) FROM paper_portfolios) AS portfolios,
 (SELECT count(*) FROM paper_positions) AS positions, (SELECT count(*) FROM paper_trades) AS trades;
SELECT 'cash_mismatch' AS audit, count(*) FROM paper_portfolios p WHERE p.cash_cents::numeric <>
 p.initial_cash_cents::numeric + COALESCE((SELECT sum(CASE WHEN t.side='buy' THEN -t.gross_amount_cents::numeric-t.fee_cents ELSE t.gross_amount_cents::numeric-t.fee_cents END) FROM paper_trades t WHERE t.portfolio_id=p.id),0);
SELECT 'quantity_mismatch' AS audit, count(*) FROM paper_positions p WHERE p.quantity::numeric <>
 COALESCE((SELECT sum(CASE WHEN t.side='buy' THEN t.quantity::numeric ELSE -t.quantity::numeric END) FROM paper_trades t WHERE t.position_id=p.id),0);
SELECT 'trade_amount_invalid' AS audit, count(*) FROM paper_trades WHERE quantity<=0 OR price_cents<=0 OR fee_cents<0 OR gross_amount_cents::numeric<>quantity::numeric*price_cents::numeric OR side NOT IN ('buy','sell');
SELECT 'position_invalid' AS audit, count(*) FROM paper_positions WHERE quantity<0 OR avg_cost_cents<0 OR last_price_cents<0;
SELECT 'cash_negative' AS audit, count(*) FROM paper_portfolios WHERE cash_cents<0;
SELECT 'trade_owner_mismatch' AS audit, count(*) FROM paper_trades t JOIN paper_portfolios p ON p.id=t.portfolio_id WHERE t.user_id<>p.user_id;
SELECT 'trade_position_mismatch' AS audit, count(*) FROM paper_trades t JOIN paper_positions p ON p.id=t.position_id WHERE t.user_id<>p.user_id OR t.portfolio_id<>p.portfolio_id;
SELECT 'unvalidated_constraints' AS audit, count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND NOT c.convalidated;
SELECT 'growth_counts' AS audit, (SELECT count(*) FROM price_snapshots) AS quotes,(SELECT count(*) FROM daily_prices) AS daily,(SELECT count(*) FROM market_sync_runs) AS sync_runs,(SELECT count(*) FROM paper_trade_requests) AS replay_records;
SELECT 'position_owner_mismatch' AS audit, count(*) FROM paper_positions s LEFT JOIN paper_portfolios p ON p.id=s.portfolio_id WHERE p.id IS NULL OR s.user_id<>p.user_id;
SELECT 'decision_owner_mismatch' AS audit, count(*) FROM paper_trade_decisions s LEFT JOIN paper_portfolios p ON p.id=s.portfolio_id WHERE p.id IS NULL OR s.user_id<>p.user_id;
SELECT 'run_owner_mismatch' AS audit, count(*) FROM paper_analysis_runs s LEFT JOIN paper_portfolios p ON p.id=s.portfolio_id LEFT JOIN analysis_jobs j ON j.id=s.analysis_job_id WHERE p.id IS NULL OR j.id IS NULL OR s.user_id<>p.user_id OR s.user_id<>j.user_id;
SELECT 'request_owner_mismatch' AS audit, count(*) FROM paper_trade_requests s LEFT JOIN paper_portfolios p ON p.id=s.portfolio_id WHERE p.id IS NULL OR s.user_id<>p.user_id;
SELECT 'trade_decision_mismatch' AS audit, count(*) FROM paper_trades t JOIN paper_trade_decisions d ON d.id=t.decision_id WHERE t.user_id<>d.user_id OR t.portfolio_id<>d.portfolio_id;
SELECT 'decision_run_mismatch' AS audit, count(*) FROM paper_trade_decisions d JOIN paper_analysis_runs r ON r.id=d.paper_analysis_run_id WHERE d.user_id<>r.user_id OR d.portfolio_id<>r.portfolio_id;
SELECT 'quote_reference_mismatch' AS audit, count(*) FROM paper_trades t JOIN price_snapshots q ON q.id=t.price_snapshot_id JOIN paper_portfolios p ON p.id=t.portfolio_id WHERE t.execution_price IS DISTINCT FROM q.price OR t.instrument_id IS DISTINCT FROM q.instrument_id OR q.currency<>p.currency OR t.price_cents::numeric<>round(q.price*100);
COMMIT;
