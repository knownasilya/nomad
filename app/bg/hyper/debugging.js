import * as hyperDns from './dns';

/**
 * @returns {string}
 */
export const drivesDebugPage = function () {
  var drives = []; // TODO getActiveDrives()
  return `<html>
    <body>
      ${Object.keys(drives)
        .map((key) => {
          var a = drives[key];
          return `<div style="font-family: monospace">
          <h3>${a.key.toString('hex')}</h3>
          <table>
            <tr><td>Meta DKey</td><td>${a.discoveryKey.toString(
              'hex'
            )}</td></tr>
            <tr><td>Content DKey</td><td>${a.content.discoveryKey.toString(
              'hex'
            )}</td></tr>
            <tr><td>Meta Key</td><td>${a.key.toString('hex')}</td></tr>
            <tr><td>Content Key</td><td>${a.content.key.toString(
              'hex'
            )}</td></tr>
          </table>
        </div>`;
        })
        .join('')}
    </body>
  </html>`;
};
