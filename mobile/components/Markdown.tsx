import { memo, useMemo } from 'react'
import { View, Text, StyleSheet, Linking } from 'react-native'
import { marked } from 'marked'
import { useTheme, type Theme } from '../lib/theme'

// Lightweight native Markdown renderer for AI chat bubbles. Uses marked's lexer (already a dep) and
// renders a common subset to RN Text/View — no WebView, no extra dependency. Covers what LLM replies
// actually use: paragraphs, bold/italic/strikethrough, inline code, fenced code, headings, lists,
// blockquotes, links, and rules. Unknown blocks fall back to their raw text.
export default memo(function Markdown ({ text, color }: { text: string; color?: string }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const tokens = useMemo(() => { try { return marked.lexer(text || '') } catch { return [] as any[] } }, [text])
  // `gap` separates blocks so there's no trailing bottom margin (keeps the bubble padding symmetric).
  return <View style={s.root}>{tokens.map((tok: any, i: number) => renderBlock(tok, 'b' + i, s, color))}</View>
})

// Inline tokens don't carry color: nested <Text> inherit it from the block-level <Text> (which
// applies the caller's tint), and codespan/link set their own colors by design.
function renderInline (tokens: any[], s: Styles, kp: string): any {
  return (tokens || []).map((tk: any, i: number) => {
    const key = kp + '-' + i
    switch (tk.type) {
      case 'strong': return <Text key={key} style={s.bold}>{renderInline(tk.tokens, s, key)}</Text>
      case 'em': return <Text key={key} style={s.italic}>{renderInline(tk.tokens, s, key)}</Text>
      case 'del': return <Text key={key} style={s.del}>{renderInline(tk.tokens, s, key)}</Text>
      case 'codespan': return <Text key={key} style={s.codespan}>{tk.text}</Text>
      case 'br': return <Text key={key}>{'\n'}</Text>
      case 'link':
        return (
          <Text key={key} style={s.link} onPress={() => tk.href && Linking.openURL(tk.href).catch(() => {})}>
            {renderInline(tk.tokens, s, key)}
          </Text>
        )
      case 'text':
      default:
        return tk.tokens ? renderInline(tk.tokens, s, key) : <Text key={key}>{tk.text ?? tk.raw ?? ''}</Text>
    }
  })
}

function renderBlock (tok: any, key: string, s: Styles, color: string | undefined): any {
  const tint = color ? { color } : null
  switch (tok.type) {
    case 'paragraph':
      return <Text key={key} style={[s.text, s.paragraph, tint]}>{renderInline(tok.tokens, s, key)}</Text>
    case 'heading':
      return <Text key={key} style={[s.text, s.paragraph, (s as any)['h' + tok.depth] || s.h3, tint]}>{renderInline(tok.tokens, s, key)}</Text>
    case 'code':
      return <View key={key} style={s.codeBlock}><Text style={s.codeText}>{tok.text}</Text></View>
    case 'blockquote':
      return <View key={key} style={s.blockquote}>{(tok.tokens || []).map((tt: any, j: number) => renderBlock(tt, key + '-' + j, s, color))}</View>
    case 'list':
      return (
        <View key={key} style={s.list}>
          {(tok.items || []).map((it: any, j: number) => (
            <View key={key + '-' + j} style={s.listItem}>
              <Text style={[s.text, tint]}>{tok.ordered ? `${(tok.start || 1) + j}. ` : '•  '}</Text>
              <Text style={[s.text, s.listItemText, tint]}>{renderInline(it.tokens, s, key + '-' + j)}</Text>
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
