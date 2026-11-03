/**
 * e2e/media-flow.e2e.mjs — deux postes Chromium RÉELS, le vrai tuyau de signalisation,
 * le vrai câblage de voix du renderer, et une preuve MESURÉE de flux audio.
 *
 * POURQUOI CE FICHIER (2026-11-02, demande JC : « faire des tests e2e et itérer jusqu'à
 * avoir un flux audio qui fonctionne »). Chaque couche unitaire est verte depuis des
 * semaines et le LAN échoue quand même — la seule façon de clore le débat « pas de flux
 * audio » est de rejouer le trajet complet avec le MÊME moteur WebRTC que l'app :
 *
 *   poste A (hôte) ── createSignalingLink role:host ── TCP 127.0.0.1 (le vrai protocole,
 *                    dont le filtre ICE LAN) ── poste B (client)
 *   les deux postes exécutent createVoiceWiring (e2e/poste.html → src/renderer/voice-mesh.ts)
 *   — le VRAI code de production : plan média, maillage, séquence micro→mesh→tampon — dans
 *   une page Chromium headless (le même moteur que l'Electron de l'app), transpilée par vite.
 *
 * Ce qui est bouchonné, et pourquoi c'est légitime :
 *   • le micro : --use-fake-device-for-media-stream (tonalité 6 kHz) = la vraie API
 *     getUserMedia avec une source déterministe ;
 *   • le réseau LAN : loopback + --force-webrtc-ip-handling-migration pour FORCER le
 *     comportement Chromium >= 109 (mDNS) que le correctif 0.4.8 doit neutraliser ;
 *   • la découverte mDNS : le rôle hôte/client est choisi directement (la découverte a ses
 *     propres tests ; deux Chromium sur la même machine verraient le même beacon).
 *
 * La PREUVE n'est pas un « connected » auto-déclaré : bytesReceived mesuré via getStats()
 * sur la vraie RTCPeerConnection du pair. Des octets audio entrants > 0 valent un flux audio.
 *
 * Exécution :  node e2e/media-flow.e2e.mjs    (s'auto-relance sous tsx pour les imports .ts)
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

const { createSignalingLink } = await import('../src/main/signaling-link.ts');
const { systemTimers } = await import('../src/main/timers.ts');

/* ------------------------------------------------------------------ */
/* Chromium                                                            */
/* ------------------------------------------------------------------ */

const CHROME = process.env.CHROME_PATH
  ?? '/opt/data/.pw-browsers/chromium-1234/chrome-linux/chrome';
if (!existsSync(CHROME)) {
  console.error(`[e2e] Chromium introuvable : ${CHROME} (surcharger avec CHROME_PATH=…)`);
  process.exit(2);
}

/**
 * --force-webrtc-ip-handling-migration rétablit l'obfuscation mDNS de Chromium >= 109 :
 * c'est LA condition qui cassait l'audio sur le LAN. --disable-features=… est le switch
 * du correctif 0.4.8 (src/main/index.ts) : les deux ensemble reproduisent l'app d'aujourd'hui.
 */
const CHROME_FLAGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--force-webrtc-ip-handling-migration',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--allow-insecure-localhost',
  '--mute-audio',
];

/* ------------------------------------------------------------------ */
/* Un poste = un Node (tuyau) + une page Chromium (média)              */
/* ------------------------------------------------------------------ */

