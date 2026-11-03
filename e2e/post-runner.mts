import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
const ROLE = process.argv[2] === 'client' || process.argv[2] === 'join' ? 'client' : 'host';

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
  g.__openPost = async (localId, selfServerId) => {
    g.__selfServerId = selfServerId ?? null;
    const plane = createMediaPlane({
      localId, timers, microOpenOnStart: true,
      onLocalCandidate: (peerId, c) => { g.__outbox.push({ kind: 'ice', to: peerId, payload: c }); },
    });
    await plane.startMicrophone();
    const mesh = createMesh({
      localId, plane, timers,
      // Election determinee : id SERVEUR passe des la creation (le runner attend le hello avant).
      serverId: g.__selfServerId ?? null,
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
  g.__linkStats = async () => {
    const out = {};
    const pcs = g.__plane.pcs;
    for (const p of g.__mesh.peers()) {
      const get = g.__plane.peerConnection;
      const pc = (pcs && pcs[p]) || (typeof get === 'function' ? get(p) : null);
      if (!pc) { out[p] = { error: 'pc introuvable' }; continue; }
      const report = await pc.getStats();
      let pairRx = 0;
      let pairTx = 0;
      let inbound = 0;
      let outbound = 0;
      let pairState = '?';
      const cands = [];
      report.forEach(function (e) {
        if (e.type === 'local-candidate' || e.type === 'remote-candidate') {
          cands.push([e.type, e.ip || e.address || '?', e.port || '?', e.candidateType || '?', e.protocol || '?'].join(':'));
        }
        if (e.type === 'candidate-pair' && (e.nominated === true || e.selected === true)) {
          pairRx += e.bytesReceived || 0;
          pairTx += e.bytesSent || 0;
          pairState = e.state || '?';
        }
        if (e.type === 'inbound-rtp' && e.kind === 'audio') inbound += e.bytesReceived || 0;
        if (e.type === 'outbound-rtp' && e.kind === 'audio') outbound += e.bytesSent || 0;
      });
      const trs = [];
      try {
        for (const t of pc.getTransceivers()) {
          trs.push({
            dir: t.direction, cur: t.currentDirection || '?',
            senderTrack: t.sender && t.sender.track ? (t.sender.track.kind + ':' + t.sender.track.enabled + ':' + t.sender.track.readyState) : 'null',
            recvTrack: t.receiver && t.receiver.track ? (t.receiver.track.kind + ':' + t.receiver.track.readyState) : 'null',
          });
        }
      } catch (e) { trs.push({ error: String(e) }); }
      const rtx = {};
      report.forEach(function (e) {
        if (e.type === 'outbound-rtp') rtx['out:' + (e.kind || '?') + ':' + (e.paused ? 'paused' : 'active')] = (e.bytesSent || 0);
        if (e.type === 'inbound-rtp') rtx['in:' + (e.kind || '?')] = (e.bytesReceived || 0);
      });
      out[p] = { pairRx: pairRx, pairTx: pairTx, inbound: inbound, outbound: outbound, pairState: pairState, cands: cands.slice(0, 12), trs: trs, rtx: rtx };
    }
    return { peers: out, states: g.__states };
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
  if (process.env['CONCORD_E2E_DEBUG'] === '1') {
    await page.evaluate(() => { (globalThis as Record<string, unknown>)['__CONCORD_DEBUG__'] = true; });
  }
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
  const t00 = Date.now();
  const me = await launchPost(ROLE === 'host' ? 'A/hote' : 'B/client');
  const localId = ROLE === 'host' ? 'jeanjean' : 'krillin';

  const link = createSignalingLink({
    role: ROLE, localId, name: localId, host: HOST_IP, port: PORT,
    now: () => systemTimers.now(),
    onMessage: (m) => {
      if (process.env['CONCORD_E2E_DEBUG'] === '1') {
        const mt = (m as { type?: string }).type ?? (m as { kind?: string }).kind ?? '?'
        if (mt === 'answer' || mt === 'offer' || mt === 'join') console.log(`[${localId}] SIGNAL ${mt} recue t0_rel=${String(Date.now() - t00)}`);
      }
      void me.page.evaluate((x) => (globalThis as any).__pushSignal(x), m).catch(() => {});
    },
    ...(ROLE === 'host' ? {} : {}),
  });
  if (ROLE === 'host') {
    for (let i = 0; i < 200 && link.listen === null; i++) await new Promise((r) => setTimeout(r, 50));
    if (link.listen === null) throw new Error('hôte jamais lié');
    console.log(`[${localId}] lié sur ${link.listen.host}:${link.listen.port} (selfId lien = ${String(link.selfId)})`);
  }
  // Election déteministe : le poste n'ouvre son maillage qu'UNE FOIS son id serveur connu
  // (hello du serveur) — sinon l'élection retombe sur le repli miroir et le glare revient.
  for (let i = 0; i < 200 && link.selfId === null; i++) await new Promise((r) => setTimeout(r, 50));
  if (link.selfId === null) throw new Error('selfId serveur jamais reçu');
  await me.page.evaluate((a) => (globalThis as any).__openPost(a.id, a.sid), { id: localId, sid: link.selfId });
  const t0 = Date.now();
  let fluxT = -1;

  const drain = setInterval(() => {
    void me.page.evaluate(() => {
      const g = globalThis as any;
      const o: unknown[] = g.__outbox ?? [];
      const c = o.slice();
      o.length = 0;
      return c;
    }).then((out: unknown[]) => {
      for (const m of out) {
        if (process.env['CONCORD_E2E_DEBUG'] === '1') {
          const mt = (m as { type?: string; kind?: string }).type ?? (m as { kind?: string }).kind ?? '?'
          if (mt === 'offer' || mt === 'answer') console.log(`[${localId}] SIGNAL ${mt} EMISE t0_rel=${String(Date.now() - t00)}`);
        }
        link.send(m as never);
      }
    }).catch(() => {});
  }, 20);

  const deadline = Date.now() + 90000;
  // 2026-11-03 (banc, sens host) : le join partait DES sa premiere sonde OK et tuait le banc ;
  // le host n'avait que ~3 s pour monter ICE/DTLS — course perdue quand la réponse arrivait en
  // retard (gathering long). Le poste qui a son flux ATTEND désormais que l'AUTRE poste ait le
  // sien (verdict croisé par fichier), borné à l'horloge du run. L'artefact de course est mort.
  const PEER_VERDICT_FILE = ROLE === 'host'
    ? '/opt/data/profiles/banctol/cache/scratch/join-verdict'
    : '/opt/data/profiles/banctol/cache/scratch/host-verdict'
  const runTag = process.env['RUN_TAG'] ?? ''
  const peerVerdictFile = runTag === '' ? PEER_VERDICT_FILE : `${PEER_VERDICT_FILE}-${runTag}`
  const MY_VERDICT_FILE = ROLE === 'host'
    ? '/opt/data/profiles/banctol/cache/scratch/host-verdict'
    : '/opt/data/profiles/banctol/cache/scratch/join-verdict'
  const myVerdictFile = runTag === '' ? MY_VERDICT_FILE : `${MY_VERDICT_FILE}-${runTag}`
  try { unlinkSync(myVerdictFile); unlinkSync(peerVerdictFile); } catch { /* neuf */ }
  let verdict = 'PAS_DE_FLUX'
  let last = '';
  const sondeMs = Number(process.env['SONDE_MS'] ?? '250');
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, sondeMs));
    const rep = await me.page.evaluate(() => (globalThis as any).__peerStats()).catch(() => null);
    const link = await me.page.evaluate(() => (globalThis as any).__linkStats()).catch(() => null);
    let lrx = 0;
    let lin = 0;
    for (const v of Object.values(link?.peers ?? {})) { lrx += (v as { pairRx?: number }).pairRx ?? 0; lin += (v as { inbound?: number }).inbound ?? 0; }
    const inb = totalInbound(rep) > 0 ? totalInbound(rep) : Math.max(lrx, lin);
    last = `octets entrants ${inb} (pair ICE rx=${lrx}, inbound-rtp=${lin}) · états ${JSON.stringify(rep?.states ?? {})}`;
    console.log(`[${localId}] ${last}`);
    if (process.env['CONCORD_E2E_DEBUG'] === '1') {
      for (const [pk, pv] of Object.entries(link?.peers ?? {})) {
        const v = pv as { trs?: unknown; rtx?: unknown; pairState?: string };
        console.log(`[${localId}] lien ${pk}: pair=${v.pairState} trs=${JSON.stringify(v.trs)} rtx=${JSON.stringify(v.rtx)}`);
      }
    }
    if (inb > 0) {
      if (fluxT < 0) { fluxT = Date.now() - t0; console.log(`[${localId}] FLUX_T_MS ${String(fluxT)}`); }
      verdict = 'FLUX_AUDIO_OK';
      // Mon flux est monté : ne partez pas avant que l'autre poste ait eu sa chance. Le mien est
      // écrit TOUT DE SUITE — l'autre poste ne doit pas attendre sur un verdict qui n'arrive pas.
      try { writeFileSync(myVerdictFile, 'FLUX_AUDIO_OK'); } catch { /* meilleur effort */ }
      let peerOk = false;
      try { peerOk = readFileSync(peerVerdictFile, 'utf8').includes('FLUX_AUDIO_OK'); } catch { peerOk = false; }
      if (peerOk || Date.now() > deadline - 45000) break;
    }
  }
  try { writeFileSync(myVerdictFile, verdict); } catch { /* meilleur effort */ }
  clearInterval(drain);
  link.close('fin');
  await me.browser.close().catch(() => {});
  me.proc.kill();
  me.srv.close();
  {
    const lk = await me.page.evaluate(() => (globalThis as any).__linkStats()).catch(() => null);
    for (const [peer, st] of Object.entries(lk?.peers ?? {})) {
      console.log(`  [linkdiag ${localId}] ${peer}: ${JSON.stringify(st)}`);
    }
  }
  console.log(`RESULTAT ${localId}: ${verdict} — ${last}`);
  process.exit(verdict === 'FLUX_AUDIO_OK' ? 0 : 1);
}

main().catch((e) => { console.error('exception :', e); process.exit(1); });
