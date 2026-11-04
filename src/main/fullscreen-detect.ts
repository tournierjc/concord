/**
 * fullscreen-detect.ts — un jeu ou une application plein écran est-il au premier plan ?
 *
 * Pur pour la décision (`classifyProbe`) : les tests n'ouvrent aucun processus.
 * `createFullscreenProbe` interroge le système environ une fois par seconde.
 *
 * Windows : `GetForegroundWindow` + rectangle contre l'écran, et
 * `SHQueryUserNotificationState` (QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN,
 * QUNS_PRESENTATION_MODE). Un jeu borderless qui couvre l'écran compte aussi.
 * Le bureau (Progman, WorkerW, barre des tâches) et le processus Concord sont ignorés.
 *
 * Linux X11 / XWayland : `_NET_WM_STATE_FULLSCREEN`, ou une fenêtre qui couvre
 * l'écran, via `xprop` / `xwininfo`. plasmashell, kwin, mutter et gnome-shell
 * ne comptent pas.
 *
 * Wayland natif : si `xprop` ne répond pas, la détection est impossible.
 * L'overlay reste caché, sauf le réglage `overlay.showWithoutDetection`.
 * Sous une session Wayland, Concord démarre en XWayland par défaut
 * (`preferX11Ozone`) : les jeux X11 sont vus. Un jeu uniquement Wayland peut
 * rester invisible pour la sonde.
 */

import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export const FULLSCREEN_POLL_MS = 1000;

export interface FullscreenSnapshot {
  readonly fullscreenApp: boolean;
  /** Vrai quand la sonde ne peut pas répondre (Wayland natif, outil absent). */
  readonly detectionUnavailable: boolean;
}

export interface FullscreenPort {
  snapshot(): FullscreenSnapshot;
  /** Relance une lecture. Le résultat arrive au `snapshot()` suivant. */
  refresh?(): void;
}

const SHELL_CLASSES = [
  'progman',
  'workerw',
  'shell_traywnd',
  'shell_secondarytraywnd',
  'plasmashell',
  'kwin',
  'kwin_wayland',
  'mutter',
  'gnome-shell',
  'xfce4-panel',
];

/** QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE. */
const WINDOWS_FULLSCREEN_QUNS = new Set(['2', '3', '4']);

export function classifyProbe(input: {
  platform: string;
  sessionType?: string;
  ownPid: number;
  /** Texte produit par la sonde, ou `null` si la commande a échoué. */
  report: string | null;
}): FullscreenSnapshot {
  const unavailable: FullscreenSnapshot = { fullscreenApp: false, detectionUnavailable: true };
  if (input.report === null || input.report.trim() === '') return unavailable;
  const fields = parseFields(input.report);
  if (fields['status'] === 'unavailable') return unavailable;

  const pid = Number(fields['pid'] ?? '');
  if (input.ownPid > 0 && pid === input.ownPid) {
    return { fullscreenApp: false, detectionUnavailable: false };
  }
  const className = (fields['class'] ?? '').toLowerCase();
  const owner = (fields['owner'] ?? '').toLowerCase();
  if (SHELL_CLASSES.some((entry) => className.includes(entry) || owner.includes(entry))) {
    return { fullscreenApp: false, detectionUnavailable: false };
  }
  if (owner === 'explorer.exe' && (className === '' || SHELL_CLASSES.some((entry) => className.includes(entry)))) {
    return { fullscreenApp: false, detectionUnavailable: false };
  }

  const flagged =
    (fields['state'] ?? '').includes('FULLSCREEN') ||
    fields['full'] === '1' ||
    WINDOWS_FULLSCREEN_QUNS.has(fields['quns'] ?? '');
  if (flagged || coversScreen(fields)) {
    return { fullscreenApp: true, detectionUnavailable: false };
  }
  return { fullscreenApp: false, detectionUnavailable: false };
}

function parseFields(report: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of report.split(/[\n;]/u)) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    fields[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim();
  }
  return fields;
}

