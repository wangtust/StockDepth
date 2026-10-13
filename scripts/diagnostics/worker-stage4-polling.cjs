// Existing contract regressions, with all output redirected into this stage.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=root+'/var/performance/stage4-worker',esbuild=require(root+'/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild');
(async()=>{const source=fs.readFileSync(root+'/apps/workers/tests/stage2-version-polling.ts','utf8').replaceAll('var/performance/stage2-worker','var/performance/stage4-worker');
await esbuild.build({stdin:{contents:source,loader:'ts',resolveDir:root+'/apps/workers/tests'},bundle:true,platform:'node',format:'cjs',outfile:out+'/polling-fixture.cjs'});
try{const result=spawnSync(process.execPath,[out+'/polling-fixture.cjs'],{cwd:root+'/apps/workers',env:{PATH:process.env.PATH},stdio:'inherit',timeout:30000});assert.equal(result.status,0);}finally{fs.rmSync(out+'/polling-fixture.cjs',{force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
