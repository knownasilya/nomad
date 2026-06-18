const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { notarize } = require('@electron/notarize');

module.exports = async function (params) {
  if (process.platform !== 'darwin') {
    return;
  }

  const appPath = path.join(
    params.appOutDir,
    `${params.packager.appInfo.productFilename}.app`
  );

  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot find application at: ${appPath}`);
  }

  // If electron-builder didn't sign with a real certificate, ad-hoc sign so
  // the entitlements (JIT, unsigned-executable-memory) are enforced and the
  // sandboxed Chromium renderers can start. The app still triggers Gatekeeper
  // on first launch when downloaded — right-click → Open to bypass.
  let realSig = false;
  try {
    execFileSync('codesign', ['-v', '--strict', appPath], { stdio: 'ignore' });
    realSig = true;
  } catch (_) {
    realSig = false;
  }

  if (!realSig) {
    const entitlements = path.join(__dirname, '../build/entitlements.plist');
    console.log(`No real signature found — ad-hoc signing ${appPath}`);
    execFileSync('codesign', [
      '--deep', '--force', '--sign', '-',
      '--options', 'runtime',
      '--entitlements', entitlements,
      appPath,
    ]);
    console.log('Ad-hoc signing done');
    return;
  }

  // Real certificate present — notarize if credentials are available.
  if (!process.env.appleId || !process.env.appleIdPassword || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization: missing appleId, appleIdPassword, or APPLE_TEAM_ID');
    return;
  }

  const appId = 'com.knownasilya.nomad';
  console.log(`Notarizing ${appId} at ${appPath}`);

  await notarize({
    tool: 'notarytool',
    appBundleId: appId,
    appPath: appPath,
    appleId: process.env.appleId,
    appleIdPassword: process.env.appleIdPassword,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log(`Done notarizing ${appId}`);
};
