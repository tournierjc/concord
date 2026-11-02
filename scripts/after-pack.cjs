/**
 * after-pack.cjs — electron-builder `afterPack` hook: verify the packaged app.asar before any
 * installer is produced, and make the SUID sandbox helper actually setuid.
 *
 * A stale or missing preload fails the build instead of shipping. A non-setuid `chrome-sandbox`
 * ships an app that cannot start its sandbox on Ubuntu 24.04+ (AppArmor restricts unprivileged
 * user namespaces, so Electron falls back to the SUID helper and refuses to start when the bit is
 * missing — the .deb must carry it, mode preserved by dpkg). The AppImage cannot keep the bit
 * (FUSE mounts are `nosuid`): it relies on user namespaces, allowed wherever they are not
 * restricted.
 */
const { chmodSync, statSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources');
  const { verify } = await import('./verify-build.mjs');
  const { target, problems } = verify({ asarPath: join(resources, 'app.asar') });
  if (problems.length > 0) {
    throw new Error(`[after-pack] paquet invalide (${target}) :\n  - ${problems.join('\n  - ')}`);
  }
  console.log(`[after-pack] OK ${target}`);

  if (context.electronPlatformName === 'linux') {
    const sandbox = join(context.appOutDir, 'chrome-sandbox');
    if (statSync(sandbox).mode & 0o4000) {
      console.log('[after-pack] chrome-sandbox déjà setuid');
    } else {
      chmodSync(sandbox, 0o4755);
      console.log('[after-pack] chrome-sandbox passé en setuid root (4755)');
    }
  }
};
