import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useTheme, radius, type Theme } from '../lib/theme'
import canvasHtml from '../lib/canvasHtml'
import IconButton from './IconButton'

// Where every node was and the zoom, so the canvas comes back the same after a note is opened.
export interface CanvasSnapshot { positions: Record<string, [number, number]>; view: { x: number; y: number; k: number } }

export interface CanvasHandle {
  // Light up a node and its links (null clears it); center pans to it.
  select: (id: string | null, center?: boolean) => void
  fit: () => void
}

interface Props {
  kind: 'notes' | 'reader'
  // notes: the notes. reader: { articles, posts, read }.
  data: unknown
  query?: string
  // A line over the top left, e.g. "12 notes · 9 links". For notes, nodes counts the notes and
  // topics the topic hubs.
  info?: (count: { nodes: number; links: number; topics?: number }) => string
  snapshot?: CanvasSnapshot | null
  onSnapshot?: (s: CanvasSnapshot) => void
  // A tap selects a node, a second tap on it opens it.
  onSelect?: (id: string | null) => void
  onOpen: (id: string) => void
  ref?: Ref<CanvasHandle>
}

// The canvas desktop's nomad://notes and nomad://reader draw (app-stdlib/js/graph/), bundled into a
// page (lib/canvasHtml.ts, from app-stdlib/js/graph/phone.js) and run in a WebView: dots and lines,
// laid out by a small force simulation. Drag to pan, pinch to zoom, drag a dot to move it. A tap
// selects a dot and lights up its links; tapping it again opens it.
export default function Canvas ({ kind, data, query = '', info, snapshot, onSnapshot, onSelect, onOpen, ref }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const web = useRef<WebView>(null)
  const ready = useRef(false)
  const [count, setCount] = useState<{ nodes: number; links: number; topics?: number } | null>(null)
  // The latest props, for the page's 'ready' and for the effects below.
  const latest = useRef({ data, query, snapshot, theme: t, kind })
  latest.current = { data, query, snapshot, theme: t, kind }

  // Tell the page something: window.__canvas in app/userland/app-stdlib/js/graph/phone.js.
  const send = useCallback((msg: Record<string, unknown>) => {
    web.current?.injectJavaScript(`window.__canvas && window.__canvas(${JSON.stringify(msg)});true;`)
  }, [])

  const load = useCallback(() => {
    const l = latest.current
    send({ type: 'load', theme: l.theme, kind: l.kind, data: l.data, query: l.query, snapshot: l.snapshot || null })
  }, [send])

  useImperativeHandle(ref, () => ({
    select: (id, center = false) => send({ type: 'select', id, center }),
    fit: () => send({ type: 'fit' })
  }), [send])

  // The theme or the kind changed: draw it again (from where it was).
  useEffect(() => { if (ready.current) load() }, [t, kind, load])
  useEffect(() => { if (ready.current) send({ type: 'data', data }) }, [data, send])
  useEffect(() => { if (ready.current) send({ type: 'query', query }) }, [query, send])

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: any
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    if (msg.type === 'ready') {
      ready.current = true
      load()
    } else if (msg.type === 'count') {
      setCount({ nodes: msg.nodes, links: msg.links, topics: msg.topics })
    } else if (msg.type === 'select') {
      onSelect?.(msg.id || null)
    } else if (msg.type === 'open' && msg.id) {
      onOpen(msg.id)
    } else if (msg.type === 'snapshot' && msg.snapshot) {
      onSnapshot?.(msg.snapshot)
    }
  }

  return (
    <View style={s.root}>
      <WebView
        ref={web}
        style={s.web}
        originWhitelist={['*']}
        source={{ html: canvasHtml }}
        onMessage={onMessage}
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        overScrollMode='never'
        // Nothing on the canvas is a link; never let the page itself go anywhere.
        onShouldStartLoadWithRequest={(req) => !/^(https?|hyper):/i.test(req.url)}
      />
      {count && info ? (
        <View style={s.info} pointerEvents='none'>
          <Text style={s.infoText}>{info(count)}</Text>
        </View>
      ) : null}
      <View style={s.tools}>
        <IconButton icon='compress-arrows-alt' label='Fit everything' onPress={() => send({ type: 'fit' })} size={16} />
      </View>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    web: { flex: 1, backgroundColor: t.bg },
    info: { position: 'absolute', top: 8, left: 16 },
    infoText: { color: t.textMuted, fontSize: 12 },
    tools: {
      position: 'absolute',
      top: 6,
      right: 10,
      borderRadius: radius.pill,
      backgroundColor: t.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      overflow: 'hidden'
    }
  })
}
