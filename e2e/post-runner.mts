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
  g.__rawStats = async () => {
    const dump = [];
    for (const pc of (g.__allPcs ?? [])) {
      try {
        const rep = await pc.getStats();
        const rows = [];
        rep.forEach(function (e) { rows.push([e.type, e.kind ?? '', e.bytesReceived ?? 0, e.bytesSent ?? 0, e.state ?? '', e.transportId ?? '', e.ssrc ?? '', e.packetsReceived ?? 0].join('|')); });
        dump.push({ ice: pc.iceConnectionState, conn: pc.connectionState, signaling: pc.signalingState, rows: rows });
      } catch (e) { dump.push({ error: String(e) }); }
    }
    return dump;
  };
  g.__linkStats = async () => {
    const out = {};
    const pcs = g.__plane.pcs;
    const allPcs = g.__allPcs ?? [];
    for (const p of g.__mesh.peers()) {
      const get = g.__plane.peerConnection;
      const known = (pcs && pcs[p]) || (typeof get === 'function' ? get(p) : null);
      // Banc: sans exposition src/, la seule pc du maillage est celle creee par le hook.
      const pc = known ?? (allPcs.length === 1 ? allPcs[0] : null);
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
      out[p] = { pairRx: pairRx, pairTx: pairTx, inbound: inbound, outbound: outbound, pairState: pairState, conn: pc.connectionState, ice: pc.iceConnectionState, cands: cands.slice(0, 12), trs: trs, rtx: rtx };
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
  // Banc: trace toutes les RTCPeerConnection creees par le bundle (hook sans toucher src/).
  // Code passe en CHAINE pour echapper a l'annotation __name d'esbuild dans le bundle runner.
  if (process.env['ICE_ONLY_LAN'] === '1') {
    await page.evaluate(`(() => { (globalThis).__ICE_ONLY_LAN = true; })()`);
  }
  await page.evaluate(`(() => {
    const g = globalThis;
    g.__allPcs = [];
    g.__timeline = [];
    const T0 = Date.now();
    const stamp = () => Date.now() - T0;
    const Real = g.RTCPeerConnection;
    const Patched = function (cfg) {
      const pc = new Real(cfg);
      g.__allPcs.push(pc);
      // Timeline: etats + appels applicatifs sur la pc, dates depuis la creation du poste.
      const note = (what, extra) => g.__timeline.push({ t: stamp(), what, ...extra });
      pc.addEventListener('iceconnectionstatechange', () => note('ice', { v: pc.iceConnectionState }));
      pc.addEventListener('connectionstatechange', () => note('conn', { v: pc.connectionState }));
      const onlyLanPre = g.__ICE_ONLY_LAN === true;
      const stripSdp = (desc) => {
        if (!onlyLanPre || !desc || typeof desc.sdp !== 'string') return desc;
        const kept = desc.sdp.split('\r\n').filter((l) => !l.startsWith('a=candidate:') || / 192\.168\.1\./.test(l));
        const removed = desc.sdp.split('\r\n').length - kept.length;
        if (removed > 0) note('sdp_candidats_retires', { v: String(removed) });
        return { type: desc.type, sdp: kept.join('\r\n') };
      };
      const wrap = (name) => {
        const orig = pc[name].bind(pc);
        pc[name] = (...a) => { note(name, { v: (a[0] && a[0].type) || '' }); return orig(...a); };
      };
      {
        const origLocal = pc.setLocalDescription.bind(pc);
        pc.setLocalDescription = (d) => { note('setLocalDescription', { v: d && d.type }); return origLocal(stripSdp(d)); };
        const origRemote = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = (d) => { note('setRemoteDescription', { v: d && d.type }); return origRemote(stripSdp(d)); };
      }
      if (pc.restartIce) wrap('restartIce');
      const origClose = pc.close.bind(pc);
      pc.close = () => { note('close', {}); return origClose(); };
      // Filtre candidats du banc (flag ICE_ONLY_LAN): ne publier que 192.168.1.x — isole le cas
      // multi-interfaces (tailscale fd7a::/100.101., docker 172.17.) SANS toucher src/.
      const onlyLan = g.__ICE_ONLY_LAN === true;
      if (onlyLan) {
        const origAdd = pc.addIceCandidate.bind(pc);
        pc.addIceCandidate = (c, ...rest) => {
          const line = (c && (typeof c === 'string' ? c : c.candidate)) || '';
          note('remote_add', { v: (line || 'null').slice(0, 60) });
          if (line && !/ 192\.168\.1\./.test(line)) { note('remote_filtre', { v: line.slice(0, 60) }); return Promise.resolve(); }
          return origAdd(c, ...rest);
        };
        let handler = null;
        Object.defineProperty(pc, 'onicecandidate', {
          configurable: true,
          get() { return handler; },
          set(fn) {
            handler = fn;
            pc.addEventListener('icecandidate', (ev) => {
              const c = ev.candidate && (ev.candidate.candidate || '');
              if (c && !/ 192\.168\.1\./.test(c)) { note('candidat_filtre', { v: c.slice(0, 60) }); return; }
              try { fn.call(pc, ev); } catch (e) { /* handler en chute */ }
            }, true);
          },
        });
      }
      g.__pairInfo = async () => {
        const rep = await pc.getStats();
        let sel = null;
        const byId = {};
        rep.forEach((e) => { byId[e.id] = e; });
        rep.forEach((e) => {
          if (e.type === 'candidate-pair' && (e.selected === true || e.nominated === true)) {
            const l = byId[e.localCandidateId] || {};
            const r = byId[e.remoteCandidateId] || {};
            sel = { state: e.state, bytesRxBig: e.bytesReceived || 0,
              local: (l.ip || l.address || '?') + ':' + (l.port || '?') + '/' + (l.candidateType || '?'),
              remote: (r.ip || r.address || '?') + ':' + (r.port || '?') + '/' + (r.candidateType || '?') };
          }
        });
        return sel;
      };
      return pc;
    };
    Patched.prototype = Real.prototype;
    g.RTCPeerConnection = Patched;
  })()`);
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
  let prevInb = -1;
  const pointMarked: number[] = [];
  let peerOkPrev = false;
  let peerStable = 0;

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
    let linkOk = false;
    for (const v of Object.values(link?.peers ?? {})) {
      const w = v as { pairRx?: number; inbound?: number; pairState?: string; conn?: string };
      lrx += w.pairRx ?? 0; lin += w.inbound ?? 0;
      // Critere 2026-11-03 (JC) : le lien compte si la pc est CONNECTEE (ou la paire ICE
      // succeeded/nominated). 'connecting(ice)' + quelques centaines d'octets = DTLS monte,
      // pas un flux — les sondes précédentes comptaient ces octets de poignee comme du RTP.
      if (w.conn === 'connected' || w.pairState === 'succeeded') linkOk = true;
    }
    const inb = Math.max(lrx, lin, totalInbound(rep));
    last = `octets entrants ${inb} (pair ICE rx=${lrx}, inbound-rtp=${lin}, lien=${linkOk ? 'connecte' : 'NON'}) · états ${JSON.stringify(rep?.states ?? {})}`;
    console.log(`[${localId}] ${last}`);
    for (const mark of [5000, 15000]) {
      if (!pointMarked.includes(mark) && Date.now() - t0 >= mark) {
        pointMarked.push(mark);
        console.log(`[${localId}] POINT t+${String(mark / 1000)}s pairRx=${lrx} inbound-rtp=${lin} lien=${linkOk ? 'connecte' : 'NON'}`);
      }
    }
    if (process.env['CONCORD_E2E_DEBUG'] === '1') {
      const raw = await me.page.evaluate(() => (globalThis as any).__rawStats()).catch(() => null);
      console.log(`[${localId}] RAW ${JSON.stringify(raw)}`);
      for (const [pk, pv] of Object.entries(link?.peers ?? {})) {
        const v = pv as { trs?: unknown; rtx?: unknown; pairState?: string };
        console.log(`[${localId}] lien ${pk}: pair=${v.pairState} trs=${JSON.stringify(v.trs)} rtx=${JSON.stringify(v.rtx)}`);
      }
    }
    // FLUX_AUDIO_OK = lien connecté ET > 5 000 octets RTP entrants EN HAUSSE sur 2 sondes
    // consécutives (un pic unique ne suffit pas). Verdict NON collant : chaque sonde re-evalue,
    // le dernier état écrit est celui qui compte.
    const fluxOk = linkOk && inb > 5000 && inb > prevInb;
    if (fluxOk) {
      if (fluxT < 0) { fluxT = Date.now() - t0; console.log(`[${localId}] FLUX_T_MS ${String(fluxT)}`); }
      verdict = 'FLUX_AUDIO_OK';
    } else {
      verdict = 'PAS_DE_FLUX';
      if (fluxT >= 0) console.log(`[${localId}] VERDICT_REVOQUE (chute sous le seuil, dernier état = ${last})`);
    }
    prevInb = inb;
    if (fluxOk) {
      // Mon flux est monté : ne partez pas avant que l'autre poste ait eu sa chance. Le mien est
      // écrit TOUT DE SUITE — l'autre poste ne doit pas attendre sur un verdict qui n'arrive pas.
      try { writeFileSync(myVerdictFile, 'FLUX_AUDIO_OK'); } catch { /* meilleur effort */ }
      // Le verdict de l'autre poste est lu sur fichier: un snapshot unique peut etre perime
      // (l'autre a pu revoquer apres son ecriture). On exige DEUX echantillons consecutifs a
      // concordants avant de partir — le banc ne doit pas tuer un poste qui vient de revoquer.
      let peerOk = false;
      try { peerOk = readFileSync(peerVerdictFile, 'utf8').includes('FLUX_AUDIO_OK'); } catch { peerOk = false; }
      if (peerOk && peerOkPrev) {
        peerStable += 1;
      } else {
        peerStable = 0;
      }
      peerOkPrev = peerOk;
      const holdMs = Number(process.env['HOLD_MS'] ?? '0');
      if (holdMs > 0 && fluxT >= 0 && Date.now() - (t0 + fluxT) < holdMs) {
        // fenetre de mesure: on reste sonder (t+5s, t+15s) meme si les deux postes sont bons.
      } else if (peerStable >= 2 || Date.now() > deadline - 45000) break;
    }
  }
  try { writeFileSync(myVerdictFile, verdict); } catch { /* meilleur effort */ }
  {
    const tl = await me.page.evaluate(() => (globalThis as any).__timeline ?? []).catch(() => []);
    const sel = await me.page.evaluate(() => (globalThis as any).__pairInfo ? (globalThis as any).__pairInfo() : null).catch(() => null);
    console.log(`[timeline ${localId}] ${JSON.stringify(tl)}`);
    console.log(`[paire ${localId}] ${JSON.stringify(sel)}`);
  }
  {
    const lk = await me.page.evaluate(() => (globalThis as any).__linkStats()).catch(() => null);
    for (const [peer, st] of Object.entries(lk?.peers ?? {})) {
      console.log(`  [linkdiag ${localId}] ${peer}: ${JSON.stringify(st)}`);
    }
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
