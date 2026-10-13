// Playwright web server: serves the built UI and the local API on one port with a
// throwaway database.
//
// NVIDIA is deliberately DISABLED (an explicitly unconfigured client is injected,
// rather than relying on mutating process.env). The browser suite proves the
// no-provider path — labeled local fallback, explicit failures, conservative
// templates — and must behave identically on a machine with no credential and on
// one that has a key exported in its environment. Without this the suite would
// silently exercise the live-provider branch instead.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/index.mjs';
import { createNimClient } from '../../server/nim.mjs';

const folder = mkdtempSync(join(tmpdir(), 'sehat-e2e-'));
const { app } = createApp({
  databasePath: join(folder, 'e2e.sqlite'),
  seed: true,
  nim: createNimClient({ apiKey: '' }),
});

const port = 4173;
const host = '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Sehat e2e server ready at http://${host}:${port} (ai configured: false)`);
});
