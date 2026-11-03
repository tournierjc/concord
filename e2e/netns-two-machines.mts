/**
 * e2e/netns-two-machines.mts — le LAN à deux machines, rejoué LOCALEMENT.
 *
 * Le vrai test du bug JC (Windows <-> Linux, « pas de flux audio ») : deux postes sur des
 * adresses LAN DIFFÉRENTES, jamais de loopback pour l'ICE. Netns (espaces réseau isolés) +
 * veth (câble virtuel) + un pont Linux 10.99.0.0/24, sans root grâce à `unshare -Urn`.
 *
 * Chaque namespace tient un port de signalisation distinct (47821 / 47822) : c'est exactement
 * le cas réel où l'annonce mDNS/TXT de l'hôte porte l'ip:port que le client doit joindre.
 *
 * Exécution : unshare -Urn npx tsx e2e/netns-two-machines.mts
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const CHROME = process.env.CHROME_PATH ?? '/opt/data/.pw-browsers/chromium-1234/chrome-linux/chrome';
const RUN_IN_NS = process.env.__CONCORD_E2E_NS === '1';

if (!RUN_IN_NS) {
  // S'auto-relancer dans un namespace r\u00e9seau rootless : `ip` n'existe qu' DANS le NS.
  const here = new URL(import.meta.url).pathname;
  const r = spawnSync('unshare', ['-Urn', 'npx', 'tsx', here, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, __CONCORD_E2E_NS: '1' },
  });
  process.exit(r.status ?? 1);
}

function run(cmd: string, allowFail = false): string {
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw new Error(`\`${cmd}\` échoue (${r.status}) : ${r.stderr}`);
  return r.stdout ?? '';
}

async function waitInterface(name: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (run(`ip -o link show ${name} 2>/dev/null`, true).includes(name)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`interface ${name} jamais apparue`);
}

/* ------------------------------------------------------------------ */
/* Topologie                                                           */
/* ------------------------------------------------------------------ */

// Pont + deux câbles veth, montés par le réseau par défaut du NS courant.
run('ip link add br0 type bridge');
run('ip link set lo up');

async function makePost(name: string, nsIp: string, peerName: string, hostName: string): Promise<void> {
  run(`ip netns add ${name}`);
  run(`ip link add ${peerName} type veth peer name ${hostName}`);
  run(`ip link set ${hostName} master br0`);
  run(`ip link set ${hostName} up`);
  run(`ip link set ${peerName} netns ${name}`);
  run(`ip -n ${name} link set lo up`);
  run(`ip -n ${name} link set ${peerName} up`);
  run(`ip -n ${name} addr add ${nsIp}/24 dev ${peerName}`);
  await waitInterface(`${name}!${peerName}`);
}

await makePost('nsA', '10.99.0.11', 'va0', 'va1');
await makePost('nsB', '10.99.0.12', 'vb0', 'vb1');
console.log('[netns] topologie prête : nsA=10.99.0.11 nsB=10.99.0.12 via br0');

/* ------------------------------------------------------------------ */
/* Les deux postes                                                     */
/* ------------------------------------------------------------------ */

const { createSignalingLink } = await import('../src/main/signaling-link.ts');
const { systemTimers } = await import('../src/main/timers.ts');

const CHROME_FLAGS = [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--force-webrtc-ip-handling-migration',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--mute-audio',
];

