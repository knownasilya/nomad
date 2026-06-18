const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// afterAllArtifactBuild — always called after electron-builder finishes,
// even when signing was skipped. Ad-hoc sign the .app if no real certificate
// was applied, so entitlements (JIT, unsigned-executable-memory) are
// enforced and sandboxed Chromium renderers can start.
//
// The app will still trigger Gatekeeper on first launch when downloaded —
// right-click → Open to bypass.
module.exports = async function (buildResult) {
  if (process.platform !== 'darwin') return;

  const outDir = buildResult.outDir;
  const entitlements = path.join(__dirname, '../build/entitlements.plist');

  // mac output dirs are named mac, mac-arm64, mac-x64, etc.
  let macDirs;
  try {
    macDirs = fs.readdirSync(outDir).filter(d => d.startsWith('mac'));
  } catch (_) {
    return;
  }

  for (const dir of macDirs) {
    const dirPath = path.join(outDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const apps = fs.readdirSync(dirPath).filter(f => f.endsWith('.app'));
    for (const appName of apps) {
      const appPath = path.join(dirPath, appName);

      let realSig = false;
      try {
        execFileSync('codesign', ['-v', '--strict', appPath], { stdio: 'ignore' });
        realSig = true;
      } catch (_) {}

      if (!realSig) {
        console.log(`No real signature — ad-hoc signing ${appPath}`);
        execFileSync('codesign', [
          '--deep', '--force', '--sign', '-',
          '--options', 'runtime',
          '--entitlements', entitlements,
          appPath,
        ]);
        console.log('Ad-hoc signing complete');
      }
    }
  }
};
