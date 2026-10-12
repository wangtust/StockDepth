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
export const client = databaseGlobal.stockdepthDatabaseClient ?? postgres(process.env.POSTGRES_URL, { connection: { TimeZone: 'UTC' } });
if (process.env.NODE_ENV !== 'production') databaseGlobal.stockdepthDatabaseClient = client;
export const db = drizzle(client, { schema });
