import { memo, useMemo } from 'react'
import { View, Text, StyleSheet, Linking } from 'react-native'
import { marked } from 'marked'
import { useTheme, type Theme } from '../lib/theme'

// Lightweight native Markdown renderer for AI chat bubbles. Uses marked's lexer (already a dep) and
// renders a common subset to RN Text/View — no WebView, no extra dependency. Covers what LLM replies
// actually use: paragraphs, bold/italic/strikethrough, inline code, fenced code, headings, lists,
// blockquotes, links, and rules. Unknown blocks fall back to their raw text.
// `onLink` opens a tapped link; without it a link goes to Linking. The AI panel passes one so the
// user's Notes, Jobs and pages open inside Nomad (lib/itemLinks.ts).
export default memo(function Markdown ({ text, color, onLink }: { text: string; color?: string; onLink?: (href: string) => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const tokens = useMemo(() => { try { return marked.lexer(text || '') } catch { return [] as any[] } }, [text])
  // `gap` separates blocks so there's no trailing bottom margin (keeps the bubble padding symmetric).
  const open: Open = onLink ? Object.assign((href: string) => onLink(href), { bare: true }) : (href: string) => { Linking.openURL(href).catch(() => {}) }
  return <View style={s.root}>{tokens.map((tok: any, i: number) => renderBlock(tok, 'b' + i, s, color, open))}</View>
})

// Inline tokens don't carry color: nested <Text> inherit it from the block-level <Text> (which
// applies the caller's tint), and codespan/link set their own colors by design.
function renderInline (tokens: any[], s: Styles, kp: string, open: Open): any {
  return (tokens || []).map((tk: any, i: number) => {
    const key = kp + '-' + i
    switch (tk.type) {
      case 'strong': return <Text key={key} style={s.bold}>{renderInline(tk.tokens, s, key, open)}</Text>
      case 'em': return <Text key={key} style={s.italic}>{renderInline(tk.tokens, s, key, open)}</Text>
      case 'del': return <Text key={key} style={s.del}>{renderInline(tk.tokens, s, key, open)}</Text>
      case 'codespan': return <Text key={key} style={s.codespan}>{tk.text}</Text>
      case 'br': return <Text key={key}>{'\n'}</Text>
      case 'link':
        return (
          <Text key={key} style={s.link} onPress={() => tk.href && open(tk.href)}>
            {renderInline(tk.tokens, s, key, open)}
          </Text>
        )
      case 'text':
      default:
        if (tk.tokens) return renderInline(tk.tokens, s, key, open)
        return open.bare ? linkify(tk.text ?? tk.raw ?? '', s, key, open) : <Text key={key}>{tk.text ?? tk.raw ?? ''}</Text>
    }
  })
}

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

function renderBlock (tok: any, key: string, s: Styles, color: string | undefined, open: Open): any {
  const tint = color ? { color } : null
  switch (tok.type) {
    case 'paragraph':
      return <Text key={key} style={[s.text, s.paragraph, tint]}>{renderInline(tok.tokens, s, key, open)}</Text>
    case 'heading':
      return <Text key={key} style={[s.text, s.paragraph, (s as any)['h' + tok.depth] || s.h3, tint]}>{renderInline(tok.tokens, s, key, open)}</Text>
    case 'code':
      return <View key={key} style={s.codeBlock}><Text style={s.codeText}>{tok.text}</Text></View>
    case 'blockquote':
      return <View key={key} style={s.blockquote}>{(tok.tokens || []).map((tt: any, j: number) => renderBlock(tt, key + '-' + j, s, color, open))}</View>
    case 'list':
      return (
        <View key={key} style={s.list}>
          {(tok.items || []).map((it: any, j: number) => (
            <View key={key + '-' + j} style={s.listItem}>
              <Text style={[s.text, tint]}>{tok.ordered ? `${(tok.start || 1) + j}. ` : '•  '}</Text>
              <Text style={[s.text, s.listItemText, tint]}>{renderInline(it.tokens, s, key + '-' + j, open)}</Text>
            </View>
          ))}
        </View>
      )
    case 'hr':
      return <View key={key} style={s.hr} />
    case 'space':
      return null
    default:
      return tok.raw ? <Text key={key} style={[s.text, tint]}>{tok.raw}</Text> : null
  }
}

type Styles = ReturnType<typeof makeStyles>
type Open = ((href: string) => void) & { bare?: boolean }

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { gap: 6 },
    text: { color: t.text, fontSize: 15, lineHeight: 21 },
    paragraph: {},
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    del: { textDecorationLine: 'line-through' },
    h1: { fontSize: 20, fontWeight: '700', lineHeight: 26 },
    h2: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
    h3: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
    link: { color: t.accent, textDecorationLine: 'underline' },
    codespan: { fontFamily: 'monospace', fontSize: 13.5, backgroundColor: t.inputBg, color: t.text },
    codeBlock: { backgroundColor: t.inputBg, borderRadius: 6, padding: 10 },
    codeText: { fontFamily: 'monospace', fontSize: 13, color: t.text, lineHeight: 18 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: t.border, paddingLeft: 10, gap: 6 },
    list: { gap: 2 },
    listItem: { flexDirection: 'row', alignItems: 'flex-start' },
    listItemText: { flex: 1 },
    hr: { height: StyleSheet.hairlineWidth, backgroundColor: t.border }
  })
}
