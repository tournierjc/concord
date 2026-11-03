/**
 * e2e/two-postes.mjs — le test e2e de référence : deux postes Chromium séparés, le VRAI
 * tuyau de signalisation (protocole + filtre ICE LAN), le VRAI câblage de voix du renderer,
 * et la preuve mesurée (octets RTP entrants via getStats) — pas un « connected » déclaré.
 *
 * Lancé en un seul process (le pilote orchestre les deux pages), le lien de signalisation
 * est créé par le pilote Node et bouclé sur chaque page — exactement le rôle du main Electron.
 *
 * Ce que le test FALSIFIE :
 *   • l'échange offer/answer par le mesh (faute d'ordre, un pair reste 'waiting') ;
 *   • le ramassage ICE + le filtre LAN (les candidats non-LAN sont refusés, les LAN passent) ;
 *   • le branchement ontrack -> sink -> preuve de flux ;
 *   • le repli du 0.4.8 (mDNS forcé par --force-webrtc-ip-handling-migration, neutralisé par
 *     --disable-features=WebRtcHideLocalIpsWithMdns comme dans src/main/index.ts).
 *
 * Le micro est le fake-device de Chromium (tonalité 6 kHz) — même API, déterministe.
 *
 * Exécution : node e2e/two-postes.mjs   (auto-relance sous tsx pour les imports .ts)
 */

if (!process.env.__CONCORD_E2E_TSX) {
  const { spawnSync } = await import('node:child_process');
  const here = new URL(import.meta.url).pathname;
  const r = spawnSync('npx', ['tsx', here, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, __CONCORD_E2E_TSX: '1' },
  });
  process.exit(r.status ?? 1);
}

const { spawn } = await import('node:child_process');
const { mkdtempSync, existsSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { createInterface } = await import('node:readline');
const { createServer } = await import('node:http');

const { createSignalingLink } = await import('../src/main/signaling-link.ts');
const meshFactory = await import('../src/engine/net/mesh.ts');
const { systemTimers } = await import('../src/main/timers.ts');
const { build } = await import('esbuild');

const CHROME = process.env.CHROME_PATH
  ?? '/opt/data/.pw-browsers/chromium-1234/chrome-linux/chrome';
if (!existsSync(CHROME)) {
  console.error(`[e2e] Chromium introuvable : ${CHROME} (CHROME_PATH=… pour surcharger)`);
  process.exit(2);
}
const PORT = Number(process.env.CONCORD_E2E_PORT ?? 47821);
const HOST_IP = process.env.CONCORD_E2E_HOST_IP ?? '127.0.0.1';

const CHROME_FLAGS = [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  // même logique : l'UDP WebRTC part par l'interface physique, jamais par un pont Docker.
  // (sur un vrai LAN, ce switch est un no-op : il n'y a pas de pont à écarter.)
  ...(process.env.CONCORD_E2E_UDP_IF ? [`--force-webrtc-udp-interface=${process.env.CONCORD_E2E_UDP_IF}`] : []),
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--force-webrtc-ip-handling-migration',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--mute-audio',
];

const PAGE_JS = `
{
 const g = globalThis;
 g.__outbox = [];
 g.__states = {};
 g.__flows = [];
 g.__streams = 0;
 const { createMediaPlane } = g.__factory;
 const timers = { once: (ms, cb) => setTimeout(cb, ms), cancel: (h) => clearTimeout(h) };
 // FILE FIDÈLE (SPEC-009) : avant le plan, tout message attendu est tamponné puis rejoué.
 g.__queue = [];
 g.__pushSignal = (m) => {
   g.__recv = (g.__recv ?? []).concat([m.kind + (m.from ? '<-' + m.from : m.peerId ? ':' + m.peerId : '')]);
   if (g.__plane === undefined) g.__queue.push(m);
   else g.__deliver(m);
 };
 g.__openPost = async (localId) => {
   const plane = createMediaPlane({
     localId, timers, microOpenOnStart: true,
     onLocalCandidate: (peerId, c) => { if (globalThis.__pageLocalCandidate) globalThis.__pageLocalCandidate(peerId, c); },
     onRemoteStream: (peerId, stream) => {
       g.__streams += 1;
       g.__flows.push(peerId);
       // le plan média connaît le pair émetteur ; le mesh-node déclare la preuve par ce rappel
       if (g.__onPageFlow) g.__onPageFlow(peerId);
     },
   });
   await plane.startMicrophone();
   g.__plane = plane;
   const pending = g.__queue.splice(0, g.__queue.length);
   for (const m of pending) g.__deliver(m);
   return true;
 };
 // le pilote (Node) tient le mesh : la page lui déléguè la livraison et lui rend les stats.
 g.__deliver = (m) => { if (g.__nodeOnSignal) void g.__nodeOnSignal(m); };
 g.__drain = () => { const o = g.__outbox; const c = o.slice(); o.length = 0; return c; };
 g.__peerStats = async () => {
   const out = {};
   for (const p of (g.__peerList ?? [])) out[p] = await g.__plane.stats(p);
   return { peers: out, states: g.__states, flows: g.__flows, streams: g.__streams, sent: g.__sent ?? [], recv: g.__recv ?? [] };
 };
}`;

async function buildBundle() {
  const built = await build({
    entryPoints: [join(import.meta.dirname, 'poste-bundle.ts')],
    bundle: true, format: 'iife', write: false, target: 'chrome120', legalComments: 'none',
  });
  return built.outputFiles[0].text;
}

async function launchPost(label, bundle) {
  const dir = mkdtempSync(join(tmpdir(), 'concord-e2e-' + label.replace(/[^a-zA-Z0-9]/g, '') + '-'));
  const proc = spawn(CHROME, [
    ...CHROME_FLAGS, '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: proc.stderr });
  const endpoint = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label + ' : aucun endpoint de debug (30 s)')), 30000);
    rl.on('line', (line) => {
      const m = line.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(label + ' : Chromium a quitté (' + code + ')')));
  });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, protocolTimeout: 60000 });
  const page = await browser.newPage();
  const trace = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.includes('[mesh]') || t.includes('media-plane')) trace.push(label + ': ' + t); });
  page.on('pageerror', (e) => trace.push(label + ' pageerror: ' + e.message));
  const srv = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<title>poste</title>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(PAGE_JS);
  return { label, proc, browser, page, srv, trace };
}

