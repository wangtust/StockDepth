const path = require('node:path');
const modules = path.resolve(__dirname, '../apps/web/node_modules');
const { z } = require(path.join(modules, 'zod'));
const { hash } = require(path.join(modules, 'bcryptjs'));

async function initializeAdmin(sql, config) {
  const existing = await sql`select id from users where role in ('admin', 'super_admin') and deleted_at is null limit 1`;
  if (existing.length) {
    console.log('管理员已存在：保留现有账户和密码。');
    return;
  }
  const email = config.STOCKDEPTH_ADMIN_EMAIL?.trim();
  const password = config.STOCKDEPTH_ADMIN_PASSWORD;
  if (!email && !password) {
    console.log('未配置初始管理员：可在 .env 设置 STOCKDEPTH_ADMIN_EMAIL 和 STOCKDEPTH_ADMIN_PASSWORD。');
    return;
  }
  if (!z.string().email().max(255).safeParse(email).success) {
    throw new Error('请在 .env 配置有效的 STOCKDEPTH_ADMIN_EMAIL');
  }
  if (!z.string().min(8).max(100).safeParse(password).success || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('STOCKDEPTH_ADMIN_PASSWORD 须为 8–100 个字符，且 UTF-8 长度不超过 72 字节');
  }
  const matches = await sql`select id from users where email = ${email} limit 1`;
  if (matches.length) {
    throw new Error('初始管理员邮箱已被现有账户使用，请使用其他 STOCKDEPTH_ADMIN_EMAIL');
  }
  const passwordHash = await hash(password, 10);
  await sql.begin(async tx => {
    const [created] = await tx`insert into users (email, password_hash, role, analysis_credits) values (${email}, ${passwordHash}, 'super_admin', 0) returning id,analysis_credits`;
    await tx`select user_id from billing_accounts where user_id = ${created.id} for update`;
    await tx`insert into credit_transactions (user_id,amount,reason,ledger_sequence,balance_after,operation_key)
      values (${created.id},10,'initial_admin_grant',1,10,${`initial-grant:${created.id}`})`;
    await tx`update billing_accounts set analysis_credits=10,ledger_sequence=1,updated_at=now() where user_id=${created.id}`;
    await tx`update users set analysis_credits=10,updated_at=now() where id=${created.id}`;
  });
  console.log('已根据 .env 创建初始管理员。');
}

module.exports = { initializeAdmin };
