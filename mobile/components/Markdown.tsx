import { memo, useMemo, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Linking } from 'react-native'
import { marked } from 'marked'
import { useTheme, type Theme } from '../lib/theme'
import { measureColumns, fitColumns, listMarker, cellAlign, nestHtml, htmlBlock, decodeEntities } from '../lib/markdown'
import Icon from './Icon'

// Native Markdown renderer for AI answers, Job runs and Markdown Assets. Uses marked's lexer (GFM on)
// and draws its tokens as RN Text/View: no WebView, no extra dependency. Covers what model answers
// use: paragraphs, headings, bold/italic/strikethrough, inline and fenced code, lists (nested,
// numbered, task lists), tables, blockquotes, links and rules. HTML in it (a README's <sup>, <br>,
// <kbd>, <p align="center">) is drawn as text styles, never run or loaded, and entities are decoded
// (lib/markdown.ts nestHtml, htmlBlock). Anything else shows its raw text.
// Pure parts (table column widths, list markers, HTML) are lib/markdown.ts.
// `onLink` opens a tapped link; without it a link goes to Linking. The AI panel passes one so the
// user's Notes, Jobs and pages open inside Nomad (lib/itemLinks.ts).
export default memo(function Markdown ({ text, color, onLink }: { text: string; color?: string; onLink?: (href: string) => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const tokens = useMemo(() => { try { return marked.lexer(text || '') } catch { return [] as any[] } }, [text])
  // `gap` separates blocks so there's no trailing bottom margin (keeps the bubble padding symmetric).
  const open: Open = onLink ? Object.assign((href: string) => onLink(href), { bare: true }) : (href: string) => { Linking.openURL(href).catch(() => {}) }
  const ctx: Ctx = { s, t, color, open }
  return <View style={s.root}>{renderBlocks(tokens, 'b', ctx, 0)}</View>
})

interface Ctx { s: Styles; t: Theme; color: string | undefined; open: Open }

// Inline tokens don't carry color: nested <Text> inherit it from the block-level <Text> (which
// applies the caller's tint), and codespan/link set their own colors by design.
function renderInline (tokens: any[], s: Styles, kp: string, open: Open): any {
  return nestHtml(tokens).map((tk: any, i: number) => {
    const key = kp + '-' + i
    switch (tk.type) {
      case 'strong': return <Text key={key} style={s.bold}>{renderInline(tk.tokens, s, key, open)}</Text>
      case 'em': return <Text key={key} style={s.italic}>{renderInline(tk.tokens, s, key, open)}</Text>
      case 'del': return <Text key={key} style={s.del}>{renderInline(tk.tokens, s, key, open)}</Text>
      case 'codespan': return <Text key={key} style={s.codespan}>{tk.text}</Text>
      case 'br': return <Text key={key}>{'\n'}</Text>
      case 'checkbox': return null
      case 'html': return null // nestHtml has made every tag a `tag` token
      case 'tag': {
        if (tk.kind === 'hidden') return null
        const inner = renderInline(tk.tokens, s, key, open)
        if (tk.kind === 'link') return <Text key={key} style={s.link} onPress={() => tk.href && open(tk.href)}>{inner}</Text>
        if (tk.kind === 'quote') return <Text key={key}>“{inner}”</Text>
        const style = (TAG_STYLES as any)[tk.kind]
        return <Text key={key} style={style ? s[style as keyof Styles] : undefined}>{inner}</Text>
      }
      case 'link':
        return (
          <Text key={key} style={s.link} onPress={() => tk.href && open(tk.href)}>
            {renderInline(tk.tokens, s, key, open)}
          </Text>
        )
      // An image isn't loaded (the desktop sidebar doesn't either): it shows as a link to itself,
      // named by its alt text.
      case 'image':
        return (
          <Text key={key} style={s.link} onPress={() => tk.href && open(tk.href)}>
            {tk.text || tk.href}
          </Text>
        )
      case 'text':
      default: {
        if (tk.tokens) return renderInline(tk.tokens, s, key, open)
        // marked leaves a text token's entities (&amp; &dagger;) as written; an escape's text is literal.
        const words = tk.type === 'text' ? decodeEntities(tk.text ?? tk.raw ?? '') : (tk.text ?? tk.raw ?? '')
        return open.bare ? linkify(words, s, key, open) : <Text key={key}>{words}</Text>
      }
    }
  })
}

// How each kind of HTML tag (lib/markdown.ts) is drawn: a style in makeStyles.
const TAG_STYLES = { bold: 'bold', italic: 'italic', underline: 'underline', del: 'del', code: 'codespan', mark: 'mark', small: 'small', sup: 'sup', sub: 'sub' } as const

// marked links bare http(s) URLs itself; a bare hyper:// or nomad:// one becomes a link here.
const BARE_URL = /((?:hyper|nomad):\/\/[^\s<>]+?)([.,;:!?)\]'"]*)(?=\s|$)/g
function linkify (text: string, s: Styles, key: string, open: Open): any {
  const out: any[] = []
  let last = 0
  for (const m of text.matchAll(BARE_URL)) {
    const at = m.index ?? 0
    if (at > 0 && !/[\s(]/.test(text[at - 1])) continue
    if (at > last) out.push(text.slice(last, at))
    const url = m[1]
    out.push(<Text key={key + '-u' + at} style={s.link} onPress={() => open(url)}>{url}</Text>)
    last = at + url.length
  }
  if (!out.length) return <Text key={key}>{text}</Text>
  out.push(text.slice(last))
  return <Text key={key}>{out}</Text>
}

function renderBlocks (tokens: any[], kp: string, ctx: Ctx, depth: number): any[] {
  return (tokens || []).map((tok: any, i: number) => renderBlock(tok, kp + i, ctx, depth))
}

// `depth` is how many lists deep a block sits, for the bullet's shape.
function renderBlock (tok: any, key: string, ctx: Ctx, depth: number): any {
  const { s, t, color, open } = ctx
  const tint = color ? { color } : null
  switch (tok.type) {
    case 'paragraph':
    // A list item's tight text is a block-level `text` token with inline tokens.
    case 'text':
      return <Text key={key} style={[s.text, tint]}>{tok.tokens ? renderInline(tok.tokens, s, key, open) : tok.text}</Text>
    case 'heading':
      return <Text key={key} style={[s.text, (s as any)['h' + tok.depth] || s.h4, tint]}>{renderInline(tok.tokens, s, key, open)}</Text>
    case 'code':
      // Long lines scroll sideways, as the desktop sidebar's <pre> does.
      return (
        <ScrollView key={key} horizontal style={s.codeBlock} contentContainerStyle={s.codeInner}>
          <Text style={s.codeText} selectable>{tok.text}</Text>
        </ScrollView>
      )
    case 'blockquote':
      return <View key={key} style={s.blockquote}>{renderBlocks(tok.tokens, key + '-', { ...ctx, color: color ?? t.textDim }, depth)}</View>
    case 'list':
      return (
        <View key={key} style={s.list}>
          {(tok.items || []).map((it: any, j: number) => (
            <View key={key + '-' + j} style={s.listItem}>
              {it.task
                ? (
                  <View style={s.checkbox}>
                    <Icon name={it.checked ? 'check-square' : 'square'} regular={!it.checked} size={15} color={it.checked ? t.accent : t.textMuted} />
                  </View>
                  )
                : <Text style={[s.text, s.marker, tok.ordered && s.number]}>{listMarker(tok, j, depth)}</Text>}
              <View style={s.listItemBody}>{renderBlocks(it.tokens, key + '-' + j + '-', ctx, depth + 1)}</View>
            </View>
          ))}
        </View>
      )
    case 'table':
      return <Table key={key} tok={tok} k={key} ctx={ctx} />
    case 'hr':
      return <View key={key} style={s.hr} />
    case 'html': {
      // A block of HTML (<p align="center">…</p>, <details>, a comment): its text, styled.
      const inline = htmlBlock(String(tok.text ?? tok.raw ?? ''))
      return inline.length ? <Text key={key} style={[s.text, tint]}>{renderInline(inline, s, key, open)}</Text> : null
    }
    case 'space':
    case 'def':
    case 'checkbox':
      return null
    default:
      return tok.raw ? <Text key={key} style={[s.text, tint]}>{tok.raw.replace(/\n+$/, '')}</Text> : null
  }
}

// A table is a grid of fixed-width columns so its rows line up, sized to the answer's width
// (lib/markdown.ts fitColumns): long columns wrap first, and only a table too wide even then
// scrolls sideways.
function Table ({ tok, k, ctx }: { tok: any; k: string; ctx: Ctx }) {
  const { s, color, open } = ctx
  const [width, setWidth] = useState(0)
  const cols = useMemo(() => measureColumns(tok), [tok])
  // The table's border takes a hairline on each side.
  const widths = fitColumns(cols, width - 2 * StyleSheet.hairlineWidth)
  const tint = color ? { color } : null
  const row = (cells: any[], r: number, head: boolean) => (
    <View key={'r' + r} style={[s.tr, head && s.thead, r > 0 && s.trBorder]}>
      {widths.map((w, c) => {
        const cell = cells[c]
        return (
          <View key={c} style={[s.td, { width: w }, c > 0 && s.tdBorder]}>
            <Text style={[s.text, s.cellText, head && s.bold, { textAlign: cellAlign(tok.align?.[c]) }, tint]}>
              {cell ? renderInline(cell.tokens, s, k + '-' + r + '-' + c, open) : ''}
            </Text>
          </View>
        )
      })}
    </View>
  )
  return (
    <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tableScroll}>
        <View style={s.table}>
          {row(tok.header || [], 0, true)}
          {(tok.rows || []).map((cells: any[], r: number) => row(cells, r + 1, false))}
        </View>
      </ScrollView>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>
type Open = ((href: string) => void) & { bare?: boolean }

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { gap: 8 },
    text: { color: t.text, fontSize: 15, lineHeight: 21 },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    del: { textDecorationLine: 'line-through' },
    underline: { textDecorationLine: 'underline' },
    mark: { backgroundColor: t.mark },
    small: { fontSize: 12.5 },
    // A nested Text can't be raised or lowered on Android: smaller is what shows it's a footnote mark.
    sup: { fontSize: 11 },
    sub: { fontSize: 11 },
    h1: { fontSize: 20, fontWeight: '700', lineHeight: 26 },
    h2: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
    h3: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
    h4: { fontSize: 15, fontWeight: '700', lineHeight: 21 },
    link: { color: t.accent, textDecorationLine: 'underline' },
    codespan: { fontFamily: 'monospace', fontSize: 13.5, backgroundColor: t.inputBg, color: t.text },
    codeBlock: { backgroundColor: t.inputBg, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, flexGrow: 0 },
    codeInner: { padding: 10 },
    codeText: { fontFamily: 'monospace', fontSize: 13, color: t.text, lineHeight: 18 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: t.border, paddingLeft: 10, gap: 6 },
    list: { gap: 3 },
    listItem: { flexDirection: 'row', alignItems: 'flex-start' },
    marker: { width: 18, color: t.textMuted },
    number: { width: 24, fontVariant: ['tabular-nums'] },
    checkbox: { width: 24, height: 21, justifyContent: 'center' },
    listItemBody: { flex: 1, gap: 3 },
    tableScroll: { flexGrow: 0 },
    table: { backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 6, overflow: 'hidden' },
    tr: { flexDirection: 'row' },
    thead: { backgroundColor: t.surfaceAlt },
    trBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    td: { paddingHorizontal: 10, paddingVertical: 6 },
    tdBorder: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.border },
    cellText: { fontSize: 14, lineHeight: 19 },
    hr: { height: StyleSheet.hairlineWidth, backgroundColor: t.border }
  })
}
