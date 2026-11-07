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
//
// NOMAD_MAC_SIGN_IDENTITY names a self-signed certificate (set by the release
// workflow). Squirrel.Mac only installs an update whose signature satisfies the
// running app's designated requirement; an ad-hoc requirement is the build's own
// cdhash, so ad-hoc builds can never auto-update. A self-signed identity gives
// every build the same requirement, so updates install.
module.exports = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;

  // VMP signing has to come before code signing on macOS, and this hook runs before both.
  vmpSign(context);

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

  const identity = process.env.NOMAD_MAC_SIGN_IDENTITY || '-';

  // The app will still trigger Gatekeeper on first launch when downloaded
  // (not notarized) — right-click → Open to bypass.
  console.log(
    identity === '-'
      ? `afterPack: no certificate — ad-hoc signing ${appPath}`
      : `afterPack: signing ${appPath} with "${identity}"`
  );
  execFileSync(
    'codesign',
    [
      '--deep',
      '--force',
      '--timestamp=none',
      '--sign',
      identity,
      '--options',
      'runtime',
      '--entitlements',
      entitlements,
      appPath,
    ],
    { stdio: 'inherit' }
  );
  console.log('afterPack: signing complete');
};

// Widevine VMP signing (Verified Media Path), for DRM video: Prime Video, Netflix and the like refuse
// to send a license to an app without a production VMP signature. Only castLabs' Electron build
// ("ECS", version ends in +wvcus) has Widevine at all, and the signature comes from castLabs EVS
// (a free account). The release workflow logs in with the EVS_ACCOUNT_NAME / EVS_PASSWD secrets;
// without them the build ships with castLabs' development signature only. Linux has no VMP.
// See app/bg/widevine.js and docs/releasing.md.
function vmpSign(context) {
  const version = electronVersion(context);
  if (!/wvcus/.test(version)) {
    console.log(`afterPack: Electron ${version || '?'} is not a castLabs build — no Widevine, skipping VMP signing`);
    return;
  }
  if (!process.env.EVS_ACCOUNT_NAME) {
    console.log(
      'afterPack: EVS_ACCOUNT_NAME is not set — skipping VMP signing; DRM streaming sites may refuse to play'
    );
    return;
  }
  console.log(`afterPack: VMP signing ${context.appOutDir}`);
  const env = { ...process.env, EVS_NO_ASK: '1' };
  // sign-pkg takes the directory that holds the .app.
  execFileSync('python3', ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], {
    stdio: 'inherit',
    env,
  });
  execFileSync('python3', ['-m', 'castlabs_evs.vmp', 'verify-pkg', context.appOutDir], {
    stdio: 'inherit',
    env,
  });
  console.log('afterPack: VMP signing complete');
}

function electronVersion(context) {
  const fromConfig = context.packager.config && context.packager.config.electronVersion;
  if (fromConfig) return String(fromConfig);
  try {
    const pkg = require.resolve('electron/package.json', { paths: [context.packager.projectDir] });
    return require(pkg).version || '';
  } catch (e) {
    return '';
  }
}
