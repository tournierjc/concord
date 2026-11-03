import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { build } from 'esbuild';

import { createSignalingLink } from '../src/main/signaling-link.ts';
import { systemTimers } from '../src/main/timers.ts';

// e2e du trajet complet (boucle locale, mais deux processus SEPARES — pas de fuite de closure).
const CHROME = process.env.CHROME_PATH ?? '/opt/data/.pw-browsers/chromium-1234/chrome-linux/chrome';
const HOST_IP = '127.0.0.1';
const PORT = Number(process.env.CONCORD_E2E_PORT ?? 47821);
const ROLE = process.argv[2] === 'client' ? 'client' : 'host';

const built = await build({
  entryPoints: [join(import.meta.dirname, 'poste-bundle.ts')],
  bundle: true, format: 'iife', write: false, target: 'chrome120', legalComments: 'none',
});
const bundle = built.outputFiles[0].text;

const PAGE_JS = `
{
  const g = globalThis;
  g.__outbox = [];
  g.__states = {};
  g.__flows = [];
  const { createMediaPlane, createMesh } = g.__factory;
  const timers = { once: (ms, cb) => setTimeout(cb, ms), cancel: (h) => clearTimeout(h) };
  g.__openPost = async (localId) => {
    const plane = createMediaPlane({
      localId, timers, microOpenOnStart: true,
      onLocalCandidate: (peerId, c) => { g.__outbox.push({ kind: 'ice', to: peerId, payload: c }); },
    });
    await plane.startMicrophone();
    const mesh = createMesh({
      localId, plane, timers,
      send: (m) => { g.__outbox.push(m); },
      onPeerState: (peerId, s, cause) => { g.__states[peerId] = s + '(' + cause + ')'; },
      onRemoteStream: (peerId, stream) => { g.__flows.push(peerId); mesh.onRemoteStream(peerId, stream); },
    });
    g.__plane = plane;
    g.__mesh = mesh;
    g.__pushSignal = (m) => { void mesh.onSignal(m); };
    return true;
  };
  g.__peerStats = async () => {
    const out = {};
    for (const p of g.__mesh.peers()) out[p] = await g.__plane.stats(p);
    return { peers: out, states: g.__states, flows: g.__flows };
  };
}`;

async function launchPost(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `concord-e2e2-${label.replace(/[^a-zA-Z0-9]/g, '')}-`));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--force-webrtc-ip-handling-migration',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--mute-audio',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: proc.stderr });
  const ep = await new Promise<string>((res, rej) => {
    const t = setTimeout(() => rej(new Error(label + ' : aucun endpoint de debug (30 s)')), 30000);
    rl.on('line', (l) => { const m = l.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
    proc.on('exit', (c) => rej(new Error(label + ' : Chromium a quitté (' + c + ')')));
  });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserWSEndpoint: ep, protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`  [${label}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`  [${label}] pageerror ${e.message}`));
  const srv = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<title>poste</title>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await page.goto(`http://127.0.0.1:${(srv.address() as { port: number }).port}/`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(PAGE_JS);
  return { label, proc, browser, page, srv };
}

function totalInbound(rep: { peers?: Record<string, { bytesReceived?: number }> } | null): number {
  if (!rep) return -1;
  let t = 0;
  for (const v of Object.values(rep.peers ?? {})) t += v.bytesReceived ?? 0;
  return t;
}

async function main() {
  const me = await launchPost(ROLE === 'host' ? 'A/hote' : 'B/client');
  const localId = ROLE === 'host' ? 'jeanjean' : 'krillin';
  await me.page.evaluate((id) => (globalThis as any).__openPost(id), localId);

  const link = createSignalingLink({
    role: ROLE, localId, name: localId, host: HOST_IP, port: PORT,
    now: () => systemTimers.now(),
    onMessage: (m) => { void me.page.evaluate((x) => (globalThis as any).__pushSignal(x), m).catch(() => {}); },
    ...(ROLE === 'host' ? {} : {}),
  });
  if (ROLE === 'host') {
    for (let i = 0; i < 200 && link.listen === null; i++) await new Promise((r) => setTimeout(r, 50));
    if (link.listen === null) throw new Error('hôte jamais lié');
    console.log(`[${localId}] lié sur ${link.listen.host}:${link.listen.port} (selfId lien = ${link.selfId})`);
  }

  const drain = setInterval(() => {
    void me.page.evaluate(() => {
      const g = globalThis as any;
      const o: unknown[] = g.__outbox ?? [];
      const c = o.slice();
      o.length = 0;
      return c;
    }).then((out: unknown[]) => { for (const m of out) link.send(m as never); }).catch(() => {});
  }, 20);

  const deadline = Date.now() + 90000;
  let verdict = 'PAS_DE_FLUX';
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const rep = await me.page.evaluate(() => (globalThis as any).__peerStats()).catch(() => null);
    const inb = totalInbound(rep);
    last = `octets entrants ${inb} · états ${JSON.stringify(rep?.states ?? {})}`;
    console.log(`[${localId}] ${last}`);
    if (inb > 0) { verdict = 'FLUX_AUDIO_OK'; break; }
  }
  clearInterval(drain);
  link.close('fin');
  await me.browser.close().catch(() => {});
  me.proc.kill();
  me.srv.close();
  console.log(`RESULTAT ${localId}: ${verdict} — ${last}`);
  process.exit(verdict === 'FLUX_AUDIO_OK' ? 0 : 1);
}

main().catch((e) => { console.error('exception :', e); process.exit(1); });
