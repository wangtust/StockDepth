import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  date,
  integer,
  bigint,
  numeric,
  index,
  uniqueIndex,
  boolean,
  uuid,
  jsonb,
  check,
  customType,
  type AnyPgColumn,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

import { safeCents, AmountRangeError } from '../paper/amount';

// Safe JSON-number contract, with exact driver decoding for every cents reader.
const cents = customType<{ data: number; driverData: string }>({
  dataType: () => 'bigint',
  fromDriver: value => safeCents(BigInt(value)),
  toDriver: value => {
    if (!Number.isSafeInteger(value)) throw new AmountRangeError('Unsafe cents value.');
    return BigInt(value).toString();
  },
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  inviteCode: varchar('invite_code', { length: 6 }).unique(),
  referredByUserId: integer('referred_by_user_id').references((): AnyPgColumn => users.id),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, t => [check('users_referrer_not_self', sql`${t.referredByUserId} IS NULL OR ${t.referredByUserId} <> ${t.id}`)]);

// Authoritative credit and subscription account. Opening balances describe the
// historical cutover, not invented old grants.
export const billingAccounts = pgTable('billing_accounts', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  analysisCredits: integer('analysis_credits').notNull().default(0),
  ledgerSequence: bigint('ledger_sequence', { mode: 'number' }).notNull().default(0),
  ledgerOpeningBalance: integer('ledger_opening_balance').notNull().default(0),
  ledgerOpenedAt: timestamp('ledger_opened_at', { withTimezone: true }).notNull().defaultNow(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check('billing_accounts_nonnegative', sql`${t.analysisCredits} >= 0 AND ${t.ledgerOpeningBalance} >= 0 AND ${t.ledgerSequence} >= 0 AND ${t.ledgerSequence} <= 9007199254740991`),
  uniqueIndex('billing_accounts_customer_unique').on(t.stripeCustomerId).where(sql`${t.stripeCustomerId} IS NOT NULL`),
  uniqueIndex('billing_accounts_subscription_unique').on(t.stripeSubscriptionId).where(sql`${t.stripeSubscriptionId} IS NOT NULL`),
]);

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

// Global market data: deliberately no user ownership columns.
export const instruments = pgTable('instruments', {
  id: serial('id').primaryKey(),
  symbol: varchar('symbol', { length: 40 }).notNull(),
  exchange: varchar('exchange', { length: 40 }).notNull(),
  name: varchar('name', { length: 160 }),
  currency: varchar('currency', { length: 12 }),
  timezone: varchar('timezone', { length: 80 }),
  status: varchar('status', { length: 20 }).notNull().default('unresolved'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  syncEnabled: boolean('sync_enabled').notNull().default(true),
}, t => [uniqueIndex('instruments_exchange_symbol_idx').on(t.exchange, t.symbol),
  check('instruments_status_valid', sql`${t.status} in ('verified','unresolved','inactive')`),
  check('instruments_verified_identity', sql`${t.status} <> 'verified' OR (${t.currency} IS NOT NULL AND ${t.timezone} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL AND ${t.exchange} <> 'UNRESOLVED')`)]);
export const instrumentSources = pgTable('instrument_sources', {
  id: serial('id').primaryKey(),
  instrumentId: integer('instrument_id').notNull().references(() => instruments.id),
  vendor: varchar('vendor', { length: 40 }).notNull(),
  vendorSymbol: varchar('vendor_symbol', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('unresolved'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
}, t => [uniqueIndex('instrument_sources_vendor_symbol_idx').on(t.vendor, t.vendorSymbol), index('instrument_sources_instrument_idx').on(t.instrumentId)]);
export const priceSnapshots = pgTable('price_snapshots', {
  id: serial('id').primaryKey(),
  instrumentId: integer('instrument_id').notNull().references(() => instruments.id),
  price: numeric('price', { precision: 24, scale: 8 }).notNull(),
  currency: varchar('currency', { length: 12 }).notNull(),
  quotedAt: timestamp('quoted_at', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  source: varchar('source', { length: 40 }).notNull(),
  priceType: varchar('price_type', { length: 40 }).notNull(),
  session: varchar('session', { length: 20 }).notNull(),
}, t => [uniqueIndex('price_snapshots_identity_idx').on(t.instrumentId, t.source, t.quotedAt, t.priceType),
  index('price_snapshots_latest_idx').on(t.instrumentId, t.quotedAt),
  check('price_snapshots_price_valid', sql`${t.price} > 0 AND ${t.price} < 10000000000000000 AND ${t.priceType} = 'regular_unadjusted' AND ${t.session} = 'regular'`)]);
export const dailyPrices = pgTable('daily_prices', {
  id: serial('id').primaryKey(),
  instrumentId: integer('instrument_id').notNull().references(() => instruments.id),
  tradingDate: date('trading_date').notNull(),
  open: numeric('open', { precision: 24, scale: 8 }).notNull(),
  high: numeric('high', { precision: 24, scale: 8 }).notNull(),
  low: numeric('low', { precision: 24, scale: 8 }).notNull(),
  close: numeric('close', { precision: 24, scale: 8 }).notNull(),
  volume: bigint('volume', { mode: 'bigint' }).notNull(),
  source: varchar('source', { length: 40 }).notNull(),
  adjusted: boolean('adjusted').notNull().default(false),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('daily_prices_identity_idx').on(t.instrumentId, t.tradingDate, t.source, t.adjusted),
  check('daily_prices_ohlcv_valid', sql`${t.low} > 0 AND ${t.high} >= ${t.low} AND ${t.open} BETWEEN ${t.low} AND ${t.high} AND ${t.close} BETWEEN ${t.low} AND ${t.high} AND ${t.high} < 10000000000000000 AND ${t.volume} >= 0`)]);
export const marketSyncState = pgTable('market_sync_state', {
  id: serial('id').primaryKey(),
  instrumentId: integer('instrument_id').notNull().references(() => instruments.id),
  category: varchar('category', { length: 20 }).notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  errorSummary: varchar('error_summary', { length: 160 }),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  owner: uuid('owner'),
}, t => [uniqueIndex('market_sync_state_instrument_category_idx').on(t.instrumentId, t.category),
  index('market_sync_state_due_idx').on(t.nextRunAt),
  check('market_sync_state_category_valid', sql`${t.category} in ('identity','quote','daily') AND ${t.attempts} >= 0`)]);
export const marketSyncRuns = pgTable('market_sync_runs', {
  id: serial('id').primaryKey(),
  owner: uuid('owner').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  claimed: integer('claimed').notNull().default(0),
  succeeded: integer('succeeded').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  errorSummary: varchar('error_summary', { length: 160 }),
});

export const analysisJobs = pgTable(
  'analysis_jobs',
  {
    id: serial('id').primaryKey(),
    runId: varchar('run_id', { length: 120 }).notNull().unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    instrumentId: integer('instrument_id').references(() => instruments.id),
    ticker: varchar('ticker', { length: 40 }).notNull(),
    tradeDate: varchar('trade_date', { length: 20 }).notNull(),
    realtimeData: boolean('realtime_data').notNull().default(false),
    language: varchar('language', { length: 40 }).notNull().default('Chinese'),
    depth: integer('depth').notNull().default(1),
    analysts: text('analysts').notNull(),
    quickModelVersionId: integer('quick_model_version_id').references(() => llmModelConfigVersions.id),
    deepModelVersionId: integer('deep_model_version_id').references(() => llmModelConfigVersions.id),
    configurationState: text('configuration_state').notNull().default('legacy_unknown'),
    chargedCredits: integer('charged_credits'),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
    tokenUsageComplete: boolean('token_usage_complete').notNull().default(false),
    status: varchar('status', { length: 30 }).notNull().default('queued'),
    externalStatus: varchar('external_status', { length: 30 }),
    externalPid: integer('external_pid'),
    workerOwner: varchar('worker_owner', { length: 100 }),
    workerLeaseUntil: timestamp('worker_lease_until', { withTimezone: true }),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    hiddenAt: timestamp('hidden_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('analysis_jobs_id_owner_idx').on(table.id,table.userId),
    check('analysis_jobs_configuration_state', sql`(${table.configurationState} = 'legacy_unknown' AND ${table.quickModelVersionId} IS NULL AND ${table.deepModelVersionId} IS NULL) OR (${table.configurationState} = 'versioned' AND ${table.quickModelVersionId} IS NOT NULL AND ${table.deepModelVersionId} IS NOT NULL)`),
    check('analysis_jobs_charged_credits_nonnegative', sql`${table.chargedCredits} IS NULL OR ${table.chargedCredits} >= 0`),
    index('analysis_jobs_status_created_at_idx').on(table.status, table.createdAt),
    index('analysis_jobs_worker_lease_idx').on(table.status, table.workerLeaseUntil, table.createdAt),
    index('analysis_jobs_user_created_at_idx').on(table.userId, table.createdAt),
    check('analysis_jobs_trade_date_valid', sql`CASE WHEN ${table.tradeDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN (${table.tradeDate}::date IS NOT NULL) ELSE false END`),
    index('analysis_jobs_user_instrument_date_idx').on(table.userId, table.instrumentId, table.tradeDate).where(sql`hidden_at is null`),
    index('analysis_jobs_user_visible_id_idx').on(table.userId, table.id).where(sql`hidden_at is null`),
  ]
);

// Historical evidence for jobs without reliable model version lineage only.
export const analysisJobLegacyConfigs = pgTable('analysis_job_legacy_configs', {
  jobId: integer('job_id').primaryKey().references(() => analysisJobs.id, { onDelete: 'cascade' }),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
}, t => [check('job_legacy_evidence_object', sql`jsonb_typeof(${t.evidence}) = 'object'`)]);

export const analysisWorkerSettings = pgTable('analysis_worker_settings', {
  key: varchar('key', { length: 50 }).primaryKey(),
  systemConcurrency: integer('system_concurrency').notNull().default(200),
  userConcurrency: integer('user_concurrency').notNull().default(5),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const llmModelConfigs = pgTable('llm_model_configs', {
  id: serial('id').primaryKey(),
  currentVersionId: integer('current_version_id'),
  name: varchar('name', { length: 120 }).notNull(),
  quickEnabled: boolean('quick_enabled').notNull().default(true),
  deepEnabled: boolean('deep_enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  unavailableReason: varchar('unavailable_reason', { length: 40 }),
  unavailableAt: timestamp('unavailable_at', { withTimezone: true }),
  availabilityCheckedAt: timestamp('availability_checked_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => [foreignKey({ name: 'model_configs_current_version_owner_fk', columns: [t.currentVersionId,t.id], foreignColumns: [llmModelConfigVersions.id,llmModelConfigVersions.configId] })]);

export const llmModelConfigVersions = pgTable('llm_model_config_versions', {
  id: serial('id').primaryKey(),
  configId: integer('config_id').notNull().references((): AnyPgColumn => llmModelConfigs.id),
  version: integer('version').notNull(),
  provider: varchar('provider', { length: 80 }).notNull(),
  baseUrl: text('base_url').notNull(),
  modelName: varchar('model_name', { length: 160 }).notNull(),
  modelOptions: jsonb('model_options').$type<Record<string, string | number | boolean>>().notNull().default(sql`'{}'::jsonb`),
  encryptedApiKey: text('encrypted_api_key'),
  inputPrice: numeric('input_price', { precision: 15, scale: 6 }),
  cachePrice: numeric('cache_price', { precision: 15, scale: 6 }),
  outputPrice: numeric('output_price', { precision: 15, scale: 6 }),
  priceCurrency: varchar('price_currency', { length: 3 }).notNull().default('CNY'),
  priceUnitTokens: integer('price_unit_tokens').notNull().default(1000000),
  provenance: text('provenance').notNull().default('configured'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex('model_versions_config_version_unique').on(t.configId,t.version),
  uniqueIndex('model_versions_id_config_unique').on(t.id,t.configId),
  check('model_versions_values_valid', sql`${t.version} > 0 AND ${t.priceUnitTokens} > 0 AND (${t.inputPrice} IS NULL OR ${t.inputPrice} >= 0) AND (${t.cachePrice} IS NULL OR ${t.cachePrice} >= 0) AND (${t.outputPrice} IS NULL OR ${t.outputPrice} >= 0) AND jsonb_typeof(${t.modelOptions}) = 'object' AND ${t.provenance} IN ('configured','historical_snapshot') AND ${t.encryptedApiKey} LIKE 'sdkey:%'`),
]);

export const analysisReports = pgTable('analysis_reports', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id')
    .notNull()
    .references(() => analysisJobs.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  reportKey: varchar('report_key', { length: 80 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  relativePath: text('relative_path'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [index('analysis_reports_job_user_idx').on(table.jobId, table.userId),
  uniqueIndex('analysis_reports_job_key_idx').on(table.jobId,table.reportKey),
  foreignKey({name:'analysis_reports_job_owner_fk',columns:[table.jobId,table.userId],foreignColumns:[analysisJobs.id,analysisJobs.userId]})]);

export const creditTransactions = pgTable('credit_transactions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  jobId: integer('job_id').references(() => analysisJobs.id),
  amount: integer('amount').notNull(),
  reason: varchar('reason', { length: 80 }).notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  ledgerSequence: bigint('ledger_sequence', { mode: 'number' }),
  balanceAfter: integer('balance_after'),
  operationKey: varchar('operation_key', { length: 160 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [foreignKey({name:'credit_transactions_job_owner_fk',columns:[t.jobId,t.userId],foreignColumns:[analysisJobs.id,analysisJobs.userId]}),
  foreignKey({name:'credit_transactions_billing_account_fk',columns:[t.userId],foreignColumns:[billingAccounts.userId]}),
  uniqueIndex('credit_transactions_user_sequence_unique').on(t.userId,t.ledgerSequence).where(sql`${t.ledgerSequence} IS NOT NULL`),
  uniqueIndex('credit_transactions_user_operation_unique').on(t.userId,t.operationKey).where(sql`${t.operationKey} IS NOT NULL`),
  index('credit_transactions_user_id_idx').on(t.userId,t.id),
  index('credit_transactions_job_owner_idx').on(t.jobId,t.userId).where(sql`${t.jobId} IS NOT NULL`),
  check('credit_transactions_v2_balance_valid', sql`(${t.ledgerSequence} IS NULL AND ${t.balanceAfter} IS NULL) OR (${t.ledgerSequence} IS NOT NULL AND ${t.balanceAfter} IS NOT NULL AND ${t.ledgerSequence} > 0 AND ${t.ledgerSequence} <= 9007199254740991 AND ${t.balanceAfter} >= 0)`),
]);

export const analysisPricing = pgTable('analysis_pricing', {
  depth: integer('depth').primaryKey(),
  label: varchar('label', { length: 40 }).notNull(),
  creditCost: integer('credit_cost').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    instrumentId: integer('instrument_id').references(() => instruments.id),
    ticker: varchar('ticker', { length: 40 }).notNull(),
    market: varchar('market', { length: 40 }),
    name: varchar('name', { length: 160 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('watchlist_items_id_owner_idx').on(table.id,table.userId),
    uniqueIndex('watchlist_items_user_ticker_idx').on(table.userId, table.ticker),
    index('watchlist_items_user_active_idx').on(table.userId, table.isActive),
  ]
);

export const paperPortfolios = pgTable(
  'paper_portfolios',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 120 }).notNull().default('Paper Portfolio'),
    initialCashCents: cents('initial_cash_cents').notNull(),
    cashCents: cents('cash_cents').notNull(),
    currency: varchar('currency', { length: 12 }).notNull().default('USD'),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    autoTradeEnabled: boolean('auto_trade_enabled').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('paper_portfolios_id_owner_idx').on(table.id, table.userId),
    check('paper_portfolios_initialCashCents_safe', sql`${table.initialCashCents} BETWEEN -9007199254740991 AND 9007199254740991`),
    check('paper_portfolios_cashCents_safe', sql`${table.cashCents} BETWEEN -9007199254740991 AND 9007199254740991`),

    index('paper_portfolios_user_status_idx').on(table.userId, table.status),
    check('paper_portfolios_cash_nonnegative', sql`${table.cashCents} >= 0`),
  ]
);

export const paperPositions = pgTable(
  'paper_positions',
  {
    id: serial('id').primaryKey(),
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => paperPortfolios.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    instrumentId: integer('instrument_id').references(() => instruments.id),
    ticker: varchar('ticker', { length: 40 }).notNull(),
    quantity: integer('quantity').notNull().default(0),
    avgCostCents: cents('avg_cost_cents').notNull().default(0),
    lastPriceCents: cents('last_price_cents').notNull().default(0),
    realizedPnlCents: cents('realized_pnl_cents').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('paper_positions_id_scope_idx').on(table.id, table.portfolioId, table.userId),
    foreignKey({name:'paper_positions_portfolio_owner_fk', columns:[table.portfolioId,table.userId], foreignColumns:[paperPortfolios.id,paperPortfolios.userId]}),
    check('paper_positions_avgCostCents_safe', sql`${table.avgCostCents} BETWEEN -9007199254740991 AND 9007199254740991`),
    check('paper_positions_lastPriceCents_safe', sql`${table.lastPriceCents} BETWEEN -9007199254740991 AND 9007199254740991`),
    check('paper_positions_realizedPnlCents_safe', sql`${table.realizedPnlCents} BETWEEN -9007199254740991 AND 9007199254740991`),

    uniqueIndex('paper_positions_portfolio_ticker_idx').on(table.portfolioId, table.ticker),
    index('paper_positions_user_idx').on(table.userId),
    check('paper_positions_amounts_nonnegative', sql`${table.quantity} >= 0 AND ${table.avgCostCents} >= 0 AND ${table.lastPriceCents} >= 0`),
  ]
);

export const paperTrades = pgTable(
  'paper_trades',
  {
    id: serial('id').primaryKey(),
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => paperPortfolios.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    positionId: integer('position_id').references(() => paperPositions.id),
    priceSnapshotId: integer('price_snapshot_id').references(() => priceSnapshots.id),
    executionPrice: numeric('execution_price', { precision: 24, scale: 8 }),
    decisionId: integer('decision_id').references(() => paperTradeDecisions.id),
    instrumentId: integer('instrument_id').references(() => instruments.id),
    ticker: varchar('ticker', { length: 40 }).notNull(),
    side: varchar('side', { length: 12 }).notNull(),
    quantity: integer('quantity').notNull(),
    priceCents: cents('price_cents').notNull(),
    grossAmountCents: cents('gross_amount_cents').notNull(),
    feeCents: cents('fee_cents').notNull().default(0),
    realizedPnlCents: cents('realized_pnl_cents').notNull().default(0),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({name:'paper_trades_portfolio_owner_fk',columns:[table.portfolioId,table.userId],foreignColumns:[paperPortfolios.id,paperPortfolios.userId]}),
    foreignKey({name:'paper_trades_position_scope_fk',columns:[table.positionId,table.portfolioId,table.userId],foreignColumns:[paperPositions.id,paperPositions.portfolioId,paperPositions.userId]}),
    foreignKey({name:'paper_trades_decision_scope_fk',columns:[table.decisionId,table.portfolioId,table.userId],foreignColumns:[paperTradeDecisions.id,paperTradeDecisions.portfolioId,paperTradeDecisions.userId]}),
    check('paper_trades_priceCents_safe', sql`${table.priceCents} BETWEEN -9007199254740991 AND 9007199254740991`),
    check('paper_trades_grossAmountCents_safe', sql`${table.grossAmountCents} BETWEEN -9007199254740991 AND 9007199254740991`),
    check('paper_trades_feeCents_safe', sql`${table.feeCents} BETWEEN -9007199254740991 AND 9007199254740991`),
    check('paper_trades_realizedPnlCents_safe', sql`${table.realizedPnlCents} BETWEEN -9007199254740991 AND 9007199254740991`),

    index('paper_trades_portfolio_created_idx').on(table.portfolioId, table.createdAt),
    index('paper_trades_user_created_idx').on(table.userId, table.createdAt),
    uniqueIndex('paper_trades_decision_idx').on(table.decisionId),
    check('paper_trades_amounts_valid', sql`${table.quantity} > 0 AND ${table.priceCents} > 0 AND ${table.grossAmountCents}::bigint = ${table.quantity}::bigint * ${table.priceCents}::bigint AND ${table.feeCents} >= 0`),
  ]
);

// The portfolio lock serializes claims; result is written in the trade transaction.
export const paperTradeRequests = pgTable('paper_trade_requests', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  portfolioId: integer('portfolio_id').notNull().references(() => paperPortfolios.id),
  key: uuid('key').notNull(),
  request: text('request').notNull(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
    foreignKey({name:'paper_requests_portfolio_owner_fk',columns:[table.portfolioId,table.userId],foreignColumns:[paperPortfolios.id,paperPortfolios.userId]}),
  uniqueIndex('paper_trade_requests_scope_key_idx').on(table.userId, table.portfolioId, table.key),
]);

export const paperAnalysisRuns = pgTable(
  'paper_analysis_runs',
  {
    id: serial('id').primaryKey(),
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => paperPortfolios.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    watchlistItemId: integer('watchlist_item_id').references(() => watchlistItems.id),
    analysisJobId: integer('analysis_job_id')
      .notNull()
      .references(() => analysisJobs.id),
    ticker: varchar('ticker', { length: 40 }).notNull(),
    context: text('context'),
    processingState: varchar('processing_state', { length: 30 }).notNull().default('queued'),
    workerOwner: varchar('worker_owner', { length: 100 }),
    workerLeaseUntil: timestamp('worker_lease_until', { withTimezone: true }),
    modelSubmittedAt: timestamp('model_submitted_at', { withTimezone: true }),
    modelCallId: varchar('model_call_id', { length: 100 }),
    traderModelVersionId: integer('trader_model_version_id').references(() => llmModelConfigVersions.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('paper_analysis_runs_id_scope_job_idx').on(table.id,table.portfolioId,table.userId,table.analysisJobId),
    foreignKey({name:'paper_runs_portfolio_owner_fk',columns:[table.portfolioId,table.userId],foreignColumns:[paperPortfolios.id,paperPortfolios.userId]}),
    foreignKey({name:'paper_runs_job_owner_fk',columns:[table.analysisJobId,table.userId],foreignColumns:[analysisJobs.id,analysisJobs.userId]}),
    foreignKey({name:'paper_runs_watchlist_owner_fk',columns:[table.watchlistItemId,table.userId],foreignColumns:[watchlistItems.id,watchlistItems.userId]}),
    uniqueIndex('paper_analysis_runs_job_idx').on(table.analysisJobId),
    index('paper_analysis_runs_portfolio_created_idx').on(table.portfolioId, table.createdAt),
    index('paper_analysis_runs_user_created_idx').on(table.userId, table.createdAt),
    index('paper_runs_processing_lease_idx').on(table.processingState, table.workerLeaseUntil, table.createdAt),
  ]
);

export const paperModelCalls = pgTable('paper_model_calls', {
  id: serial('id').primaryKey(),
  paperRunId: integer('paper_run_id').notNull().references(() => paperAnalysisRuns.id, { onDelete: 'cascade' }),
  callId: varchar('call_id', { length: 100 }).notNull(),
  modelConfigId: integer('model_config_id'),
  modelVersionId: integer('model_version_id').references(() => llmModelConfigVersions.id),
  costCurrency: varchar('cost_currency', { length: 3 }),
  provider: varchar('provider', { length: 80 }).notNull(),
  model: text('model').notNull(),
  status: varchar('status', { length: 30 }).notNull(),
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  cachedInputTokens: bigint('cached_input_tokens', { mode: 'number' }),
  rawUsage: text('raw_usage'),
  pricingSnapshot: text('pricing_snapshot'),
  estimatedCost: numeric('estimated_cost', { precision: 24, scale: 12 }),
  costComplete: boolean('cost_complete').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (table) => [uniqueIndex('paper_model_calls_run_call_idx').on(table.paperRunId, table.callId),
  foreignKey({name:'paper_calls_version_config_fk',columns:[table.modelVersionId,table.modelConfigId],foreignColumns:[llmModelConfigVersions.id,llmModelConfigVersions.configId]})]);

export const paperTradeDecisions = pgTable(
  'paper_trade_decisions',
  {
    id: serial('id').primaryKey(),
    portfolioId: integer('portfolio_id')
      .notNull()
      .references(() => paperPortfolios.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    paperAnalysisRunId: integer('paper_analysis_run_id')
      .notNull()
      .references(() => paperAnalysisRuns.id),
    analysisJobId: integer('analysis_job_id')
      .notNull()
      .references(() => analysisJobs.id),
    ticker: varchar('ticker', { length: 40 }).notNull(),
    action: varchar('action', { length: 12 }).notNull(),
    confidenceBps: integer('confidence_bps').notNull().default(0),
    targetWeightBps: integer('target_weight_bps').notNull().default(0),
    quantity: integer('quantity').notNull().default(0),
    priceCents: cents('price_cents').notNull().default(0),
    reason: text('reason'),
    riskNotes: text('risk_notes'),
    rawResponse: text('raw_response'),
    status: varchar('status', { length: 30 }).notNull().default('proposed'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    executedAt: timestamp('executed_at'),
  },
  (table) => [
    uniqueIndex('paper_decisions_id_scope_idx').on(table.id,table.portfolioId,table.userId),
    foreignKey({name:'paper_decisions_portfolio_owner_fk',columns:[table.portfolioId,table.userId],foreignColumns:[paperPortfolios.id,paperPortfolios.userId]}),
    foreignKey({name:'paper_decisions_run_scope_job_fk',columns:[table.paperAnalysisRunId,table.portfolioId,table.userId,table.analysisJobId],foreignColumns:[paperAnalysisRuns.id,paperAnalysisRuns.portfolioId,paperAnalysisRuns.userId,paperAnalysisRuns.analysisJobId]}),
    check('paper_trade_decisions_priceCents_safe', sql`${table.priceCents} BETWEEN -9007199254740991 AND 9007199254740991`),

    uniqueIndex('paper_trade_decisions_analysis_run_idx').on(table.paperAnalysisRunId),
    index('paper_trade_decisions_portfolio_created_idx').on(table.portfolioId, table.createdAt),
    index('paper_trade_decisions_user_created_idx').on(table.userId, table.createdAt),
    index('paper_trade_decisions_status_idx').on(table.status),
  ]
);

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: serial('id').primaryKey(),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', { length: 120 }).notNull(),
    targetType: varchar('target_type', { length: 80 }).notNull(),
    targetId: integer('target_id'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_logs_created_at_idx').on(table.createdAt),
    index('admin_audit_logs_target_idx').on(table.targetType, table.targetId),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  activityLogs: many(activityLogs),
  analysisJobs: many(analysisJobs),
  analysisReports: many(analysisReports),
  creditTransactions: many(creditTransactions),
  watchlistItems: many(watchlistItems),
  paperPortfolios: many(paperPortfolios),
  paperPositions: many(paperPositions),
  paperTrades: many(paperTrades),
  paperAnalysisRuns: many(paperAnalysisRuns),
  paperTradeDecisions: many(paperTradeDecisions),
  adminAuditLogs: many(adminAuditLogs),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export const analysisJobsRelations = relations(analysisJobs, ({ one, many }) => ({
  user: one(users, {
    fields: [analysisJobs.userId],
    references: [users.id],
  }),
  reports: many(analysisReports),
  creditTransactions: many(creditTransactions),

  paperAnalysisRun: many(paperAnalysisRuns),
  paperTradeDecisions: many(paperTradeDecisions),
}));

export const llmModelConfigsRelations = relations(llmModelConfigs, ({ many }) => ({
  analysisJobs: many(analysisJobs),
}));

export const analysisReportsRelations = relations(analysisReports, ({ one }) => ({
  job: one(analysisJobs, {
    fields: [analysisReports.jobId],
    references: [analysisJobs.id],
  }),
  user: one(users, {
    fields: [analysisReports.userId],
    references: [users.id],
  }),
}));

export const creditTransactionsRelations = relations(creditTransactions, ({ one }) => ({
  user: one(users, {
    fields: [creditTransactions.userId],
    references: [users.id],
  }),
  job: one(analysisJobs, {
    fields: [creditTransactions.jobId],
    references: [analysisJobs.id],
  }),
}));

export const watchlistItemsRelations = relations(watchlistItems, ({ one }) => ({
  user: one(users, {
    fields: [watchlistItems.userId],
    references: [users.id],
  }),
}));

export const paperPortfoliosRelations = relations(paperPortfolios, ({ one, many }) => ({
  user: one(users, {
    fields: [paperPortfolios.userId],
    references: [users.id],
  }),
  positions: many(paperPositions),
  trades: many(paperTrades),
  analysisRuns: many(paperAnalysisRuns),
  tradeDecisions: many(paperTradeDecisions),
}));

export const paperPositionsRelations = relations(paperPositions, ({ one, many }) => ({
  portfolio: one(paperPortfolios, {
    fields: [paperPositions.portfolioId],
    references: [paperPortfolios.id],
  }),
  user: one(users, {
    fields: [paperPositions.userId],
    references: [users.id],
  }),
  trades: many(paperTrades),
}));

export const paperTradesRelations = relations(paperTrades, ({ one }) => ({
  portfolio: one(paperPortfolios, {
    fields: [paperTrades.portfolioId],
    references: [paperPortfolios.id],
  }),
  user: one(users, {
    fields: [paperTrades.userId],
    references: [users.id],
  }),
  position: one(paperPositions, {
    fields: [paperTrades.positionId],
    references: [paperPositions.id],
  }),
}));

export const paperAnalysisRunsRelations = relations(paperAnalysisRuns, ({ one }) => ({
  portfolio: one(paperPortfolios, {
    fields: [paperAnalysisRuns.portfolioId],
    references: [paperPortfolios.id],
  }),
  user: one(users, {
    fields: [paperAnalysisRuns.userId],
    references: [users.id],
  }),
  watchlistItem: one(watchlistItems, {
    fields: [paperAnalysisRuns.watchlistItemId],
    references: [watchlistItems.id],
  }),
  analysisJob: one(analysisJobs, {
    fields: [paperAnalysisRuns.analysisJobId],
    references: [analysisJobs.id],
  }),
  tradeDecision: one(paperTradeDecisions, {
    fields: [paperAnalysisRuns.id],
    references: [paperTradeDecisions.paperAnalysisRunId],
  }),
}));

export const paperTradeDecisionsRelations = relations(paperTradeDecisions, ({ one }) => ({
  portfolio: one(paperPortfolios, {
    fields: [paperTradeDecisions.portfolioId],
    references: [paperPortfolios.id],
  }),
  user: one(users, {
    fields: [paperTradeDecisions.userId],
    references: [users.id],
  }),
  paperAnalysisRun: one(paperAnalysisRuns, {
    fields: [paperTradeDecisions.paperAnalysisRunId],
    references: [paperAnalysisRuns.id],
  }),
  analysisJob: one(analysisJobs, {
    fields: [paperTradeDecisions.analysisJobId],
    references: [analysisJobs.id],
  }),
}));

export const adminAuditLogsRelations = relations(adminAuditLogs, ({ one }) => ({
  adminUser: one(users, {
    fields: [adminAuditLogs.adminUserId],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type NewAnalysisJob = typeof analysisJobs.$inferInsert;
export type LlmModelConfig = typeof llmModelConfigs.$inferSelect & Pick<typeof llmModelConfigVersions.$inferSelect, 'provider' | 'baseUrl' | 'modelName' | 'modelOptions' | 'inputPrice' | 'cachePrice' | 'outputPrice'> & { apiKey: string; modelVersionId: number };
export type NewLlmModelConfig = typeof llmModelConfigs.$inferInsert;
export type AnalysisReport = typeof analysisReports.$inferSelect;
export type NewAnalysisReport = typeof analysisReports.$inferInsert;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type NewCreditTransaction = typeof creditTransactions.$inferInsert;
export type AnalysisPricing = typeof analysisPricing.$inferSelect;
export type NewAnalysisPricing = typeof analysisPricing.$inferInsert;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type NewWatchlistItem = typeof watchlistItems.$inferInsert;
export type PaperPortfolio = typeof paperPortfolios.$inferSelect;
export type NewPaperPortfolio = typeof paperPortfolios.$inferInsert;
export type PaperPosition = typeof paperPositions.$inferSelect;
export type NewPaperPosition = typeof paperPositions.$inferInsert;
export type PaperTrade = typeof paperTrades.$inferSelect;
export type NewPaperTrade = typeof paperTrades.$inferInsert;
export type PaperAnalysisRun = typeof paperAnalysisRuns.$inferSelect;
export type NewPaperAnalysisRun = typeof paperAnalysisRuns.$inferInsert;
export type PaperTradeDecision = typeof paperTradeDecisions.$inferSelect;
export type NewPaperTradeDecision = typeof paperTradeDecisions.$inferInsert;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLogs.$inferInsert;

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_TEAM = 'CREATE_TEAM',
  REMOVE_TEAM_MEMBER = 'REMOVE_TEAM_MEMBER',
  INVITE_TEAM_MEMBER = 'INVITE_TEAM_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
  INVITE_CODE_REWARD = 'INVITE_CODE_REWARD',
}

export const analysisModelCalls = pgTable('analysis_model_calls', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => analysisJobs.id, { onDelete: 'cascade' }),
  callId: varchar('call_id', { length: 100 }).notNull(),
  agent: varchar('agent', { length: 160 }).notNull(),
  model: text('model').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('legacy'),
  modelConfigId: integer('model_config_id'),
  modelVersionId: integer('model_version_id').references(() => llmModelConfigVersions.id),
  costCurrency: varchar('cost_currency', { length: 3 }),
  provider: varchar('provider', { length: 80 }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  status: varchar('status', { length: 30 }).notNull(),
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  totalTokens: bigint('total_tokens', { mode: 'number' }),
  usageAvailable: boolean('usage_available').notNull().default(false),
  cachedInputTokens: bigint('cached_input_tokens', { mode: 'number' }),
  rawUsage: text('raw_usage'),
  pricingSnapshot: text('pricing_snapshot'),
  estimatedCost: numeric('estimated_cost', { precision: 24, scale: 12 }),
  costComplete: boolean('cost_complete').notNull().default(false),
  isRetry: boolean('is_retry').notNull().default(false),
  requestKind: varchar('request_kind', { length: 30 }).notNull().default('standard'),
}, (table) => [uniqueIndex('analysis_model_calls_job_call_idx').on(table.jobId, table.callId),
  foreignKey({name:'analysis_calls_version_config_fk',columns:[table.modelVersionId,table.modelConfigId],foreignColumns:[llmModelConfigVersions.id,llmModelConfigVersions.configId]})]);

export const analysisDecisions = pgTable('analysis_decisions', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().unique().references(() => analysisJobs.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 8 }),
  summary: text('summary'),
  extractionStatus: varchar('extraction_status', { length: 20 }).notNull(),
  extractionVersion: integer('extraction_version').notNull().default(1),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('analysis_decisions_action_valid', sql`${t.action} in ('buy','sell','hold')`),
  check('analysis_decisions_status_valid', sql`${t.extractionStatus} in ('pending','succeeded','unrecognized','failed')`)]);

export const signupEmailVerifications = pgTable('signup_email_verifications', {
  email: varchar('email', { length: 255 }).primaryKey(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
});
export const signupEmailLimits = pgTable('signup_email_limits', {
  scope: varchar('scope', { length: 80 }).primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull(),
});

export const analysisJobResumptions = pgTable('analysis_job_resumptions', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull(),
  userId: integer('user_id').notNull().references(() => users.id),
  previousQuickModel: varchar('previous_quick_model', { length: 160 }),
  previousDeepModel: varchar('previous_deep_model', { length: 160 }),
  nextQuickModel: varchar('next_quick_model', { length: 160 }).notNull(),
  nextDeepModel: varchar('next_deep_model', { length: 160 }).notNull(),
  previousQuickConfigSnapshot: text('previous_quick_config_snapshot'),
  previousDeepConfigSnapshot: text('previous_deep_config_snapshot'),
  nextQuickConfigSnapshot: text('next_quick_config_snapshot').notNull(),
  nextDeepConfigSnapshot: text('next_deep_config_snapshot').notNull(),
  previousQuickVersionId: integer('previous_quick_version_id').references(() => llmModelConfigVersions.id),
  previousDeepVersionId: integer('previous_deep_version_id').references(() => llmModelConfigVersions.id),
  nextQuickVersionId: integer('next_quick_version_id').references(() => llmModelConfigVersions.id),
  nextDeepVersionId: integer('next_deep_version_id').references(() => llmModelConfigVersions.id),
  configurationState: text('configuration_state').notNull().default('legacy_unknown'),
  initiator: text('initiator').notNull().default('legacy_unknown'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [foreignKey({name:'analysis_resumptions_job_owner_fk',columns:[t.jobId,t.userId],foreignColumns:[analysisJobs.id,analysisJobs.userId]}),
  check('analysis_resumptions_initiator_valid', sql`${t.initiator} IN ('user','automatic','admin','legacy_unknown')`),
  check('analysis_resumptions_state_valid', sql`(${t.configurationState} = 'legacy_unknown' AND ${t.nextQuickVersionId} IS NULL AND ${t.nextDeepVersionId} IS NULL) OR (${t.configurationState} = 'versioned' AND ${t.nextQuickVersionId} IS NOT NULL AND ${t.nextDeepVersionId} IS NOT NULL)`),
  index('analysis_resumptions_job_created_idx').on(t.jobId,t.createdAt)]);
