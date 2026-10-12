import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  inviteCode: varchar('invite_code', { length: 6 }).unique(),
  analysisCredits: integer('analysis_credits').notNull().default(10),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

export const analysisJobs = pgTable(
  'analysis_jobs',
  {
    id: serial('id').primaryKey(),
    runId: varchar('run_id', { length: 120 }).notNull().unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    ticker: varchar('ticker', { length: 40 }).notNull(),
    tradeDate: varchar('trade_date', { length: 20 }).notNull(),
    realtimeData: boolean('realtime_data').notNull().default(false),
    language: varchar('language', { length: 40 }).notNull().default('Chinese'),
    depth: integer('depth').notNull().default(1),
    analysts: text('analysts').notNull(),
    provider: varchar('provider', { length: 80 }),
    baseUrl: text('base_url'),
    quickModel: varchar('quick_model', { length: 160 }),
    deepModel: varchar('deep_model', { length: 160 }),
    modelConfigId: integer('model_config_id').references(() => llmModelConfigs.id),
    status: varchar('status', { length: 30 }).notNull().default('queued'),
    externalStatus: varchar('external_status', { length: 30 }),
    externalPid: integer('external_pid'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    hiddenAt: timestamp('hidden_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('analysis_jobs_status_created_at_idx').on(table.status, table.createdAt),
    index('analysis_jobs_user_created_at_idx').on(table.userId, table.createdAt),
  ]
);

export const analysisWorkerSettings = pgTable('analysis_worker_settings', {
  key: varchar('key', { length: 50 }).primaryKey(),
  systemConcurrency: integer('system_concurrency').notNull().default(1),
  userConcurrency: integer('user_concurrency').notNull().default(1),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const llmModelConfigs = pgTable('llm_model_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  provider: varchar('provider', { length: 80 }).notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  quickModel: varchar('quick_model', { length: 160 }).notNull(),
  deepModel: varchar('deep_model', { length: 160 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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
});

export const creditTransactions = pgTable('credit_transactions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  jobId: integer('job_id').references(() => analysisJobs.id),
  amount: integer('amount').notNull(),
  reason: varchar('reason', { length: 80 }).notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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
    ticker: varchar('ticker', { length: 40 }).notNull(),
    market: varchar('market', { length: 40 }),
    name: varchar('name', { length: 160 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
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
    initialCashCents: integer('initial_cash_cents').notNull(),
    cashCents: integer('cash_cents').notNull(),
    currency: varchar('currency', { length: 12 }).notNull().default('USD'),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    autoTradeEnabled: boolean('auto_trade_enabled').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('paper_portfolios_user_status_idx').on(table.userId, table.status),
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
    ticker: varchar('ticker', { length: 40 }).notNull(),
    quantity: integer('quantity').notNull().default(0),
    avgCostCents: integer('avg_cost_cents').notNull().default(0),
    lastPriceCents: integer('last_price_cents').notNull().default(0),
    realizedPnlCents: integer('realized_pnl_cents').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('paper_positions_portfolio_ticker_idx').on(table.portfolioId, table.ticker),
    index('paper_positions_user_idx').on(table.userId),
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
    ticker: varchar('ticker', { length: 40 }).notNull(),
    side: varchar('side', { length: 12 }).notNull(),
    quantity: integer('quantity').notNull(),
    priceCents: integer('price_cents').notNull(),
    grossAmountCents: integer('gross_amount_cents').notNull(),
    feeCents: integer('fee_cents').notNull().default(0),
    realizedPnlCents: integer('realized_pnl_cents').notNull().default(0),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('paper_trades_portfolio_created_idx').on(table.portfolioId, table.createdAt),
    index('paper_trades_user_created_idx').on(table.userId, table.createdAt),
  ]
);

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
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('paper_analysis_runs_job_idx').on(table.analysisJobId),
    index('paper_analysis_runs_portfolio_created_idx').on(table.portfolioId, table.createdAt),
    index('paper_analysis_runs_user_created_idx').on(table.userId, table.createdAt),
  ]
);

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
    priceCents: integer('price_cents').notNull().default(0),
    reason: text('reason'),
    riskNotes: text('risk_notes'),
    rawResponse: text('raw_response'),
    status: varchar('status', { length: 30 }).notNull().default('proposed'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    executedAt: timestamp('executed_at'),
  },
  (table) => [
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
  modelConfig: one(llmModelConfigs, {
    fields: [analysisJobs.modelConfigId],
    references: [llmModelConfigs.id],
  }),
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
export type LlmModelConfig = typeof llmModelConfigs.$inferSelect;
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
