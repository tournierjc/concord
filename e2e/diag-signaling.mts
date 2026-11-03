import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { createSignalingLink } from '../src/main/signaling-link.ts';
import { systemTimers } from '../src/main/timers.ts';

// Diagnostic : que voit la page du lien de signalisation (rôles, selfIds, messages) ?
const CHROME = '/opt/data/.pw-browsers/chromium-1234/chrome-linux/chrome';

const srv = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>p</title>'); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;

async function post(label: string) {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: proc.stderr });
  const ep = await new Promise<string>((res, rej) => {
    rl.on('line', (l: string) => { const m = l.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
    setTimeout(() => rej(new Error('timeout ' + label)), 20000);
  });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserWSEndpoint: ep });
  const page = await browser.newPage();
  await page.goto(url);
  await page.evaluate(() => {
    const g = globalThis as any;
    g.__msgs = [];
    g.__push = (m: unknown) => { g.__msgs.push(m); };
    g.__msgsOf = () => g.__msgs.map((m: any) => m.kind + (m.peerId ? ':' + m.peerId : '') + (m.from ? ':' + m.from : '') + (m.name ? '/' + m.name : ''));
  });
  return { label, proc, browser, page };
}

const A = await post('A');
const B = await post('B');

const aLink = createSignalingLink({
  role: 'host', localId: 'jeanjean', name: 'jeanjean', host: '127.0.0.1', port: 47821,
  now: () => systemTimers.now(),
  onMessage: (m) => { void A.page.evaluate((x) => (globalThis as any).__push(x), m); },
});
for (let i = 0; i < 100 && aLink.listen === null; i++) await new Promise((r) => setTimeout(r, 50));
console.log('A listen:', JSON.stringify(aLink.listen), 'selfId:', aLink.selfId);

const bLink = createSignalingLink({
  role: 'client', localId: 'krillin', name: 'krillin', host: '127.0.0.1', port: 47821,
  now: () => systemTimers.now(),
  onMessage: (m) => { void B.page.evaluate((x) => (globalThis as any).__push(x), m); },
});
await new Promise((r) => setTimeout(r, 2500));

const msgsA = await A.page.evaluate(() => (globalThis as any).__msgsOf());
const msgsB = await B.page.evaluate(() => (globalThis as any).__msgsOf());
console.log('A recoit:', JSON.stringify(msgsA));
console.log('B recoit:', JSON.stringify(msgsB));
console.log('A.selfId (id serveur de la connexion hote):', aLink.selfId, ' B.selfId:', bLink.selfId);

await A.browser.close().catch(() => {});
await B.browser.close().catch(() => {});
A.proc.kill(); B.proc.kill(); srv.close();
aLink.close('fin'); bLink.close('fin');
process.exit(0);
