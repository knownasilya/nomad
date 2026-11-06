// The new tab page's "Welcome to Nomad X.Y.Z" notice. The version comes from the running app
// (nomad.browser.getInfo().version), so it is never stale.

const SITE = 'https://nomad.pages.dev';

// '1.44.0' or '1.45.0-beta.2' → { major, minor, patch, pre, prerelease }, or null.
export function parseVersion(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+?(?:\.(\d+))?)?$/.exec(String(version || '').trim());
  if (!m) return null;
  const prerelease = String(version).includes('-');
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? Number(m[4]) : 0,
    prerelease,
  };
}

// A number that grows with each release, for "has the user seen this version's notice?".
// A prerelease sorts before its release (1.45.0-beta.3 < 1.45.0).
export function versionId(version) {
  const v = parseVersion(version);
  if (!v) return 0;
  const pre = v.prerelease ? v.pre : 999;
  return v.major * 1e9 + v.minor * 1e6 + v.patch * 1e3 + pre;
}

// Each minor release gets a news post at /posts/whats-new-in-<major>-<minor>/. A prerelease has no
// post yet, so it links to the News list.
export function releaseNotesUrl(version) {
  const v = parseVersion(version);
  if (!v || v.prerelease) return `${SITE}/posts/`;
  return `${SITE}/posts/whats-new-in-${v.major}-${v.minor}/`;
}

// The notice shows once per new version: stored is the last version id the page showed it for.
export function shouldShowNotice(version, stored) {
  const id = versionId(version);
  return id > 0 && !(Number(stored) >= id);
}
