import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Probe 2 : le VRAI media-plane + mesh (code de production) entre deux pages Chromium.
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts';
import { createMesh } from '../src/engine/net/mesh.ts';

const CHROME = '/opt/data/.pw-browsers/chromium-1234/chrome-linux/chrome';
const PAGE = '<!doctype html><title>probe2</title>';
const srv = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;

async function launchPost(label: string) {
  const dir = mkdtempSync(join(tmpdir(), 'probe2-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--force-webrtc-ip-handling-migration',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: proc.stderr });
  const ep = await new Promise<string>((res, rej) => {
    rl.on('line', (l: string) => { const m = l.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
    setTimeout(() => rej(new Error('timeout endpoint ' + label)), 20000);
  });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserWSEndpoint: ep });
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`  [${label}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`  [${label}] pageerror ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { label, proc, browser, page };
}

// La page importe le plan média + le mesh compilés par esbuild (bundle inline en data-URI impossible :
// on sert le bundle depuis le serveur http ci-dessus ? non — plus simple : esbuild écrit un JS, la
// page le charge via addScriptTag avec le contenu en mémoire).
const { build } = await import('esbuild');
const result = await build({
  entryPoints: [join(import.meta.dirname, 'poste-bundle.ts')],
  bundle: true,
  format: 'iife',
  write: false,
  target: 'chrome120',
  legalComments: 'none',
});
const bundle = result.outputFiles[0].text;

const A = await launchPost('A');
const B = await launchPost('B');
for (const post of [A, B]) {
  await post.page.addScriptTag({ content: bundle });
}

// Pont Node<->page : chaque poste a un send() qui part chez l'AUTRE (relayé par ce script).
const posts: Record<string, { page: Awaited<ReturnType<typeof launchPost>>['page']; peer: string }> = {
  a: { page: A.page, peer: 'b' },
  b: { page: B.page, peer: 'a' },
};
const inbox: Record<string, unknown[]> = { a: [], b: [] };

// L'ordre d'arrivée est un contrat (le mesh séquence offer/answer/ice) : relais EN SÉRIE,
// un aller par tour, jamais deux drainages qui s'entrecroisent.
let relaying = false;
async function relayOnce(): Promise<void> {
  for (const [id, cfg] of Object.entries(posts)) {
    const msgs = await cfg.page.evaluate(() => {
      const g = globalThis as any;
      const o: unknown[] = g.__outbox ?? [];
      const c = o.slice();
      o.length = 0;
      return c;
    });
    for (const m of msgs) inbox[cfg.peer].push(m);
  }
  for (const [id, cfg] of Object.entries(posts)) {
    const pending = inbox[id].splice(0);
    for (const m of pending) await cfg.page.evaluate((msg) => (globalThis as any).__push(msg), m);
  }
}

for (const [id, cfg] of Object.entries(posts)) {
  await cfg.page.evaluate(async (post) => {
    const f = (globalThis as any).__factory;
    const timers = {
      once: (ms: number, cb: () => void) => setTimeout(cb, ms),
      cancel: (h: unknown) => clearTimeout(h as number),
    };
    const outbox = ((globalThis as any).__outbox = []);
    ((globalThis as any).__warnings = []);
    const origWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => { (globalThis as any).__warnings.push(args.map(String).join(' ')); origWarn(...args); };
    const plane = f.createMediaPlane({
      localId: post,
      timers,
      microOpenOnStart: true,
      onLocalCandidate: (peerId: string, c: unknown) => { outbox.push({ kind: 'ice', to: peerId, payload: c }); },
      onRemoteStream: (peerId: string) => { (globalThis as any).__flow = ((globalThis as any).__flow ?? []).concat(peerId); },
    });
    await plane.startMicrophone();
    const mesh = f.createMesh({
      localId: post,
      plane,
      timers,
      send: (m: unknown) => { outbox.push(m); },
      onPeerState: (peerId: string, s: string, cause: string) => {
        (globalThis as any).__states = Object.assign((globalThis as any).__states ?? {}, { [peerId]: s + '(' + cause + ')' });
      },
      // AD-17 : le mesh ne transmet que les flux dont il connaît le lien ; la coquille appelle
      // reportFlow sur la preuve du plan média. Ici le plan est branché DIRECTEMENT sur le mesh.
      onRemoteStream: (peerId: string, stream: MediaStream) => {
        (globalThis as any).__mesh.onRemoteStream(peerId, stream);
      },
    });
    (globalThis as any).__mesh = mesh;
    (globalThis as any).__plane = plane;
    (globalThis as any).__push = (m: unknown) => { void mesh.onSignal(m as never); };
  }, id);
}

// Relai : drainer les outbox vers l'inbox de l'autre, puis livrer — en série, une passe à la fois.
const relay = setInterval(() => {
  if (relaying) return;
  relaying = true;
  void relayOnce().finally(() => { relaying = false; });
}, 15);

// A ouvre le lien vers B (le mesh décide du rôle par comparaison d'ids).
await A.page.evaluate(() => (globalThis as any).__push({ kind: 'peer-joined', peerId: 'b', name: 'b' }));
await B.page.evaluate(() => (globalThis as any).__push({ kind: 'peer-joined', peerId: 'a', name: 'a' }));

const deadline = Date.now() + 45000;
let done = false;
while (Date.now() < deadline && !done) {
  await new Promise((r) => setTimeout(r, 2000));
  const [sa, sb] = await Promise.all([
    A.page.evaluate(async () => {
      const g = globalThis as any;
      const peers = g.__mesh.peers();
      const st: Record<string, unknown> = {};
      for (const p of peers) st[p] = await g.__plane.stats(p);
      return { peers, st, states: g.__states ?? {}, flow: g.__flow ?? [], warnings: (g.__warnings ?? []).slice(-15) };
    }),
    B.page.evaluate(async () => {
      const g = globalThis as any;
      const peers = g.__mesh.peers();
      const st: Record<string, unknown> = {};
      for (const p of peers) st[p] = await g.__plane.stats(p);
      return { peers, st, states: g.__states ?? {}, flow: g.__flow ?? [], warnings: (g.__warnings ?? []).slice(-15) };
    }),
  ]);
  const inA = Object.values(sa.st as Record<string, { bytesReceived?: number }>).reduce((s, v) => s + (v.bytesReceived ?? 0), 0);
  const inB = Object.values(sb.st as Record<string, { bytesReceived?: number }>).reduce((s, v) => s + (v.bytesReceived ?? 0), 0);
  console.log(`[probe2] A←B ${inB} o (states ${JSON.stringify(sa.states)}) · B←A ${inA} o (states ${JSON.stringify(sb.states)})`);
  if (Array.isArray(sa.warnings) && sa.warnings.length) console.log('  warn A:', sa.warnings.slice(-6).join(' | '));
  if (Array.isArray(sb.warnings) && sb.warnings.length) console.log('  warn B:', sb.warnings.slice(-6).join(' | '));
  if (inA > 0 && inB > 0) { done = true; console.log('PROBE2 FLUX_AUDIO_OK'); }
}
if (!done) console.log('PROBE2 PAS_DE_FLUX');
clearInterval(relay);
await A.browser.close().catch(() => {});
await B.browser.close().catch(() => {});
A.proc.kill(); B.proc.kill(); srv.close();
process.exit(done ? 0 : 1);
