/**
 * after-pack.cjs — electron-builder `afterPack` hook: verify the packaged app.asar before any
 * installer is produced. A stale or missing preload fails the build instead of shipping.
 */
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
};
