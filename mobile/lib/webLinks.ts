// Where a link followed in a web tab goes (the tab's onShouldStartLoadWithRequest). A link stays in
// Nomad unless only another app can open it: an RSS link goes to Reader, an intent:// link that
// names a web page ("open this in Chrome") loads in the tab, and a hyper:// link opens its drive.
// Tests: tests/unit/mobile-web-links.test.js.

export type LinkRoute =
  | { to: 'page' } // the WebView loads it
  | { to: 'tab'; url: string } // the tab goes there instead (a web page or a drive)
  | { to: 'reader'; url: string } // a feed: offer to subscribe in Reader
  | { to: 'app'; url: string; fallback?: string } // another app's link; fallback is a web page for when no app takes it

const WEB = /^https?:\/\//i

export function routeLink (url: string): LinkRoute {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase()
  if (!scheme) return { to: 'page' }
  switch (scheme) {
    case 'http':
    case 'https':
    case 'about':
    case 'data':
    case 'blob':
    case 'javascript':
      return { to: 'page' }
    case 'hyper':
      return { to: 'tab', url }
    case 'feed':
    case 'feeds':
      return { to: 'reader', url: feedUrl(url) }
    case 'intent':
      return routeIntent(url)
    default:
      return { to: 'app', url }
  }
}

// feed://example.com/rss and feed:https://example.com/rss are both https://example.com/rss.
export function feedUrl (url: string): string {
  const rest = url.replace(/^feeds?:/i, '')
  if (WEB.test(rest)) return rest
  return 'https:' + (rest.startsWith('//') ? rest : '//' + rest)
}

// intent://HOST/PATH#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=…;end
// (https://developer.chrome.com/docs/android/intents).
export function parseIntent (url: string): { target: string | null; scheme: string | null; fallback: string | null } {
  const hash = url.indexOf('#Intent;')
  const body = (hash < 0 ? url : url.slice(0, hash)).replace(/^intent:/i, '')
  const params = new Map<string, string>()
  if (hash >= 0) {
    for (const part of url.slice(hash + '#Intent;'.length).split(';')) {
      const eq = part.indexOf('=')
      if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1))
    }
  }
  const scheme = params.get('scheme')?.toLowerCase() || null
  let fallback: string | null = null
  try { fallback = params.has('S.browser_fallback_url') ? decodeURIComponent(params.get('S.browser_fallback_url')!) : null } catch {}
  return { target: scheme && body.startsWith('//') ? `${scheme}:${body}` : null, scheme, fallback }
}

function routeIntent (url: string): LinkRoute {
  const { target, scheme, fallback } = parseIntent(url)
  if (target && (scheme === 'http' || scheme === 'https')) return { to: 'tab', url: target }
  if (target && (scheme === 'feed' || scheme === 'feeds')) return { to: 'reader', url: feedUrl(target) }
  return fallback && WEB.test(fallback) ? { to: 'app', url, fallback } : { to: 'app', url }
}

// Runs in a web tab after each load (injectedJavaScript). A feed that the WebView shows as XML,
// rather than downloading it, posts { type: 'feed' } so the app can offer it to Reader.
export const FEED_JS = `(function(){try{
  var t=document.contentType||'';var r=document.documentElement;
  if(!/xml/i.test(t)||!r)return;
  var n=(r.localName||r.nodeName||'').toLowerCase();
  if(n==='rss'||n==='feed'||n==='rdf')window.ReactNativeWebView.postMessage(JSON.stringify({type:'feed',url:location.href}));
}catch(e){}})();`
