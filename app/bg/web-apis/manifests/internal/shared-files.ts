// The files and folders the user picked for a site in the capability file picker
// (nomad.shell.selectFileDialog({ capability: true }), bg/hyper/capabilities.js), for site-info's
// Permissions. Internal-only; removing works only from nomad://site-info. See bg/shared-files.ts.
export default {
  list: 'promise', // (origin) -> [{ url, path, title, driveTitle, createdAt }] newest first
  remove: 'promise', // (url): the site can no longer read it
  // Paths of the user's private drive the site may use for a while (private-drive-guard.ts):
  listPrivate: 'promise', // (origin) -> [{ id, path, access, spaceName, grantedAt, expiresAt }]
  removePrivate: 'promise', // (id): the grant ends now (site-info only)
};
