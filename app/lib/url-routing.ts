// URL routing ("Air Traffic Control"): rules that send a URL to a specific Space
// when a new tab for it is opened, instead of the window's current active Space.

export interface UrlRoutingRule {
  id: string;
  pattern: string;
  spaceId: number;
  enabled: boolean;
}

function globToRe(segment: string): string {
  return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
}

// A host pattern with no '*' matches that domain and any of its subdomains,
// eg "github.com" matches "github.com" and "gist.github.com".
// A host pattern with a '*' is matched literally as a glob, eg "*.github.com".
function matchesHost(host: string, hostPattern: string): boolean {
  if (!hostPattern) return false;
  if (hostPattern.includes('*')) {
    return new RegExp(`^${globToRe(hostPattern)}$`, 'i').test(host);
  }
  return host === hostPattern || host.endsWith(`.${hostPattern}`);
}

/**
 * Does `url` match a single routing pattern?
 * A pattern is a host, optionally with a leading scheme and/or a trailing path glob:
 *   github.com            any github.com page, including subdomains
 *   *.github.com          subdomains of github.com only
 *   github.com/myorg/*    only paths under /myorg on github.com
 */
export function matchesUrlPattern(url: string, pattern: string): boolean {
  if (!url || !pattern) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (e) {
    return false;
  }

  pattern = pattern.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (!pattern) return false;

  const slashIndex = pattern.indexOf('/');
  const hostPattern = (slashIndex === -1 ? pattern : pattern.slice(0, slashIndex)).toLowerCase();
  const pathPattern = slashIndex === -1 ? null : pattern.slice(slashIndex);

  if (!matchesHost(parsed.hostname.toLowerCase(), hostPattern)) return false;
  if (!pathPattern) return true;

  const re = new RegExp(`^${globToRe(pathPattern)}$`, 'i');
  return re.test(parsed.pathname) || re.test(parsed.pathname + parsed.search);
}

/**
 * Given an ordered list of routing rules, return the spaceId of the first enabled rule
 * whose pattern matches `url`, or undefined if none match.
 */
export function resolveRoutedSpaceId(
  url: string,
  rules: UrlRoutingRule[] | undefined | null
): number | undefined {
  if (!Array.isArray(rules)) return undefined;
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (!rule.pattern || !rule.spaceId) continue;
    if (matchesUrlPattern(url, rule.pattern)) return rule.spaceId;
  }
  return undefined;
}
