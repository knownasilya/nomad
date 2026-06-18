const fs = require('fs');
const path = require('path');
const { notarize } = require('@electron/notarize');

module.exports = async function (params) {
  if (process.platform !== 'darwin') {
    return;
  }

  if (!process.env.appleId || !process.env.appleIdPassword || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization: missing appleId, appleIdPassword, or APPLE_TEAM_ID');
    return;
  }

  const appId = 'com.knownasilya.nomad';
  const appPath = path.join(
    params.appOutDir,
    `${params.packager.appInfo.productFilename}.app`
  );

  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot find application at: ${appPath}`);
  }

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