async function launchPost(label: string, nsName: string) {
  const dir = mkdtempSync(join(tmpdir(), `concord-netns-${label}-`));
  const proc = spawn('ip', ['netns', 'exec', nsName, CHROME, ...CHROME_FLAGS,
    '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = createInterface({ input: proc.stderr });
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] aucun endpoint de debug (30 s)`)), 30000);
    rl.on('line', (line) => {
      const m = line.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`[${label}] Chromium a quitté (${code})`)));
  });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || t.includes('[e2e-poste]') || t.includes('[mesh]') || t.includes('[media-plane')) {
      console.log(`  [${label}] ${t}`);
    }
  });
  page.on('pageerror', (e) => console.log(`  [${label}] pageerror ${e.message}`));
  return { label, proc, browser, page, dir };
}

const { build } = await import('esbuild');
const built = await build({
  entryPoints: [join(import.meta.dirname, 'poste-bundle.ts')],
  bundle: true, format: 'iife', write: false, target: 'chrome120', legalComments: 'none',
});
const bundle = built.outputFiles[0].text;

function wirePost(page: import('puppeteer-core').Page, localId: string, sendToLink: (m: unknown) => void) {
  const push = (m: unknown) => { void page.evaluate((msg) => (globalThis as any).__pushSignal(msg), m).catch(() => {}); };
  const drain = setInterval(() => {
    void page.evaluate(() => {
      const g = globalThis as any;
      const o: unknown[] = g.__outbox ?? [];
      const c = o.slice();
      o.length = 0;
      return c;
    }).then((out: unknown[]) => { for (const m of out) sendToLink(m); }).catch(() => {});
  }, 20);
  return { push, drain };
}

async function main() {
  const A = await launchPost('A', 'nsA');
  const B = await launchPost('B', 'nsB');
  for (const post of [A, B]) {
    await post.page.goto('about:blank');
    await post.page.addScriptTag({ content: bundle });
    // La page installe le wiring (même API que le pilote loopback : __pushSignal / __outbox / __open).
    await post.page.evaluate(() => {
      const g = globalThis as any;
      g.__outbox = [];
      g.__states = {};
      g.__flows = [];
      const { createMediaPlane, createMesh } = g.__factory;
      const timers = { once: (ms: number, cb: () => void) => setTimeout(cb, ms), cancel: (h: unknown) => clearTimeout(h as number) };
      g.__openPost = async (localId: string) => {
        const plane = createMediaPlane({
          localId, timers, microOpenOnStart: true,
          onLocalCandidate: (peerId: string, c: unknown) => { g.__outbox.push({ kind: 'ice', to: peerId, payload: c }); },
        });
        await plane.startMicrophone();
        const mesh = createMesh({
          localId, plane, timers,
          send: (m: unknown) => { g.__outbox.push(m); },
          onPeerState: (peerId: string, s: string, cause: string) => { g.__states[peerId] = s + '(' + cause + ')'; },
          onRemoteStream: (peerId: string, stream: MediaStream) => { g.__flows.push(peerId); mesh.onRemoteStream(peerId, stream); },
        });
        g.__plane = plane;
        g.__mesh = mesh;
        g.__pushSignal = (m: unknown) => { void mesh.onSignal(m); };
        return true;
      };
      g.__peerStats = async () => {
        const out: Record<string, unknown> = {};
        for (const p of g.__mesh.peers()) out[p] = await g.__plane.stats(p);
        return { peers: out, states: g.__states, flows: g.__flows };
      };
    });
  }

  // A héberge sur SON ip nsA, B rejoint l'ip de A — exactement ce que fait l'app (TXT = ip:port).
  const aLink = createSignalingLink({
    role: 'host', localId: 'jeanjean', name: 'jeanjean',
    host: '10.99.0.11', port: 47821,
    now: () => systemTimers.now(),
    onMessage: () => {},
  });
  // attendre le bind
  for (let i = 0; i < 100 && aLink.listen === null; i++) await new Promise((r) => setTimeout(r, 50));
  if (aLink.listen === null) throw new Error('hôte jamais lié sur 10.99.0.11:47821');
  console.log('[netns] hôte lié', JSON.stringify(aLink.listen));

  const aWire = wirePost(A.page, 'jeanjean', (m) => aLink.send(m as never));
  aLink.close('câblage refait main en main');
  // (le lien ci-dessus ne servait qu'au bind ; le vrai lien passe par le host netns)
  await A.page.evaluate((id) => (globalThis as any).__openPost(id), 'jeanjean');

  const bLink = createSignalingLink({
    role: 'client', localId: 'krillin', name: 'krillin',
    host: '10.99.0.11', port: 47821,
    now: () => systemTimers.now(),
    onMessage: () => {},
  });
  await B.page.evaluate((id) => (globalThis as any).__openPost(id), 'krillin');
  const bWire = wirePost(B.page, 'krillin', (m) => bLink.send(m as never));

  // A doit être jointable DEPUIS nsB : vérifier le TCP d'abord (diagnostic, pas une supposition).
  const tcpOk = run(`ip netns exec nsB sh -c 'timeout 3 bash -c "</dev/tcp/10.99.0.11/47821" && echo TCP_OK || echo TCP_FAIL'`, true);
  console.log('[netns] TCP nsB->nsA:47821 =>', tcpOk.trim());

  const deadline = Date.now() + 60000;
  let verdict: 'OK' | 'KO' = 'KO';
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const [sa, sb] = await Promise.all([
      A.page.evaluate(() => (globalThis as any).__peerStats()).catch(() => ({ error: 'page A' })),
      B.page.evaluate(() => (globalThis as any).__peerStats()).catch(() => ({ error: 'page B' })),
    ]);
    const inB = sumIn(sa);
    const inA = sumIn(sb);
    last = `A←B ${inB} o ${JSON.stringify(sa.states ?? {})} · B←A ${inA} o ${JSON.stringify(sb.states ?? {})}`;
    console.log('[netns] ' + last);
    if (inA > 0 && inB > 0) { verdict = 'OK'; break; }
  }

  clearInterval(aWire.drain);
  clearInterval(bWire.drain);
  aLink.close('fin');
  bLink.close('fin');
  await A.browser.close().catch(() => {});
  await B.browser.close().catch(() => {});
  A.proc.kill(); B.proc.kill();
  rmSync(A.dir, { recursive: true, force: true });
  rmSync(B.dir, { recursive: true, force: true });
  console.log(`RESULTAT: ${verdict === 'OK' ? 'FLUX_AUDIO_OK' : 'PAS_DE_FLUX'} — ${last}`);
  process.exit(verdict === 'OK' ? 0 : 1);
}

function sumIn(report: { peers?: Record<string, { bytesReceived?: number }> } | { error: string }): number {
  if ('error' in report) return -1;
  let total = 0;
  for (const v of Object.values(report.peers ?? {})) total += v.bytesReceived ?? 0;
  return total;
}

main().catch((err) => {
  console.error('[netns] exception :', err);
  run('ip netns del nsA 2>/dev/null; ip netns del nsB 2>/dev/null', true);
  process.exit(1);
});
