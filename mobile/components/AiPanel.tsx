import { useMemo, useRef, useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Keyboard, Platform, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { AiChatHandlers, AiChatHandle } from '../lib/useBackend'
import Markdown from './Markdown'

interface ChatMsg { role: 'user' | 'assistant'; content: string }

// Human label for a tool-activity event from runChat (e.g. { phase:'start', summary:'Reading /x' }
// or { phase:'write', name:'writeDriveFile', path:'/x' }).
function toolLabel (e: any): string {
  if (!e) return 'Working…'
  if (e.summary) return e.summary
  if (e.phase === 'write' && e.path) return `Wrote ${e.path}`
  if (e.name) return e.name
  return 'Working…'
}

interface Props {
  visible: boolean
  onClose: () => void
  url: string
  title?: string
  // backend.aiChat — streams a turn over the AI Bridge to a desktop AI Provider (ADR-0013).
  aiChat: (messages: unknown[], opts: Record<string, unknown>, handlers: AiChatHandlers) => AiChatHandle
  // Native consent for a relayed modifyDrive write (the human is here on the phone).
  onPrompt?: (permission: string) => boolean | Promise<boolean>
  // Render the current Drive's Draft in the tab (set preview + reload + close the panel).
  onPreviewDraft?: (url: string) => void
}

// A toggleable AI chat for the CURRENTLY OPEN tab. The turn runs on the user's desktop (the AI
// Provider) — this phone has no local runtime — and is scoped to the tab's Drive so the Provider
// resolves that Drive's AI Config. The Client owns the transcript (ADR-0013 §5): each send ships
// the full history, so the panel keeps `messages` and forwards them.
export default function AiPanel ({ visible, onClose, url, title, aiChat, onPrompt, onPreviewDraft }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const insets = useSafeAreaInsets()
  // Keyboard tracking. The panel lifts its own content by the keyboard height rather than relying
  // on KeyboardAvoidingView (which can spin in an onLayout loop here) or on Android's adjustResize
  // (a no-op under edge-to-edge). iOS gets the `will` events so the lift animates with the keyboard.
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  useEffect(() => {
    if (!visible) { setKeyboardHeight(0); return }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0))
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))
    return () => { show.remove(); hide.remove() }
  }, [visible])
  // Per-context transcripts (keyed by Drive URL, or 'general' for a non-Drive tab). Opening the panel
  // on tab A vs tab B — or with no page — shows that context's own history. In-memory for the session.
  const [conversations, setConversations] = useState<Record<string, ChatMsg[]>>({})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // What the agent is doing right now — surfaced as a status line so a long tool phase (drive I/O +
  // model round-trips, no streamed text) doesn't look frozen.
  const [activity, setActivity] = useState<string | null>(null)
  // Which context's transcript the in-flight turn belongs to, so a turn started for tab A keeps
  // running (and shows its thinking state) even if the panel is closed and reopened.
  const [activeTurnKey, setActiveTurnKey] = useState<string | null>(null)
  // Paths the AI has staged into each context's Drive Draft (per contextKey) — drives the review
  // banner. Publishing/discarding runs on the desktop Provider (it can write the Drive); preview is local.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [draftBusy, setDraftBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<AiChatHandle | null>(null)
  const scrollRef = useRef<ScrollView | null>(null)
  const driveUrl = url && url.startsWith('hyper://') ? url : null
  const contextKey = driveUrl || 'general'
  const messages = useMemo(() => conversations[contextKey] || [], [conversations, contextKey])
  // Update only the current context's transcript (accepts an array or an updater fn, like setState).
  const setMessages = (updater: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) =>
    setConversations((prev) => {
      const cur = prev[contextKey] || []
      const next = typeof updater === 'function' ? updater(cur) : updater
      return { ...prev, [contextKey]: next }
    })

  // Note: closing the panel does NOT cancel the turn — it keeps running in the background and its
  // thinking/streamed state is still here when the panel reopens (the component stays mounted). Only
  // the explicit Stop button cancels.
  const turnActiveHere = busy && activeTurnKey === contextKey
  const draftPaths = drafts[contextKey] || []

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }) }, [messages])

  // Switching context (opening the panel for a different tab) starts clean — a half-typed draft or a
  // stale error from one context shouldn't leak into another. The transcript itself is preserved.
  useEffect(() => { setInput(''); setError(null) }, [contextKey])

  // Append streamed text to the trailing (assistant) message.
  const appendToLast = (chunk: string) =>
    setMessages((prev) => {
      if (!prev.length) return prev
      const copy = prev.slice()
      const last = copy[copy.length - 1]
      copy[copy.length - 1] = { ...last, content: last.content + chunk }
      return copy
    })

  const send = () => {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    const history: ChatMsg[] = [...messages, { role: 'user', content: text }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    setActivity('Thinking…')
    setActiveTurnKey(contextKey)
    const sendKey = contextKey
    handleRef.current = aiChat(history, { driveUrl: driveUrl || undefined }, {
      onChunk: (chunk) => { setActivity('Responding…'); appendToLast(chunk) },
      onTool: (event: any) => {
        setActivity(toolLabel(event))
        // A staged write → track it for the draft review banner (keyed to the turn's context).
        if (event && event.phase === 'write' && event.path) {
          setDrafts((prev) => {
            const cur = (prev[sendKey] || []).filter((p) => p !== event.path)
            return { ...prev, [sendKey]: [...cur, event.path] }
          })
        }
      },
      onDone: () => { setBusy(false); setActivity(null); setActiveTurnKey(null); handleRef.current = null },
      onError: (message) => { setBusy(false); setActivity(null); setActiveTurnKey(null); handleRef.current = null; setError(message) },
      onPrompt: onPrompt
    })
  }

  const stop = () => { handleRef.current?.cancel(); handleRef.current = null; setBusy(false); setActivity(null); setActiveTurnKey(null) }

  const clearDraft = () => setDrafts((prev) => { const c = { ...prev }; delete c[contextKey]; return c })

  // Publish/Discard run on the desktop Provider (which can write the Drive) via a no-chat Bridge
  // request; the staged Draft lives in the Vault and syncs both ways.
  const draftAction = (action: 'publishDraft' | 'discardDraft') => {
    if (!driveUrl || draftBusy) return
    setDraftBusy(true)
    setError(null)
    aiChat([], { driveUrl, [action]: true }, {
      onDone: () => { setDraftBusy(false); clearDraft() },
      onError: (message) => { setDraftBusy(false); setError(message) }
    })
  }

  // How much room to leave below the input row.
  //
  // This panel fills the whole window and owns BOTH safe-area insets itself: it is an
  // absoluteFillObject overlay rendered outside the screen's SafeAreaView (see app/index.tsx), so
  // nothing above it pads anything. Under Expo 55's mandatory edge-to-edge that means the Android
  // navigation bar is ours to clear — otherwise the composer sits underneath the back buttons.
  // Every sibling panel is a Modal, which gets its own window and never has to think about this;
  // AiPanel is deliberately not one (see the render comment below).
  //
  // The keyboard is then measured differently per platform:
  //   Android — keyboardDidShow reports `imeInsets.bottom - systemBars.bottom`, i.e. the nav-bar
  //             inset is ALREADY taken out, so the gap from the screen edge up to the keyboard is
  //             that height plus the inset. With no keyboard the same sum leaves exactly the inset.
  //   iOS     — `endCoordinates.height` runs to the bottom of the screen, home indicator included,
  //             so it IS the gap; with no keyboard, fall back to the home-indicator inset.
  const bottomPad = Platform.OS === 'ios'
    ? (keyboardHeight > 0 ? keyboardHeight : insets.bottom)
    : keyboardHeight + insets.bottom

  // Rendered as an in-tree overlay, NOT a Modal. On Android a Modal is its own Dialog window, and
  // RN only emits keyboardDidShow/Hide from the activity's root view — so a Modal never hears the
  // keyboard and its input row stays buried under it. `elevation` keeps the overlay above the
  // page WebView, which ignores zIndex. The cost of not being a Modal is the safe-area handling
  // above: a Modal window gets insets for free, this has to apply them by hand.
  if (!visible) return null
  return (
    <View style={[s.overlay, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.title}>AI</Text>
        <View style={s.headerRight}>
          {messages.length > 0 && (
            <TouchableOpacity onPress={() => { stop(); setMessages([]); setError(null) }} hitSlop={8} style={s.headerBtn}>
              <Text style={s.headerBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={10} style={s.close}><Text style={s.closeText}>✕</Text></TouchableOpacity>
        </View>
      </View>
      {driveUrl ? (
        <View style={s.pageBadge}>
          <View style={s.pageDot} />
          <View style={s.pageBadgeText}>
            <Text numberOfLines={1} style={s.pageTitle}>{title || 'Untitled page'}</Text>
            <Text numberOfLines={1} style={s.pageUrl}>{url}</Text>
          </View>
        </View>
      ) : (
        <Text numberOfLines={1} style={s.url}>General chat (no page context)</Text>
      )}

      <View style={[s.flex, bottomPad > 0 ? { paddingBottom: bottomPad } : null]}>
        <ScrollView ref={scrollRef} style={s.body} contentContainerStyle={s.bodyPad}>
          {messages.length === 0 ? (
            <Text style={s.empty}>
              Ask about {driveUrl ? 'this drive' : 'anything'}. The AI runs on your desktop device and streams answers here — it can read and (with your approval) edit the drive.
            </Text>
          ) : (
            messages.map((m, i) => {
              // The trailing empty assistant message is the response slot. While busy, show the
              // thinking indicator right there — left side, under the last user message, exactly
              // where the answer will stream in. It's replaced by the text once the first token lands.
              if (m.role === 'assistant' && !m.content) {
                if (!turnActiveHere || i !== messages.length - 1) return null
                return (
                  <View key={i} style={[s.bubble, s.aiBubble, s.thinkingBubble]}>
                    <ActivityIndicator size='small' color={t.accent} />
                    <Text style={s.thinkingText} numberOfLines={1}>{activity || 'Thinking…'}</Text>
                  </View>
                )
              }
              return (
                <View key={i} style={[s.bubble, m.role === 'user' ? s.userBubble : s.aiBubble]}>
                  {m.role === 'user'
                    ? <Text style={s.userText}>{m.content}</Text>
                    : <Markdown text={m.content} />}
                </View>
              )
            })
          )}
          {error && <Text style={s.error}>⚠️ {error}</Text>}
        </ScrollView>

        {driveUrl && draftPaths.length > 0 && !turnActiveHere && (
          <View style={s.draftBanner}>
            <Text style={s.draftText}>
              ✎ Draft ready — {draftPaths.length} change{draftPaths.length > 1 ? 's' : ''} to this page
            </Text>
            {draftBusy ? (
              <ActivityIndicator size='small' color={t.accent} />
            ) : (
              <View style={s.draftBtns}>
                <TouchableOpacity onPress={() => onPreviewDraft?.(url)} hitSlop={6}>
                  <Text style={s.draftLink}>Preview</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => draftAction('discardDraft')} hitSlop={6}>
                  <Text style={s.draftDanger}>Discard</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => draftAction('publishDraft')} hitSlop={6}>
                  <Text style={s.draftPrimary}>Publish</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder='Message the AI…'
            placeholderTextColor={t.textMuted}
            multiline
            editable={!busy}
            onSubmitEditing={send}
          />
          {turnActiveHere ? (
            <TouchableOpacity style={[s.sendBtn, s.stopBtn]} onPress={stop}>
              <Text style={s.sendText}>Stop</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.sendBtn, (!input.trim() || busy) && s.sendDisabled]} onPress={send} disabled={!input.trim() || busy}>
              <Text style={s.sendText}>Send</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    // Covers the whole screen area inside the app's safe-area padding (Yoga lays an absolute child
    // out from its parent's padding box), so the panel never sits under the status or nav bar.
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg, zIndex: 50, elevation: 50 },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 48 },
    title: { color: t.text, fontSize: 18, fontWeight: '700' },
    headerRight: { flexDirection: 'row', alignItems: 'center' },
    headerBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    headerBtnText: { color: t.accent, fontSize: 14 },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: t.textDim, fontSize: 18 },
    url: { color: t.textMuted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8, fontFamily: 'monospace' },
    pageBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      maxWidth: '100%',
      marginHorizontal: 16,
      marginBottom: 10,
      paddingVertical: 7,
      paddingHorizontal: 10,
      backgroundColor: t.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border
    },
    pageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.secure, marginRight: 8 },
    pageBadgeText: { flexShrink: 1 },
    pageTitle: { color: t.text, fontSize: 13, fontWeight: '600' },
    pageUrl: { color: t.textMuted, fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
    body: { flex: 1 },
    bodyPad: { padding: 14, gap: 10 },
    empty: { color: t.textMuted, fontSize: 13, lineHeight: 19 },
    bubble: { maxWidth: '88%', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
    userBubble: { alignSelf: 'flex-end', backgroundColor: t.trustBg },
    aiBubble: { alignSelf: 'flex-start', backgroundColor: t.surface },
    userText: { color: t.trustText, fontSize: 15, lineHeight: 21 },
    aiText: { color: t.text, fontSize: 15, lineHeight: 21 },
    error: { color: t.danger, fontSize: 13, paddingVertical: 6 },
    thinkingBubble: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    thinkingText: { color: t.textDim, fontSize: 14, flexShrink: 1 },
    draftBanner: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, backgroundColor: t.surface, paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
    draftText: { color: t.text, fontSize: 13, fontWeight: '600' },
    draftBtns: { flexDirection: 'row', alignItems: 'center', gap: 20 },
    draftLink: { color: t.accent, fontSize: 15, fontWeight: '600' },
    draftDanger: { color: t.danger, fontSize: 15, fontWeight: '600' },
    draftPrimary: { color: t.secure, fontSize: 15, fontWeight: '700' },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    input: { flex: 1, maxHeight: 120, color: t.text, fontSize: 15, backgroundColor: t.inputBg, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 },
    sendBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.md, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
    stopBtn: { backgroundColor: t.danger },
    sendDisabled: { opacity: 0.4 },
    sendText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
