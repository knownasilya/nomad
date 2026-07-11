import { useMemo, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import { useTheme, radius, type Theme } from '../lib/theme'
import { type DirEntry, CONSOLE_SHIM, NOMAD_SHIM } from '../lib/types'
import { shortKey } from '../lib/hyperUrl'

export type HyperRender =
  | { type: 'loading'; status: string; peers: number }
  | { type: 'error'; message: string; url: string }
  | { type: 'http'; uri: string; keyHex: string; url: string; port: number }
  | { type: 'html'; html: string; keyHex?: string; url?: string }
  | { type: 'image'; uri: string }
  | { type: 'text'; text: string; mime: string }
  | { type: 'dir'; path: string; entries: DirEntry[]; keyHex: string }

interface Props {
  render: HyperRender
  onNavigate: (url: string) => void
  onMessage: (data: string) => void
  registerWebView: (ref: WebView | null) => void
  // Native in-page navigation on the loopback origin (link clicks, back/forward): reports the
  // mapped hyper:// URL + history state so the address bar and back button stay truthful, plus
  // the document title (when the page has a real one) so the tab label follows the page.
  onHyperNav?: (hyperUrl: string, canGoBack: boolean, title?: string) => void
}

// Renders content the backend pulled out of a hyper:// drive, themed to match
// nomad's chrome. HTML/text/images go through a WebView; directories render as
// a tappable file listing.
export default function HyperView ({ render, onNavigate, onMessage, registerWebView, onHyperNav }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  // Android kills WebView renderer processes under memory pressure; the view then goes permanently
  // WHITE until the native WebView is recreated. Our pages are heavy (all assets inlined as data:
  // URIs), so this genuinely happens after a few navigations. Bump the epoch on crash to remount a
  // fresh WebView with a fresh renderer — the html source is already in hand, so it reloads
  // instantly. (onContentProcessDidTerminate is the iOS equivalent.)
  const [epoch, setEpoch] = useState(0)
  const onRendererGone = (which: string) => (e: any) => {
    console.warn(`[nomad] WebView ${which} terminated`, e?.nativeEvent || '')
    setEpoch((n) => n + 1)
  }
  const webProps = {
    originWhitelist: ['*'],
    injectedJavaScriptBeforeContentLoaded: CONSOLE_SHIM + NOMAD_SHIM,
    webviewDebuggingEnabled: true,
    onMessage: (e: any) => onMessage(e.nativeEvent.data),
    onRenderProcessGone: onRendererGone('renderer'),
    onContentProcessDidTerminate: onRendererGone('content process')
  }

  if (render.type === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={t.accent} size='large' />
        <Text style={s.status}>{render.status}</Text>
        <Text style={s.peers}>{render.peers} peer{render.peers === 1 ? '' : 's'} connected</Text>
      </View>
    )
  }

  if (render.type === 'error') {
    return (
      <View style={s.center}>
        <Text style={[s.errIcon, { color: t.danger }]}>⬡</Text>
        <Text style={s.errTitle}>Couldn’t load drive</Text>
        <Text style={s.errMsg}>{render.message}</Text>
        <Text style={s.errUrl}>{render.url}</Text>
      </View>
    )
  }

  if (render.type === 'http') {
    // The page loads from the loopback gateway — a REAL http origin. location.pathname is the
    // drive route, links and history are native, and sub-resources stream per-request (no data-URI
    // inlining). __nomadPage carries just the drive key: the port is drive-scoped, so the key is a
    // constant for this WebView, and nomad.page derives path/url live from location.
    const pageJs = `window.__nomadPage=${JSON.stringify({ key: render.keyHex })};`
    const loopbackOrigin = `http://127.0.0.1:${render.port}`
    return (
      <WebView
        key={`${render.keyHex}:${epoch}`}
        ref={registerWebView}
        {...webProps}
        injectedJavaScriptBeforeContentLoaded={pageJs + CONSOLE_SHIM + NOMAD_SHIM}
        source={{ uri: render.uri }}
        style={s.web}
        setSupportMultipleWindows={false}
        // Same-drive navigation stays native (that's the point). Anything else — a hyper:// link to
        // another drive, or an external web link — routes through the app's navigation.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url.startsWith(loopbackOrigin)) return true
          if (/^(hyper|https?):/.test(req.url)) { onNavigate(req.url); return false }
          return false
        }}
        onNavigationStateChange={(nav) => {
          if (!onHyperNav || nav.loading || !nav.url.startsWith(loopbackOrigin)) return
          // nav.title is the URL when the document has no <title> — only a real title is useful.
          const title = nav.title && !/^https?:\/\//.test(nav.title) ? nav.title : undefined
          onHyperNav(`hyper://${render.keyHex}${nav.url.slice(loopbackOrigin.length) || '/'}`, nav.canGoBack, title)
        }}
      />
    )
  }

  if (render.type === 'html') {
    // window.__nomadPage: the page's own URL + drive key, host-provided from the serve we just did.
    // NOMAD_SHIM turns it into nomad.page — the authoritative way for a drive frontend to learn its
    // route. Never derived from `location` in the page: a WebView loading an html string under a
    // custom-scheme baseUrl reports location.host/pathname unreliably. Must precede NOMAD_SHIM, so
    // it goes first in injectedJavaScriptBeforeContentLoaded.
    const pageJs = render.url
      ? `window.__nomadPage=${JSON.stringify({ url: render.url, key: render.keyHex || null })};`
      : ''
    // baseUrl gives the document a real-ish URL (nice for debugging, and it differs per route so RN
    // reloads on every navigation — no React `key` remount, which recycles a native WebView and can
    // render blank). Frontends must NOT rely on location parsing it — that's what nomad.page is for.
    // Sub-resources are pre-inlined as data: URIs (the WebView can't fetch hyper://).
    return (
      <WebView
        key={`wv${epoch}`}
        ref={registerWebView}
        {...webProps}
        injectedJavaScriptBeforeContentLoaded={pageJs + CONSOLE_SHIM + NOMAD_SHIM}
        source={{ html: render.html, baseUrl: render.url }}
        style={s.web}
        setSupportMultipleWindows={false}
      />
    )
  }

  if (render.type === 'image') {
    const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <body style="margin:0;background:${t.bg};display:flex;align-items:center;justify-content:center;height:100vh">
      <img src="${render.uri}" style="max-width:100%;max-height:100%"/></body>`
    return <WebView key={`wv${epoch}`} ref={registerWebView} {...webProps} source={{ html }} style={s.web} />
  }

  if (render.type === 'text') {
    const escaped = render.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <body style="margin:0;background:${t.bg};color:${t.textDim};font:13px ui-monospace,Menlo,monospace">
      <pre style="padding:16px;white-space:pre-wrap;word-break:break-word">${escaped}</pre></body>`
    return <WebView key={`wv${epoch}`} ref={registerWebView} {...webProps} source={{ html }} style={s.web} />
  }

  // Directory listing
  return (
    <View style={s.dir}>
      <View style={s.dirHeader}>
        <Text style={s.dirKey}>{shortKey(render.keyHex)}</Text>
        <Text style={s.dirPath}>{render.path}</Text>
      </View>
      <FlatList
        data={render.entries}
        keyExtractor={(e) => e.path}
        ListEmptyComponent={<Text style={s.empty}>Empty directory</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.entry}
            activeOpacity={0.7}
            onPress={() => onNavigate(`hyper://${render.keyHex}${item.path}`)}
          >
            <Text style={[s.entryIcon, { color: item.isDir ? t.accent : t.textMuted }]}>{item.isDir ? '▸' : '·'}</Text>
            <Text style={s.entryName}>{item.name}{item.isDir ? '/' : ''}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    web: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: t.bg },
    status: { color: t.text, marginTop: 16, fontSize: 15 },
    peers: { color: t.textMuted, marginTop: 6, fontSize: 13 },
    errIcon: { fontSize: 34 },
    errTitle: { color: t.text, fontSize: 18, fontWeight: '700', marginTop: 12 },
    errMsg: { color: t.danger, fontSize: 14, marginTop: 8, textAlign: 'center' },
    errUrl: { color: t.textMuted, fontSize: 12, marginTop: 12, textAlign: 'center' },
    dir: { flex: 1, backgroundColor: t.surface },
    dirHeader: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    dirKey: { color: t.trustText, fontSize: 12, fontFamily: 'monospace' },
    dirPath: { color: t.text, fontSize: 15, marginTop: 2 },
    entry: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    entryIcon: { fontSize: 16, width: 16, textAlign: 'center' },
    entryName: { color: t.text, fontSize: 15 },
    empty: { color: t.textMuted, textAlign: 'center', marginTop: 40 }
  })
}
