import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is not set');
}

// Next.js development reloads modules; retain the pool instead of leaking one per reload.
const databaseGlobal = globalThis as typeof globalThis & {
  stockdepthDatabaseClient?: ReturnType<typeof postgres>;
};
const poolSize = Number(process.env.STOCKDEPTH_DB_POOL_SIZE || 5);
function createDatabaseClient() {
  const pool = postgres(process.env.POSTGRES_URL!, {
    max: Number.isInteger(poolSize) && poolSize > 0 ? poolSize : 5,
    idle_timeout: 30,
    connect_timeout: 10,
    connection: { TimeZone: 'UTC', application_name: 'stockdepth' }
  });
  // Drizzle 0.43 calls unsafe(), whose postgres-js default disables preparation.
  // Retain parameter types/plans on each connection to avoid a Describe round trip.
  const unsafe = pool.unsafe.bind(pool);
  pool.unsafe = ((query, parameters, options) => unsafe(query, parameters, {
    prepare: process.env.STOCKDEPTH_DB_PREPARE !== 'false', ...options
  })) as typeof pool.unsafe;
  return pool;
}
export const client = databaseGlobal.stockdepthDatabaseClient ?? createDatabaseClient();
databaseGlobal.stockdepthDatabaseClient = client;
export const db = drizzle(client, { schema });
