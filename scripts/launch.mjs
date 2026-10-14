// One controller owns one server, serving the built interface and API together.
// Stop targets this authenticated controller, never an arbitrary port owner.
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const stateDir = resolve(process.env.SEHAT_LAUNCH_STATE_DIR || resolve(root, '.tmp', 'launcher'));
const stateFile = resolve(stateDir, 'instance.json');
const lockFile = resolve(stateDir, 'starting.json');
const envPath = resolve(root, '.env');
const configuration = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
const env = { ...configuration, ...process.env };
const port = Number(flag('--port') ? args[args.indexOf('--port') + 1] : env.PORT || 3001);
const url = `http://127.0.0.1:${port}`;
const say = message => process.stdout.write(`${message}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let child, control, stopping = false, instance, ownsLock = false;

function acquireStartupLock() {
  for (let attempt=0;attempt<2;attempt++) {
    try {
      const handle=openSync(lockFile,'wx',0o600);
      writeFileSync(handle,JSON.stringify({pid:process.pid})); closeSync(handle); ownsLock=true; return;
    } catch(error) {
      if(error.code!=='EEXIST')throw error;
      let owner;
      try {owner=JSON.parse(readFileSync(lockFile,'utf8'));} catch {throw new Error('A launch is already starting. Wait a moment and retry.');}
      let alive=true;
      try {process.kill(owner.pid,0);} catch(error) {alive=error.code!=='ESRCH';}
      if(alive)throw new Error('A launch is already starting. Wait for its build to finish.');
      try {unlinkSync(lockFile);} catch {}
    }
  }
  throw new Error('Could not acquire the launcher lock. Retry in a moment.');
}
function releaseStartupLock() {if(ownsLock){try{unlinkSync(lockFile);}catch{} ownsLock=false;}}

function readState() { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; } }
async function controlRequest(state, action = 'status') {
  if (!state || !Number.isInteger(state.controlPort) || typeof state.token !== 'string') return null;
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET', headers: { 'X-Sehat-Token': state.token }, signal: AbortSignal.timeout(1800),
    });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
async function stopManaged() {
  const state = readState(); const current = await controlRequest(state);
  if (!current || current.root !== root) { say('No managed Sehat instance is running. No other process was stopped.'); return; }
  await controlRequest(state, 'stop');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await controlRequest(state))) { say('Sehat stopped. Your saved records are unchanged.'); return; }
    await sleep(150);
  }
  throw new Error('Sehat has not stopped yet. Try STOP_SEHAT.bat again.');
}
function portBusy() {
  return new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port }); socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => { socket.destroy(); done(false); });
    socket.once('timeout', () => { socket.destroy(); done(true); });
  });
}
async function serviceReady() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
    const health = await response.json();
    if (!response.ok || !health.ok || health.service !== 'Sehat local API') return false;
    const html = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return html.ok && (await html.text()).includes('<title>Sehat');
  } catch { return false; }
}
function openBrowser(address) {
  if (flag('--no-open')) return;
  const [command, options] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${address}'`]]
    : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
  const opener = spawn(command, options, { stdio: 'ignore', detached: true, windowsHide: true });
  opener.on('error', () => say(`Open ${address} in your browser.`)); opener.unref();
}
function runNpm(command) {
  return new Promise((done,reject) => {
    const task = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', command, {
      cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32', windowsHide: true,
    });
    task.on('error', reject); task.on('exit', code => code === 0 ? done() : reject(new Error(`npm ${command.join(' ')} failed. See output above.`)));
  });
}
async function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(r => child.once('exit', r)), sleep(4000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (instance && readState()?.token === instance.token) { try { unlinkSync(stateFile); } catch {} }
  releaseStartupLock();
  control?.close(); process.exit(code);
}
async function serve() {
  instance = { root, url, controlPort: 0, token: randomBytes(32).toString('hex'), pid: process.pid, ready: false };
  control = createServer((req, res) => {
    const sent = Buffer.from(String(req.headers['x-sehat-token'] || '')); const secret = Buffer.from(instance.token);
    if (sent.length !== secret.length || !timingSafeEqual(sent, secret)) { res.writeHead(403); res.end(); return; }
    if (req.url === '/status' && req.method === 'GET') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({root,url,ready:instance.ready})); return; }
    if (req.url === '/stop' && req.method === 'POST') { res.end('{"stopping":true}'); setImmediate(() => shutdown()); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(r => control.listen(0, '127.0.0.1', r)); instance.controlPort = control.address().port;
  writeFileSync(stateFile, JSON.stringify(instance), { mode: 0o600 });
  child = spawn(process.execPath, [resolve(root,'server','index.mjs')], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...env, PORT: String(port), HOST: '127.0.0.1' },
  });
  child.on('error', error => { say(`Server could not start: ${error.message}`); shutdown(1); });
  child.on('exit', code => { if (!stopping) { say(`Sehat server exited (${code}).`); shutdown(code || 1); } });
  process.once('SIGINT', () => shutdown()); process.once('SIGTERM', () => shutdown());
  for (let i = 0; i < 100; i++) {
    if (await serviceReady()) {
      instance.ready = true; writeFileSync(stateFile, JSON.stringify(instance), { mode: 0o600 });
      say(`Sehat is ready at ${url}`); say('Interface and API run together. Stop with STOP_SEHAT.bat or npm run stop.');
      openBrowser(url); return;
    }
    await sleep(300);
  }
  throw new Error('Sehat did not become healthy within 30 seconds. Check the launcher logs.');
}
async function main() {
  if (flag('--stop')) return stopManaged();
  if (flag('--status')) { const state = await controlRequest(readState()); say(state?.ready ? `Sehat is ready at ${state.url}` : 'Sehat is not running.'); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Sehat requires Node.js 24 or newer.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  mkdirSync(stateDir, { recursive: true });
  if (flag('--controller')) return serve();
  acquireStartupLock();
  if (flag('--restart')) await stopManaged();
  const current = await controlRequest(readState());
  if (current?.root === root && current.ready) { say(`Sehat is already ready at ${current.url}`); openBrowser(current.url); return; }
  if (current) throw new Error('A managed launch is already starting. Wait a moment and try again.');
  if (await portBusy()) throw new Error(`Port ${port} is already in use. No process was stopped. Close the conflicting app or choose another PORT in .env.`);
  if (!existsSync(resolve(root,'node_modules','vite','package.json')) || !existsSync(resolve(root,'node_modules','express','package.json'))) {
    say('Installing project dependencies...'); await runNpm(existsSync(resolve(root,'package-lock.json')) ? ['ci'] : ['install']);
  }
  if (!existsSync(envPath)) { copyFileSync(resolve(root,'.env.example'), envPath); say('Created .env. Add NVIDIA_API_KEY for image and handwriting OCR.'); }
  if (!flag('--skip-build')) { say('Building the current interface...'); await runNpm(['run','build']); }
  if (!existsSync(resolve(root,'dist','index.html'))) throw new Error('Built interface missing. Run npm run build.');
  if (flag('--background')) {
    const output = openSync(resolve(stateDir,'service.log'),'a');
    const manager = spawn(process.execPath, [fileURLToPath(import.meta.url),'--controller','--no-open','--port',String(port)], {
      cwd: root, env: { ...env, SEHAT_LAUNCH_STATE_DIR: stateDir }, detached: true, windowsHide: true, stdio: ['ignore',output,output],
    });
    manager.on('error', () => {}); manager.unref(); closeSync(output);
    for (let i=0;i<120;i++) {
      const status = await controlRequest(readState());
      if (status?.ready && status.root === root) { say(`Sehat is ready at ${status.url}`); openBrowser(status.url); return; }
      await sleep(300);
    }
    throw new Error(`Server did not become ready. See ${resolve(stateDir,'service.log')}.`);
  }
  await serve();
}
main().catch(async error => { say(`Launch error: ${error.message}`); if (child || control) await shutdown(1); else process.exitCode=1; }).finally(releaseStartupLock);
