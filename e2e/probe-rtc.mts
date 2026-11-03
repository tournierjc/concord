import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Probe : le fake-device de Chromium produit-il des paquets RTC entrants en headless ?
const CHROME = '/opt/data/.pw-browsers/chromium-1234/chrome-linux/chrome';
const PAGE = '<!doctype html><title>probe</title>';
const srv = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;

const dir = mkdtempSync(join(tmpdir(), 'probe-'));
const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--force-webrtc-ip-handling-migration',
  '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const rl = createInterface({ input: proc.stderr });
const ep = await new Promise((res, rej) => {
  rl.on('line', (l) => { const m = l.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
  setTimeout(() => rej(new Error('timeout endpoint')), 20000);
});
const b = await puppeteer.connect({ browserWSEndpoint: ep });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'domcontentloaded' });
const r = await p.evaluate(async () => {
  const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const t = s.getAudioTracks()[0];
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.addTrack(t, s);
  const pc2 = new RTCPeerConnection({ iceServers: [] });
  const o = await pc.createOffer();
  await pc.setLocalDescription(o);
  await pc2.setRemoteDescription(o);
  const a = await pc2.createAnswer();
  await pc2.setLocalDescription(a);
  await pc.setRemoteDescription(a);
  pc.onicecandidate = (e) => { if (e.candidate) void pc2.addIceCandidate(e.candidate); };
  pc2.onicecandidate = (e) => { if (e.candidate) void pc.addIceCandidate(e.candidate); };
  await new Promise((rr) => setTimeout(rr, 4000));
  const stats = await pc2.getStats();
  let inbound = 0;
  const cands: string[] = [];
  stats.forEach((x) => {
    if (x.type === 'inbound-rtp' && x.kind === 'audio') inbound = x.bytesReceived ?? 0;
    if (x.type === 'local-candidate' || x.type === 'remote-candidate') cands.push(`${x.type}:${x.candidateType}:${x.address ?? x.ip ?? '?'}`);
  });
  return { track: t.readyState, trackState: t.muted ? 'muted' : 'live', pcState: pc.connectionState, pc2State: pc2.connectionState, inbound, cands };
});
console.log('PROBE ' + JSON.stringify(r));
await b.close();
proc.kill();
srv.close();
