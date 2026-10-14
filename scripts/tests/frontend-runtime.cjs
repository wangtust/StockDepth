// Public workspace dependency resolution; never use pnpm's internal store layout.
const {createRequire} = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const webRequire = createRequire(path.resolve(__dirname, '../../apps/web/package.json'));
exports.dependency = name => webRequire(name);
exports.chromium = () => {
  const executable = process.env.FRONTEND_CHROMIUM || webRequire('playwright').chromium.executablePath();
  fs.accessSync(executable, fs.constants.X_OK);
  return executable;
};
