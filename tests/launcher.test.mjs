import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function command(args, env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve('scripts/launch.mjs'), ...args], { env: { ...process.env, ...env }, windowsHide: true });
    let output = '';
    child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Launcher command did not finish')); }, 45000);
    child.on('error', reject); child.on('exit', code => { clearTimeout(timer); done({ code, output }); });
  });
}
test('launcher refuses an occupied port without terminating its owner', { timeout: 50000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sehat-launch-test-'));
  const otherApp = createServer((_req,res) => res.end('unrelated application'));
  await new Promise(r => otherApp.listen(0, '127.0.0.1', r));
  const port = otherApp.address().port;
  try {
    const result = await command(['--background', '--no-open', '--skip-build', '--port', String(port)], { SEHAT_LAUNCH_STATE_DIR: dir });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /already in use/i);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'unrelated application');
  } finally { await new Promise(r => otherApp.close(r)); await rm(dir, { recursive: true, force: true }); }
});
test('stop with no managed instance is harmless and succeeds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sehat-launch-test-'));
  try { const result = await command(['--stop'], { SEHAT_LAUNCH_STATE_DIR: dir }); assert.equal(result.code,0); assert.match(result.output,/no managed|not running/i); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('background launch serves both UI and API, reuses itself, and stops only its own child', {timeout:50000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sehat-launch-test-'));
  const probe=createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port; await new Promise(r=>probe.close(r));
  const env={SEHAT_LAUNCH_STATE_DIR:dir,DATA_DIR:join(dir,'data'),NVIDIA_API_KEY:''};
  try {
    const first=await command(['--background','--no-open','--skip-build','--port',String(port)],env);
    assert.equal(first.code,0,first.output); assert.match(first.output,/Sehat is ready/);
    assert.equal((await(await fetch(`http://127.0.0.1:${port}/api/health`)).json()).service,'Sehat local API');
    assert.match(await(await fetch(`http://127.0.0.1:${port}/`)).text(),/<title>Sehat/);
    const state=JSON.parse(await readFile(join(dir,'instance.json'),'utf8'));
    const rejected=await fetch(`http://127.0.0.1:${state.controlPort}/stop`,{method:'POST'});
    assert.equal(rejected.status,403);
    const second=await command(['--background','--no-open','--skip-build','--port',String(port)],env);
    assert.equal(second.code,0,second.output); assert.match(second.output,/already ready/);
    const same=JSON.parse(await readFile(join(dir,'instance.json'),'utf8')); assert.equal(same.pid,state.pid);
    const stopped=await command(['--stop'],env); assert.equal(stopped.code,0,stopped.output);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1500)}));
  } finally {await command(['--stop'],env); await rm(dir,{recursive:true,force:true});}
});