function coversScreen(fields: Record<string, string>): boolean {
  const wx = num(fields['wx']);
  const wy = num(fields['wy']);
  const ww = num(fields['ww']);
  const wh = num(fields['wh']);
  const sw = num(fields['sw']);
  const sh = num(fields['sh']);
  if (ww === null || wh === null || sw === null || sh === null || sw < 100 || sh < 100) return false;
  const slack = 8;
  const left = wx ?? 0;
  const top = wy ?? 0;
  return left <= slack && top <= slack && left + ww >= sw - slack && top + wh >= sh - slack;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * PowerShell persistant : Add-Type une fois, puis une ligne de réponse par
 * ligne lue sur stdin. Le minuteur n'en paie le démarrage qu'une fois.
 */
export const WINDOWS_PROBE_LOOP = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ConcordFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
while ($true) {
  if ($null -eq [Console]::In.ReadLine()) { break }
  $hwnd = [ConcordFg]::GetForegroundWindow()
  $rect = New-Object ConcordFg+RECT
  [void][ConcordFg]::GetWindowRect($hwnd, [ref]$rect)
  $proc = 0
  [void][ConcordFg]::GetWindowThreadProcessId($hwnd, [ref]$proc)
  $cls = New-Object System.Text.StringBuilder 256
  [void][ConcordFg]::GetClassName($hwnd, $cls, $cls.Capacity)
  $quns = 0
  [void][ConcordFg]::SHQueryUserNotificationState([ref]$quns)
  $owner = ''
  try { $owner = (Get-Process -Id $proc -ErrorAction Stop).ProcessName } catch { $owner = '' }
  $screen = [System.Windows.Forms.Screen]::FromHandle($hwnd).Bounds
  $ww = $rect.Right - $rect.Left
  $wh = $rect.Bottom - $rect.Top
  Write-Output ("status=ok;pid=$proc;class=$($cls.ToString());owner=$owner;quns=$quns;wx=$($rect.Left);wy=$($rect.Top);ww=$ww;wh=$wh;sw=$($screen.Width);sh=$($screen.Height)")
}
`.trim();

/** Sonde X11. `status=unavailable` si xprop ne voit pas de fenêtre active. */
export const LINUX_PROBE_SCRIPT = `
active=$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk -F'#' 'NF{print $NF}' | tr -d ' ')
if [ -z "$active" ] || [ "$active" = "0x0" ]; then echo status=ok; echo full=0; exit 0; fi
pid=$(xprop -id "$active" _NET_WM_PID 2>/dev/null | awk 'END{print $NF}')
class=$(xprop -id "$active" WM_CLASS 2>/dev/null | sed -n 's/.*"\\(.*\\)"$/\\1/p' | tail -n 1)
state=$(xprop -id "$active" _NET_WM_STATE 2>/dev/null)
geom=$(xwininfo -id "$active" 2>/dev/null)
root=$(xwininfo -root 2>/dev/null)
wx=$(printf '%s\\n' "$geom" | awk '/Absolute upper-left X/{print $NF}')
wy=$(printf '%s\\n' "$geom" | awk '/Absolute upper-left Y/{print $NF}')
ww=$(printf '%s\\n' "$geom" | awk '/^  Width:/{print $NF}')
wh=$(printf '%s\\n' "$geom" | awk '/^  Height:/{print $NF}')
sw=$(printf '%s\\n' "$root" | awk '/^  Width:/{print $NF}')
sh=$(printf '%s\\n' "$root" | awk '/^  Height:/{print $NF}')
if [ -z "$state" ] && [ -z "$ww" ]; then echo status=unavailable; exit 0; fi
echo "status=ok"
echo "pid=\${pid:-0}"
echo "class=$class"
echo "state=$state"
echo "wx=\${wx:-0}"
echo "wy=\${wy:-0}"
echo "ww=\${ww:-0}"
echo "wh=\${wh:-0}"
echo "sw=\${sw:-0}"
echo "sh=\${sh:-0}"
`.trim();

function runCommand(file: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : String(stdout));
    });
  });
}

/**
 * Sonde système. `snapshot()` rend la dernière lecture ; `refresh()` en lance une.
 * Aucun processus n'est ouvert tant que `refresh` n'est pas appelé.
 * Sous Windows le PowerShell reste vivant : Add-Type n'est pas rejoué chaque seconde.
 */
export function createFullscreenProbe(options?: {
  platform?: string;
  sessionType?: string;
  ownPid?: number;
  run?: (file: string, args: string[]) => Promise<string | null>;
}): FullscreenPort {
  const platform = options?.platform ?? process.platform;
  const sessionType = options?.sessionType ?? process.env.XDG_SESSION_TYPE;
  const ownPid = options?.ownPid ?? process.pid;
  const run: (file: string, args: string[]) => Promise<string | null> =
    options?.run ?? ((file, args) => runCommand(file, args, 800));
  let latest: FullscreenSnapshot = { fullscreenApp: false, detectionUnavailable: false };
  let pending = false;
  let windows: WindowsHelper | null = null;

  async function read(): Promise<void> {
    if (platform === 'win32' && options?.run === undefined) {
      windows ??= new WindowsHelper();
      const report = await windows.ask();
      latest = classifyProbe({ platform, sessionType, ownPid, report });
      return;
    }
    if (platform === 'linux' || (platform === 'win32' && options?.run !== undefined)) {
      const report =
        platform === 'win32'
          ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output status=unavailable'])
          : await run('sh', ['-c', LINUX_PROBE_SCRIPT]);
      latest = classifyProbe({ platform, sessionType, ownPid, report });
      return;
    }
    // macOS : pas de sonde ici. Caché, sauf le réglage qui force l'affichage.
    latest = { fullscreenApp: false, detectionUnavailable: true };
  }

  return {
    snapshot: () => latest,
    refresh(): void {
      if (pending) return;
      pending = true;
      void read()
        .catch(() => {
          latest = { fullscreenApp: false, detectionUnavailable: true };
        })
        .finally(() => {
          pending = false;
        });
    },
  };
}

/** PowerShell gardé ouvert : une ligne écrite, une ligne lue. */
class WindowsHelper {
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private buffer = '';
  private waiter: ((line: string | null) => void) | null = null;

  constructor() {
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROBE_LOOP], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      const index = this.buffer.indexOf('\n');
      if (index === -1 || this.waiter === null) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      const resolve = this.waiter;
      this.waiter = null;
      resolve(line);
    });
    this.child.on('error', () => {
      this.waiter?.(null);
      this.waiter = null;
    });
    this.child.on('exit', () => {
      this.waiter?.(null);
      this.waiter = null;
    });
  }

  ask(): Promise<string | null> {
    return new Promise((resolve) => {
      this.waiter = resolve;
      try {
        this.child.stdin.write('\n');
      } catch {
        this.waiter = null;
        resolve(null);
      }
    });
  }
}
