// Reuse preserved prior tests without editing their scripts or log locations.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=root+'/var/performance/stage4-worker';
for(const [name,file,runtime] of [
 ['stability','worker-stage3-regression.cjs',root+'/var/codex-performance-team/stage2-coordinator-runtime'],
 ['admission','worker-stage3-tests.cjs',root+'/apps/workers/node_modules/.bin'],
 ['sync','worker-stage3-sync.cjs',root+'/apps/workers/node_modules/.bin'],
 ['permissions','worker-stage3-permissions.cjs',root+'/apps/workers/node_modules/.bin']
]){
const filename=root+'/scripts/diagnostics/'+file;
let source=fs.readFileSync(filename,'utf8').replaceAll("'/var/performance/stage3-worker'","'/var/performance/stage4-worker'");
const runner=`const Module=require('node:module');const m=new Module(${JSON.stringify(filename)});m.filename=${JSON.stringify(filename)};m.paths=Module._nodeModulePaths(${JSON.stringify(path.dirname(filename))});m._compile(${JSON.stringify(source)},${JSON.stringify(filename)});`;
const log=fs.openSync(out+'/'+name+'.log','w');const result=spawnSync(process.execPath,['-e',runner],{cwd:root,env:{...process.env,STOCKDEPTH_RUNTIME_BIN:runtime},stdio:['ignore',log,log],timeout:90000});fs.closeSync(log);assert.equal(result.status,0,name+' failed');console.log(name+' passed');
}
