import { createDuckingController, RESTORE_HOLD_MS } from './src/main/ducking.ts';

const FIX = `Sink Input #12
\tIndex: 12
\tApplication Name: Firefox
`;
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
const exec = {
  async run(command: any) {
    calls.push({ command, at: time });
    await advance(10);
    if (command.tool === 'pactl' && command.kind === 'list') return { stdout: FIX };
    return { stdout: 'ok' };
  },
};
const c = createDuckingController({ platform: 'linux', exec, timers, trace: (l) => console.log('TRACE', l) });
c.apply({ active: true, at: time });
await advance(1);
console.log('after advance1 alarms', alarms.map(a=>({id:a.id,at:a.at,cancelled:a.cancelled})), 'running?');
c.apply({ active: false, at: time });
console.log('after apply(false) alarms', alarms.map(a=>({id:a.id,at:a.at,cancelled:a.cancelled})));
await advance(500);
console.log('after advance500', alarms.map(a=>({id:a.id,at:a.at,cancelled:a.cancelled})), 'time', time);
await fireWithin(RESTORE_HOLD_MS);
for (let i = 0; i < 80; i++) { const b = calls.length; await advance(1); if (calls.length === b) break; }
console.log(JSON.stringify(calls));
console.log('ducked:', c.state().ducked, 'alarms', alarms.map(a=>({id:a.id,at:a.at,cancelled:a.cancelled})));
