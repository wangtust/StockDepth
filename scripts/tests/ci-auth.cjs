// Real auth/session/middleware source with synthetic users and cookie storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'apps/web/package.json'));
const ts = req('typescript'), jose = req('jose'), next = req('next/server');
function compile(file, mocks) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
  }).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', source)(name => name in mocks ? mocks[name] : req(name), module, module.exports);
  return module.exports;
}
process.env.AUTH_SECRET = 'ci-synthetic-auth-signing-key-32-bytes';
process.env.BASE_URL = 'https://ci.example.test';
let cookie;
const session = compile('apps/web/lib/auth/session.ts', {'next/headers': {cookies: async () => ({
  get: () => cookie && {value: cookie.value}, set: (name, value, options) => { cookie = {name, value, options}; },
})}});
let user = null;
const admin = compile('apps/web/lib/auth/admin.ts', {
  '@/lib/db/queries': {getUser: async () => user}, '@/lib/db/drizzle': {db: {}}, '@/lib/db/schema': {},
});
let role = null;
const middleware = compile('apps/web/middleware.ts', {
  '@/lib/auth/session': session, '@/lib/db/drizzle': {db: {select: () => ({from: () => ({where: () => ({limit: async () => role ? [{role}] : []})})})}},
  '@/lib/db/schema': {users: {}}, 'drizzle-orm': {and() {}, eq() {}, isNull() {}},
}).middleware;
async function main() {
  assert.equal(await session.getSession(), null);
  await session.setSession({id: 42});
  assert.equal((await session.verifyToken(cookie.value)).user.id, 42);
  assert.deepEqual([cookie.options.httpOnly, cookie.options.secure, cookie.options.sameSite], [true, true, 'lax']);
  process.env.BASE_URL = 'http://127.0.0.1:3000'; assert.equal(session.shouldUseSecureCookies(), false);
  const token = cookie.value;
  await assert.rejects(session.verifyToken(token.slice(0, -8) + 'tampered'));
  const key = new TextEncoder().encode(process.env.AUTH_SECRET);
  const expired = await new jose.SignJWT({user: {id: 42}}).setProtectedHeader({alg: 'HS256'}).setExpirationTime(1).sign(key);
  await assert.rejects(session.verifyToken(expired));
  const wrongAlgorithm = await new jose.SignJWT({user: {id: 42}}).setProtectedHeader({alg: 'HS384'}).setExpirationTime('1h').sign(key);
  await assert.rejects(session.verifyToken(wrongAlgorithm));
  async function request(route, value) {
    return middleware(new next.NextRequest('https://ci.example.test' + route, {headers: value ? {cookie: 'session=' + value} : {}}));
  }
  assert.equal(new URL((await request('/dashboard')).headers.get('location')).pathname, '/sign-in');
  // Invalid tokens log their error by design; suppress expected diagnostics in this synthetic test.
  const original = console.error;
  try {
    console.error = () => {};
    assert.equal(new URL((await request('/admin', expired)).headers.get('location')).pathname, '/sign-in');
    assert.equal(new URL((await request('/admin', 'malformed')).headers.get('location')).pathname, '/sign-in');
  } finally { console.error = original; }
  role = null;
  assert.equal(new URL((await request('/dashboard', token)).headers.get('location')).pathname, '/sign-in');
  role = 'member';
  assert.equal(new URL((await request('/admin', token)).headers.get('location')).pathname, '/dashboard');
  assert.equal((await request('/dashboard', token)).headers.get('x-middleware-next'), '1');
  for (const value of [null, {id: 42, role: 'member', status: 'active'}, {id: 42, role: 'admin', status: 'disabled'}]) {
    user = value; assert.equal((await admin.requirePlatformAdminForApi()).status, 403);
  }
  for (const value of ['admin', 'super_admin']) {
    user = {id: 42, role: value, status: 'active'}; role = value;
    assert.equal(await admin.requirePlatformAdminForApi(), user);
    assert.equal((await request('/admin', token)).headers.get('x-middleware-next'), '1');
    assert.equal(new URL((await request('/sign-in', token)).headers.get('location')).pathname, '/admin');
  }
  assert.equal(admin.isSuperAdmin({role: 'admin', status: 'active'}), false);
  console.log('PASS JWT tamper/expiry/algorithm, secure cookies, anonymous/disabled/member/admin/super-admin middleware and API permission source regression; synthetic DB/cookies, no server');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
