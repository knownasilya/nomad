const path = require('path');
const { execFileSync } = require('child_process');

// afterPack runs after the .app is assembled but BEFORE electron-builder's own
// code-signing step and BEFORE the app is packaged into dmg/zip. This is the
// correct place to ad-hoc sign when no real certificate is available.
//
// Previously this lived in afterAllArtifactBuild, which runs AFTER the dmg/zip
// are built — so the published artifacts shipped the unsigned app (the default
// Apple-linker signature, Identifier=Electron, flags=adhoc,linker-signed). That
// app's hardened renderer/helper processes fail to launch, so windows render
// blank and nomad:// pages fall through to chrome-error (ERR_UNKNOWN_URL_SCHEME).
// Only the throwaway loose copy in dist/mac-*/ got signed, which never ships.
//
// When a real signing identity IS configured, do nothing — electron-builder
// signs (and afterSignHook notarizes) right after this hook.
module.exports = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;

  const hasRealIdentity =
    !!process.env.CSC_LINK || process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false';
  if (hasRealIdentity) {
    console.log(
      'afterPack: real signing identity configured — leaving signing to electron-builder'
    );
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const entitlements = path.join(__dirname, '../build/entitlements.plist');

  // The app will still trigger Gatekeeper on first launch when downloaded
  // (not notarized) — right-click → Open to bypass.
  console.log(`afterPack: no certificate — ad-hoc signing ${appPath}`);
  execFileSync(
    'codesign',
    [
      '--deep',
      '--force',
      '--sign',
      '-',
      '--options',
      'runtime',
      '--entitlements',
      entitlements,
      appPath,
    ],
    { stdio: 'inherit' }
  );
  console.log('afterPack: ad-hoc signing complete');
};
