// Cross-platform launcher: `npm run launch` (or `node scripts/launch.mjs`).
//
// Starts the Sehat API and interface, waits until the workspace actually answers,
// then opens the browser. Works on Windows, macOS and Linux with no shell-specific
// syntax, so it is the one entry point that behaves identically everywhere.
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.PORT) || 3001;
const WEB_PORT = 5173;
const children = [];

const say = (message = '') => process.stdout.write(`${message}\n`);
const step = (n, text) => say(`  [${n}/6] ${text}`);

function fail(message, hint) {
  say();
  say(`  [X] ${message}`);
  if (hint) say(`      ${hint}`);
  say();
  shutdown(1);
}

/** Resolve as soon as something is listening on the port, or false if it stays closed. */
function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePort) => {
    const attempt = () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolvePort(true); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) resolvePort(false);
        else setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

async function isPortBusy(port) {
  return new Promise((resolveBusy) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolveBusy(true); });
    socket.once('error', () => { socket.destroy(); resolveBusy(false); });
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  process.exit(code);
}

process.on('SIGINT', () => { say('\n  Stopping Sehat...'); shutdown(0); });
process.on('SIGTERM', () => shutdown(0));

async function main() {
  say();
  say('  sehat.  Starting your health record workspace');
  say('  ============================================');
  say();

  // 1. Node version - the store relies on the built-in node:sqlite from Node 24.
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < 24) {
    fail(`Node.js ${process.versions.node} is too old.`, 'Install Node 24 or newer from https://nodejs.org/');
  }
  step(1, `Node.js v${process.versions.node} ............... ready`);

  // 2. Dependencies.
  if (!existsSync(resolve(root, 'node_modules'))) {
    step(2, 'First run - installing dependencies (this can take a few minutes)...');
    const install = spawn('npm', ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    const code = await new Promise((done) => install.on('exit', done));
    if (code !== 0) fail('npm install failed.', 'Check your internet connection and run it again.');
  }
  step(2, 'Dependencies ................. ready');

  // 3. Configuration.
  if (!existsSync(resolve(root, '.env'))) {
    if (existsSync(resolve(root, '.env.example'))) copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
    step(3, 'Created .env from the example.');
    say('        Add NVIDIA_API_KEY to enable AI reading of images and scanned PDFs.');
    say('        Without a key the app still runs: browse, edit and read text reports.');
  } else {
    step(3, 'Config ....................... ready');
  }

  // 4. Ports. A leftover run is the most common reason a launch looks broken, so say so clearly.
  for (const [port, label] of [[API_PORT, 'API'], [WEB_PORT, 'interface']]) {
    if (await isPortBusy(port)) {
      fail(
        `Port ${port} is already in use by the ${label}.`,
        `Close the other Sehat window, or stop it with STOP_SEHAT.bat on Windows, then run this again.`,
      );
    }
  }
  step(4, `Ports ${API_PORT} and ${WEB_PORT} ......... free`);

  // 5. Build the interface only if it has never been built.
  if (!existsSync(resolve(root, 'dist', 'index.html'))) {
    step(5, 'Building the interface for the first time...');
    const build = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    const code = await new Promise((done) => build.on('exit', done));
    if (code !== 0) fail('Build failed.', 'Run "npm run build" to see the full error.');
  }
  step(5, 'Interface build .............. ready');

  // 6. Start both services.
  step(6, 'Starting services...');
  say();

  const env = { ...process.env, SEHAT_DEV_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}` };

  const api = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], { cwd: root, stdio: 'inherit', env });
  children.push(api);
  api.on('exit', (code) => {
    if (code !== 0 && code !== null) fail(`The API stopped unexpectedly (exit ${code}).`, 'Scroll up for its error.');
  });

  if (!(await waitForPort(API_PORT, 30_000))) {
    fail('The API did not start within 30 seconds.', 'Scroll up for its error message.');
  }

  const web = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32',
  });
  children.push(web);
  web.on('exit', (code) => {
    if (code !== 0 && code !== null) fail(`The interface stopped unexpectedly (exit ${code}).`, 'Scroll up for its error.');
  });

  if (!(await waitForPort(WEB_PORT, 30_000))) {
    fail('The interface did not start within 30 seconds.', 'Scroll up for its error message.');
  }

  const url = `http://localhost:${WEB_PORT}`;
  say();
  say(`  Sehat is ready at ${url}`);
  say('  Press Ctrl+C here to stop.');
  say();

  // Open the browser with the platform's own handler; never fail the launch if it is missing.
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    say(`  Open ${url} in your browser.`);
  }
}

main().catch((error) => fail(error.message));