async function launchPost(label) {
  const profileDir = mkdtempSync(join(tmpdir(), 'concord-e2e-profile-'));
  const args = [
    ...CHROME_FLAGS,
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: proc.stderr });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] aucun endpoint de debug en 30 s`)), 30000);
    rl.on('line', (line) => {
      const m = line.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`[${label}] Chromium a quitté (code ${code})`)));
  });

  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error' || t.includes('[e2e-poste]')) console.log(`  [${label}] ${t}`);
  });
  page.on('pageerror', (err) => console.log(`  [${label}] pageerror: ${err.message}`));
  return { label, proc, browser, page };
}

async function startVite(BASE) {
  // Les modules de production sont en TypeScript : c'est vite qui les transpile pour Chromium.
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: BASE,
    server: { host: '127.0.0.1', port: 5199, strictPort: false },
    logLevel: 'silent',
  });
  await server.listen();
  return server;
}

/* ------------------------------------------------------------------ */
/* Scénario principal                                                  */
/* ------------------------------------------------------------------ */

function totalInbound(stats) {
  if (stats === null || stats.error !== undefined) return -1;
  let total = 0;
  for (const per of Object.values(stats.peers ?? {})) {
    total += typeof per.bytesReceived === 'number' ? per.bytesReceived : 0;
  }
  return total;
}

async function main() {
  const BASE = new URL('..', import.meta.url).pathname;
  const server = await startVite(BASE);
  const port = server.config.server.port;

  const A = await launchPost('A/hôte');
  const B = await launchPost('B/client');
  const url = `http://127.0.0.1:${port}/e2e/poste.html`;
  await A.page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await B.page.goto(url, { waitUntil: 'load', timeout: 60000 });

  const SIGNALING_PORT = 47821;

  // --- Poste A : hôte. Le VRAI lien de signalisation de la coquille, bouclé sur la page. ---
  const aLink = createSignalingLink({
    role: 'host',
    localId: 'jeanjean',
    name: 'jeanjean',
    host: '127.0.0.1',
    port: SIGNALING_PORT,
    now: () => systemTimers.now(),
    onMessage: (msg) => { void A.page.evaluate((m) => window.__pushSignal(m), msg); },
  });
  await A.page.evaluate((id) => window.__open(id), 'jeanjean');
  const drainA = setInterval(() => {
    void A.page.evaluate(() => { const o = window.__posts.outbox; window.__posts.outbox = []; return o; })
      .then((out) => { for (const m of out) aLink.send(m); });
  }, 20);

  // --- Poste B : client, sur le même lien réel (rôle client, port lu comme dans l'app). ---
  const bLink = createSignalingLink({
    role: 'client',
    localId: 'krillin',
    name: 'krillin',
    host: '127.0.0.1',
    port: SIGNALING_PORT,
    now: () => systemTimers.now(),
    onMessage: (msg) => { void B.page.evaluate((m) => window.__pushSignal(m), msg); },
  });
  await B.page.evaluate((id) => window.__open(id), 'krillin');
  const drainB = setInterval(() => {
    void B.page.evaluate(() => { const o = window.__posts.outbox; window.__posts.outbox = []; return o; })
      .then((out) => { for (const m of out) bLink.send(m); });
  }, 20);

  // --- Attendre la PREUVE (octets entrants), pas l'avis des pairs. ---
  const DEADLINE = Date.now() + 60000;
  let report = null;
  while (Date.now() < DEADLINE) {
    await new Promise((r) => setTimeout(r, 2000));
    const [sa, sb] = await Promise.all([
      A.page.evaluate(() => window.__peerStats()),
      B.page.evaluate(() => window.__peerStats()),
    ]);
    const recvA = totalInbound(sa);
    const recvB = totalInbound(sb);
    console.log(`[e2e] A<-B ${recvA} o · B<-A ${recvB} o · états A=${JSON.stringify(sa.states ?? {})} B=${JSON.stringify(sb.states ?? {})}`);
    report = { pass: recvA > 0 && recvB > 0, recvA, recvB, sa, sb };
    if (report.pass) break;
  }

  clearInterval(drainA);
  clearInterval(drainB);
  aLink.close('fin de test');
  bLink.close('fin de test');
  await A.browser.close().catch(() => {});
  await B.browser.close().catch(() => {});
  A.proc.kill();
  B.proc.kill();
  await server.close().catch(() => {});

  if (report === null) {
    console.log('RESULTAT: ECHEC — aucun rapport');
    process.exit(1);
  }
  console.log(`RESULTAT: ${report.pass ? 'FLUX_AUDIO_OK' : 'PAS_DE_FLUX'}`);
  console.log(JSON.stringify({ recvA: report.recvA, recvB: report.recvB, A: report.sa, B: report.sb }, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] exception :', err);
  process.exit(1);
});