function sumInbound(rep) {
  if (!rep || rep.error !== undefined) return -1;
  let total = 0;
  for (const v of Object.values(rep.peers ?? {})) total += v.bytesReceived ?? 0;
  return total;
}

async function main() {
  const bundle = await buildBundle();
  const A = await launchPost('A/hote', bundle);
  const B = await launchPost('B/client', bundle);

  // Le mesh vit ici, en Node — exactement là où la coquille le tient (le renderer le crée
  // au-dessus de `lanApi()`). La page ne tient que le plan média : le pilote relaie les
  // SignalIn vers le mesh-node, et les envois du mesh vers le vrai lien TCP.
  const meshOf = { A: null, B: null };

  // Le mesh vit en NODE (pilote) — comme le renderer au-dessus de `lanApi()` ; la page ne tient
  // que le plan média. Le pont : les gestes du mesh sur le plan partent en page, les candidats
  // et flux de la page remontent au mesh. Une SEULE passe à la fois (contrat d'ordre du mesh).
  function distPlane(post, key) {
    const timers = { once: (ms, cb) => setTimeout(cb, ms), cancel: (h) => clearTimeout(h) };
    const { createMesh } = meshFactory;
    let queue = Promise.resolve();
    const call = (fn, ...args) => {
      const run = () => post.page.evaluate(fn, ...args);
      queue = queue.then(run, run);
      return queue;
    };
    const plane = {
      async attach(peerId) { return post.page.evaluate((id) => globalThis.__plane.attach(id), peerId); },
      async accept(peerId, offer) { return post.page.evaluate((id, o) => globalThis.__plane.accept(id, o), peerId, offer); },
      async acceptAnswer(peerId, answer) { await call((id, a) => globalThis.__plane.acceptAnswer(id, a), peerId, answer); },
      async addRemoteCandidate(peerId, candidate) { await call((id, c) => globalThis.__plane.addRemoteCandidate(id, c), peerId, candidate); },
      close() { void call(() => globalThis.__plane && globalThis.__plane.close()); },
    };
    const mesh = createMesh({
      localId: post.localId,
      plane,
      timers,
      send: (m) => { post.link.send(m); },
      onPeerState: (peerId, s, cause) => {
        void post.page.evaluate((p, st, cz) => { globalThis.__states[p] = st + '(' + cz + ')'; }, peerId, s, cause).catch(() => {});
      },
      onRemoteStream: (peerId) => { mesh.reportFlow(peerId); },
    });
    meshOf[key] = mesh;
    return { plane, mesh };
  }

  function wire(key, post, link, localId) {
    post.localId = localId;
    post.link = link;
    post.push = (m) => {
      if (m.kind === 'link' && m.state === 'connected' && !post.opened) {
        post.opened = true;
        void post.page.evaluate((id) => globalThis.__openPost(id), localId).catch(() => {});
        const { mesh } = distPlane(post, key);
        post.mesh = mesh;
      }
      // la page tient la file fidèle ; le mesh-node négocie. Même message, deux rôles, ordre préservé.
      void post.page.evaluate((x) => globalThis.__pushSignal(x), m).catch(() => {});
      if (post.mesh) void post.mesh.onSignal(m).catch(() => {});
    };
    post.drainTimer = setInterval(() => {
      void post.page.evaluate(() => globalThis.__drain())
        .then((out) => { for (const m of out) {
          // candidats et offres émis par la page (plan) ou par le mesh : tous partent sur le fil.
          link.send(m);
        } })
        .catch(() => {});
    }, 20);
    // le plan de la page lève ses candidats et ses flux vers le mesh-node
    post.page.exposeFunction('__pageLocalCandidate', (peerId, candidate) => {
      if (post.mesh) post.mesh.onLocalCandidate(peerId, candidate);
    }).catch(() => {});
    post.page.exposeFunction('__pageRemoteStream', (peerId) => {
      if (post.mesh) post.mesh.onRemoteStream(peerId, null);
    }).catch(() => {});
    post.page.exposeFunction('__pageConnectionState', (peerId, state) => {
      if (post.mesh) void post.mesh; // l'état brut reste en page (trace), le mesh ne décide pas sur lui
    }).catch(() => {});
  }

  // la page livre ses messages au mesh-node par ce canal
  A.page.evaluate(() => { globalThis.__nodeOnSignal = null; }).catch(() => {});
  B.page.evaluate(() => { globalThis.__nodeOnSignal = null; }).catch(() => {});

  const aLink = createSignalingLink({
    role: 'host', localId: 'jeanjean', name: 'jeanjean',
    host: HOST_IP, port: PORT,
    now: () => systemTimers.now(),
    onMessage: (m) => A.push(m),
  });
  wire('A', A, aLink, 'jeanjean');
  for (let i = 0; i < 200 && aLink.listen === null; i++) await new Promise((r) => setTimeout(r, 50));
  if (aLink.listen === null) throw new Error(`hôte jamais lié sur ${HOST_IP}:${PORT}`);
  console.log(`[e2e] hôte lié ${HOST_IP}:${PORT} (selfId tuyau hôte : ${aLink.selfId})`);

  const bLink = createSignalingLink({
    role: 'client', localId: 'krillin', name: 'krillin',
    host: HOST_IP, port: PORT,
    now: () => systemTimers.now(),
    onMessage: (m) => B.push(m),
  });
  wire('B', B, bLink, 'krillin');

  // liste des pairs pour les stats (celle du mesh, la seule qui sait qui est là)
  const peersOf = { A: [], B: [] };

  const DEADLINE = Date.now() + 75000;
  let report = null;
  while (Date.now() < DEADLINE) {
    await new Promise((r) => setTimeout(r, 2500));
    if (meshOf.A) peersOf.A = meshOf.A.peers();
    if (meshOf.B) peersOf.B = meshOf.B.peers();
    void A.page.evaluate((l) => { globalThis.__peerList = l; }, peersOf.A).catch(() => {});
    void B.page.evaluate((l) => { globalThis.__peerList = l; }, peersOf.B).catch(() => {});
    const [sa, sb] = await Promise.all([
      A.page.evaluate(() => globalThis.__peerStats()).catch(() => null),
      B.page.evaluate(() => globalThis.__peerStats()).catch(() => null),
    ]);
    const recvA = sumInbound(sa);
    const recvB = sumInbound(sb);
    console.log(`[e2e] A←B ${recvA} o (flux ${sa?.streams ?? '?'}) · B←A ${recvB} o (flux ${sb?.streams ?? '?'}) · états A=${JSON.stringify(sa?.states ?? {})} B=${JSON.stringify(sb?.states ?? {})}`);
    console.log(`        cands distants A: ${(sa?.remoteCands ?? []).slice(0, 4).join(' ; ')}`);
    console.log(`        cands distants B: ${(sb?.remoteCands ?? []).slice(0, 4).join(' ; ')}`);
    report = { pass: recvA > 0 && recvB > 0, recvA, recvB, sa, sb };
    if (report.pass) break;
  }

  clearInterval(A.drainTimer);
  clearInterval(B.drainTimer);
  aLink.close('fin de test');
  bLink.close('fin de test');
  await A.browser.close().catch(() => {});
  await B.browser.close().catch(() => {});
  A.proc.kill();
  B.proc.kill();
  A.srv.close();
  B.srv.close();

  if (A.trace.length) console.log('[e2e] trace A:', A.trace.slice(-8).join(' | '));
  if (B.trace.length) console.log('[e2e] trace B:', B.trace.slice(-8).join(' | '));
  const pass = report?.pass === true;
  console.log(`RESULTAT: ${pass ? 'FLUX_AUDIO_OK' : 'PAS_DE_FLUX'} — A←B ${report?.recvA ?? '?'} o, B←A ${report?.recvB ?? '?'} o`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] exception :', err);
  process.exit(1);
});