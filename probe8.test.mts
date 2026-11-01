import test from 'node:test';
import { createDuckingController, RESTORE_HOLD_MS } from './src/main/ducking.ts';

test('trace noop', async () => {
  interface Alarm { id: number; at: number; cb: () => void; cancelled: boolean }
  let time = 0; let nextId = 1;
  const alarms: Alarm[] = [];
  const timers = {
    once(ms: number, cb: () => void) { const a = { id: nextId++, at: time + ms, cb, cancelled: false }; alarms.push(a); return a.id; },
    cancel(h: unknown) { const a = alarms.find((x) => x.id === h); if (a) a.cancelled = true; },
  };
  async function advance(ms: number) { const t = time + ms; while (time < t) { time += Math.min(1, t - time); await Promise.resolve(); } }
  async function fireWithin(ms: number) {
    const due = alarms.filter((a) => !a.cancelled && a.at <= time + ms).sort((a, b) => a.at - b.at);
    for (const a of due) { if (a.cancelled) continue; time = Math.max(time, a.at); a.cancelled = true; a.cb(); await Promise.resolve(); await Promise.resolve(); }
  }
  const calls: any[] = [];
  const exec = { async run(command: any) { calls.push(command); return { stdout: 'ok' }; } };
  const traced: string[] = [];
  const c = createDuckingController({ platform: 'darwin', exec, timers, trace: (l) => traced.push(l) });
  c.apply({ active: true, at: 0 });
  c.apply({ active: false, at: 1000 });
  await fireWithin(RESTORE_HOLD_MS);
  for (let i = 0; i < 20; i++) { const b = calls.length; await advance(1); if (calls.length === b) break; }
  console.log('calls', calls.length, 'traced', JSON.stringify(traced));
});
