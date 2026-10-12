// Run checked-in schema changes before starting any application process.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const modules = path.join(root, 'apps/web/node_modules');
require(path.join(modules, 'dotenv')).config({ path: path.join(root, '.env') });
const postgres = require(path.join(modules, 'postgres'));
const { drizzle } = require(path.join(modules, 'drizzle-orm/postgres-js'));
const { migrate } = require(path.join(modules, 'drizzle-orm/postgres-js/migrator'));

async function initialize() {
  if (!process.env.POSTGRES_URL) throw new Error('请在根目录 .env 配置 POSTGRES_URL');
  // One connection keeps the advisory lock on the migration's session.
  const sql = postgres(process.env.POSTGRES_URL, { max: 1, connect_timeout: 10, idle_timeout: 0 });
  let locked = false;
  try {
    await sql`select pg_advisory_lock(739421, 1)`;
    locked = true;
    const before = await sql`select tablename from pg_tables where schemaname = 'public'`;
    console.log(before.length ? '数据库：检查并补齐项目结构更新…' : '数据库为空：正在创建项目表格…');
    await migrate(drizzle(sql), { migrationsFolder: path.join(root, 'apps/web/lib/db/migrations') });
    const schema = fs.readFileSync(path.join(root, 'apps/web/lib/db/schema.ts'), 'utf8');
    const expected = [...schema.matchAll(/pgTable\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    const rows = await sql`select tablename from pg_tables where schemaname = 'public'`;
    const actual = new Set(rows.map(row => row.tablename));
    const missing = expected.filter(name => !actual.has(name));
    if (missing.length) throw new Error('数据库结构不完整，缺少表：' + missing.join(', '));
    console.log(`数据库就绪：已验证 ${expected.length} 张项目表。`);
  } finally {
    if (locked) await sql`select pg_advisory_unlock(739421, 1)`;
    await sql.end();
  }
}

initialize().catch(error => {
  // Avoid exposing database passwords in connection errors.
  const url = process.env.POSTGRES_URL;
  let message = error.message;
  if (url) {
    message = message.split(url).join('<数据库连接>');
    try {
      const password = decodeURIComponent(new URL(url).password);
      if (password) message = message.split(password).join('<隐藏>');
    } catch {}
  }
  console.error('数据库初始化失败：' + message);
  process.exitCode = 1;
});
