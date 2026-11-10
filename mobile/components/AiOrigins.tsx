import { useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { showLabel } from '../lib/tooltip'
import type { AiOrigin, AiOriginShown, AiChatTranscript, Backend } from '../lib/useBackend'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import Markdown from './Markdown'

// "Made in the AI chat …" under a Note or an Asset the user's AI made or changed (ADR-0047). The
// backend says what each line reads (backend/lib/ai-chats.mjs, the rules in shared/ai-origin.mjs),
// as desktop does. A chat is a desktop AI Sidebar chat: the phone has no sidebar, so a tap shows the
// chat's messages in a sheet. A Job opens on the Jobs screen. A chat that was deleted, or one that
// was never saved (the phone's own AI panel), shows as "Made with AI" without a link; touch and hold
// says why.
interface Props {
  list?: AiOrigin[]
  apps: Backend['apps'] // with the active Space bound in
  onOpenJob: (id: string) => void
  onOpenUrl?: (url: string) => void // a web or hyper:// link in the chat
  dark?: boolean // on a dark backdrop (the Assets viewer)
  collapsed?: boolean // a small "AI" chip that opens the list in a sheet (Notes' topics bar)
}

const when = (iso: string) => {
  const ms = Date.parse(iso)
  if (!ms) return ''
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function AiOrigins ({ list, apps, onOpenJob, onOpenUrl, dark = false, collapsed = false }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t, dark), [t, dark])
  const key = JSON.stringify(list || [])
  const [shown, setShown] = useState<AiOriginShown[]>([])
  const [open, setOpen] = useState(false)
  const [chat, setChat] = useState<{ origin: AiOriginShown; data: AiChatTranscript | null; error: string } | null>(null)

  useEffect(() => {
    let live = true
    if (!list || !list.length) { setShown([]); return }
    apps<AiOriginShown[]>('aiChats', 'origins', { list }).then((res) => {
      if (live) setShown(res.ok && Array.isArray(res.value) ? res.value : [])
    })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const openChat = async (o: AiOriginShown) => {
    setChat({ origin: o, data: null, error: '' })
    const res = await apps<AiChatTranscript>('aiChats', 'load', { id: o.id, chatSpace: o.space || undefined })
    setChat((c) => (c && c.origin === o ? { origin: o, data: res.ok ? res.value || null : null, error: res.ok ? '' : res.message || 'Couldn’t open the chat' } : c))
  }

  if (!shown.length) return null
  const label = `${shown.some((o) => o.made) ? 'Made with AI' : 'Changed with AI'}${shown.length > 1 ? ` · ${shown.length} chats` : ''}`
  const rows = shown.map((o, i) => {
    const linked = o.kind === 'chat' || o.kind === 'job'
    const tip = o.kind === 'chat' ? 'Show this chat' : o.kind === 'job' ? 'Open this Job' : o.tip
    const at = when(o.at)
    return (
      <Pressable
        key={i}
        style={[s.row, collapsed && s.sheetRow]}
        android_ripple={{ color: t.ripple }}
        onPress={() => {
          if (o.kind === 'chat') { setOpen(false); openChat(o) } else if (o.kind === 'job' && o.id) { setOpen(false); onOpenJob(o.id) } else showLabel(o.tip)
        }}
        onLongPress={() => showLabel(tip)}
        accessibilityRole={linked ? 'button' : 'text'}
        accessibilityLabel={o.text}
        accessibilityHint={tip}
      >
        <Icon name={o.kind === 'job' ? 'clock' : 'robot'} size={12} color={s.muted.color as string} />
        <Text style={[s.text, collapsed && s.sheetText, linked && s.link]} numberOfLines={collapsed ? 2 : 1}>{o.text}</Text>
        {at ? <Text style={s.muted}>· {at}</Text> : null}
      </Pressable>
    )
  })
  return (
    <View style={collapsed ? s.chipWrap : s.root} accessibilityLabel='AI chats that made or changed this'>
      {collapsed ? (
        // A small chip, at the end of a row (Notes' topics bar), that opens the list in a sheet.
        <Pressable
          style={s.chip}
          onPress={() => setOpen(true)}
          onLongPress={() => showLabel('Show the AI chats that made or changed this')}
          hitSlop={8}
          accessibilityRole='button'
          accessibilityLabel={label}
          accessibilityHint='Shows the AI chats that made or changed this'
        >
          <Icon name='robot' size={11} color={s.muted.color as string} />
          <Text style={s.muted}>AI</Text>
        </Pressable>
      ) : rows}
      {collapsed ? (
        <BottomSheet visible={open} onClose={() => setOpen(false)} style={s.sheet}>
          <View style={s.sheetHead}>
            <Icon name='robot' size={15} color={t.textDim} />
            <Text style={s.sheetTitle} numberOfLines={1}>{label}</Text>
          </View>
          <View style={{ paddingBottom: space.md }}>{rows}</View>
        </BottomSheet>
      ) : null}
      <BottomSheet visible={!!chat} onClose={() => setChat(null)} style={s.sheet}>
        <View style={s.sheetHead}>
          <Icon name='robot' size={15} color={t.textDim} />
          <Text style={s.sheetTitle} numberOfLines={2}>{chat?.data?.title || chat?.origin.title || 'AI chat'}</Text>
        </View>
        <Text style={s.sheetHint}>A chat with the AI on your computer. Open it in the AI sidebar there to carry on.</Text>
        {chat && !chat.data && !chat.error ? <ActivityIndicator style={{ marginVertical: space.lg }} color={t.accent} /> : null}
        {chat?.error ? <Text style={s.error}>{chat.error}</Text> : null}
        {chat?.data ? (
          <ScrollView style={s.transcript} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
            {chat.data.messages.map((m, i) => (
              <View key={i} style={[s.bubble, m.role === 'user' ? s.mine : s.theirs]}>
                <Markdown
                  text={m.content}
                  color={m.role === 'user' ? t.onAccent : t.text}
                  onLink={(href) => { if (/^(https?|hyper):/i.test(href)) { setChat(null); onOpenUrl?.(href) } }}
                />
              </View>
            ))}
          </ScrollView>
        ) : null}
      </BottomSheet>
    </View>
  )
}

function makeStyles (t: Theme, dark: boolean) {
  return StyleSheet.create({
    root: { gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: space.md },
    chipWrap: { flexShrink: 0 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    sheetRow: { minHeight: 48, paddingHorizontal: space.lg },
    sheetText: { fontSize: 14 },
    text: { flexShrink: 1, fontSize: 12, color: dark ? 'rgba(255,255,255,0.7)' : t.textDim },
    link: { color: dark ? '#9cc1ff' : t.accent },
    muted: { fontSize: 12, color: dark ? 'rgba(255,255,255,0.45)' : t.textMuted },
    sheet: { maxHeight: '85%' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
    sheetTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: t.text },
    sheetHint: { fontSize: 12, color: t.textMuted, paddingHorizontal: space.lg, paddingTop: 4, paddingBottom: space.sm },
    error: { color: t.danger, paddingHorizontal: space.lg, paddingVertical: space.md },
    transcript: { paddingHorizontal: space.lg },
    bubble: { borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: '92%' },
    mine: { alignSelf: 'flex-end', backgroundColor: t.accent },
    theirs: { alignSelf: 'flex-start', backgroundColor: t.surfaceAlt },
  })
}
