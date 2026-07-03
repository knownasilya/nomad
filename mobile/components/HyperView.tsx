import { useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import { useTheme, radius, type Theme } from '../lib/theme'
import { type DirEntry, CONSOLE_SHIM, NOMAD_SHIM } from '../lib/types'
import { shortKey } from '../lib/hyperUrl'

export type HyperRender =
  | { type: 'loading'; status: string; peers: number }
  | { type: 'error'; message: string; url: string }
  | { type: 'html'; html: string; keyHex?: string }
  | { type: 'image'; uri: string }
  | { type: 'text'; text: string; mime: string }
  | { type: 'dir'; path: string; entries: DirEntry[]; keyHex: string }

interface Props {
  render: HyperRender
  onNavigate: (url: string) => void
  onMessage: (data: string) => void
  registerWebView: (ref: WebView | null) => void
}

// Renders content the backend pulled out of a hyper:// drive, themed to match
// nomad's chrome. HTML/text/images go through a WebView; directories render as
// a tappable file listing.
export default function HyperView ({ render, onNavigate, onMessage, registerWebView }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const webProps = {
    originWhitelist: ['*'],
    injectedJavaScriptBeforeContentLoaded: CONSOLE_SHIM + NOMAD_SHIM,
    webviewDebuggingEnabled: true,
    onMessage: (e: any) => onMessage(e.nativeEvent.data)
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

  if (render.type === 'html') {
    // The WebView loads this HTML with no hyper:// base URL, so a drive frontend
    // can't learn its own URL from `location`. Set window.__hyperBase before any
    // page script runs (the blog template reads it). Must precede the page's
    // module script, so it goes in injectedJavaScriptBeforeContentLoaded.
    const baseJs = render.keyHex
      ? `window.__hyperBase=${JSON.stringify('hyper://' + render.keyHex + '/')};`
      : ''
    return (
      <WebView
        ref={registerWebView}
        {...webProps}
        injectedJavaScriptBeforeContentLoaded={baseJs + CONSOLE_SHIM + NOMAD_SHIM}
        source={{ html: render.html }}
        style={s.web}
        setSupportMultipleWindows={false}
      />
    )
  }

  if (render.type === 'image') {
    const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <body style="margin:0;background:${t.bg};display:flex;align-items:center;justify-content:center;height:100vh">
      <img src="${render.uri}" style="max-width:100%;max-height:100%"/></body>`
    return <WebView ref={registerWebView} {...webProps} source={{ html }} style={s.web} />
  }

  if (render.type === 'text') {
    const escaped = render.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <body style="margin:0;background:${t.bg};color:${t.textDim};font:13px ui-monospace,Menlo,monospace">
      <pre style="padding:16px;white-space:pre-wrap;word-break:break-word">${escaped}</pre></body>`
    return <WebView ref={registerWebView} {...webProps} source={{ html }} style={s.web} />
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
