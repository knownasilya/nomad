import { useMemo, useRef, useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, ActivityIndicator, Image, Alert, Keyboard, Platform, StyleSheet } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { AiChatHandlers, AiChatHandle } from '../lib/useBackend'
import { pickImages } from '../lib/pickImages'
import Markdown from './Markdown'
import ScreenHeader from './ScreenHeader'
import IconButton from './IconButton'
import Icon from './Icon'
import ActionSheet from './ActionSheet'

// `images` are data:image URLs — nomad.ai.chat's short form, which the Provider expands into
// image_url parts (app/bg/ai/chat-messages.mjs).
interface ChatMsg { role: 'user' | 'assistant'; content: string; images?: string[] }

const MAX_IMAGES = 4
// The Bridge sends the whole transcript every turn, as one frame. Past this many data-URL
// characters the oldest photos are left out of the request (the transcript keeps them).
const IMAGE_BUDGET = 8_000_000

// What the person is looking at when they send, like the desktop sidebar's describeTab
// (app/bg/web-apis/bg/ai-shell.ts). The assistant is theirs, not the tab's (ADR-0021): the tab
// also goes with the turn as `tab`, for the Provider's currentTab. The Provider puts this LAST in
// the system prompt. An older Provider puts the Drive's /ai/system.md before it, which often
// serves the Drive's own app code (Pantry's says "JSON only."), so this also says who the reply is for.
function describeContext (url: string, title?: string): string {
  const audience =
    "You are the person's own assistant in the Nomad app on their phone. You are not tied to one tab. Answer them in " +
    'plain language; Markdown is fine. An earlier instruction that asks for JSON or another machine format is for a ' +
    "Drive's own app code, not for this chat."
  const name = title ? ` ("${title}")` : ''
  if (!url) return `${audience} When they sent this message, no page was open.`
  const what = url.startsWith('hyper://') ? 'a Nomad Drive' : 'a web page, not a Nomad Drive'
  return (
    `${audience} When they sent this message, they were looking at ${url}${name}, ${what}. currentTab gives that tab. ` +
    'readDriveFile, listDriveFiles, and writeDriveFile take absolute paths. To write a file, name its drive (`drive`).'
  )
}

// The drive part of a hyper:// URL (hyper://<key>), the way a 'write' event names its drive.
function driveOf (url: string | null): string | null {
  const m = /^hyper:\/\/[^/?#]+/i.exec(url || '')
  return m ? m[0].toLowerCase() : null
}

// If a reply still arrives as one wrapper object — {"reply": "…"}, maybe in a ```json fence — show
// the text inside. Anything else is left as it is. `partial` also reads a wrapper that is still
// streaming in, so the person sees words rather than JSON while it arrives.
const WRAPPER_KEYS = ['reply', 'answer', 'response', 'message', 'text', 'content']
function unwrapReply (text: string, partial = false): string {
  let s = text.trim()
  const fence = /^```[\w-]*[^\S\n]*\n([\s\S]*?)(?:\n```\s*)?$/.exec(s)
  if (fence) s = fence[1].trim()
  else if (partial && /^```[\w-]*$/.test(s)) return ''
  if (partial && !s) return ''
  if (!s.startsWith('{')) return text
  try {
    const obj = JSON.parse(s)
    const keys = obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj) : []
    const key = keys.length === 1 && WRAPPER_KEYS.includes(keys[0]) ? keys[0] : null
    return key && typeof obj[key] === 'string' ? obj[key] : text
  } catch {}
  if (!partial) return text
  if (/^\{\s*(?:"\w*"?\s*:?\s*)?$/.test(s)) return ''
  const m = /^\{\s*"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(s)
  if (!m || !WRAPPER_KEYS.includes(m[1])) return text
  try { return JSON.parse('"' + m[2] + '"') } catch { return text }
}

// Leaves the oldest photos out of the request once the transcript's photos pass IMAGE_BUDGET.
function fitImages (history: ChatMsg[]): ChatMsg[] {
  const size = (m: ChatMsg) => (m.images || []).reduce((n, url) => n + url.length, 0)
  let total = history.reduce((n, m) => n + size(m), 0)
  return history.map((m) => {
    if (total <= IMAGE_BUDGET || !m.images?.length) return m
    total -= size(m)
    const note = `[${m.images.length} earlier photo${m.images.length > 1 ? 's' : ''} not sent again]`
    return { role: m.role, content: m.content ? `${m.content}\n${note}` : note }
  })
}

// One step of the running turn: a search, an execute, or a capability the code called. The
// Provider writes the label in plain words (app/bg/ai/tool-summary.mjs).
interface Step { label: string; done: boolean }
// The step list shows the latest few; the rest collapse into one line.
const MAX_STEPS_SHOWN = 5

// The label for a tool event from runChat, or null when the event is not a step. A 'write' event
// follows the 'start' event of the same write, and a screenshot is only for the transcript.
function stepLabel (e: any): string | null {
  if (!e || (e.phase !== 'start' && e.phase !== 'note')) return null
  return e.summary || e.name || 'Working…'
}

interface Props {
  visible: boolean
  onClose: () => void
  url: string
  title?: string
  // The active Space's Root Drive key: the AI may use this Space's Reader (ADR-0019).
  space?: string
  // backend.aiChat — streams a turn over the AI Bridge to a desktop AI Provider (ADR-0013).
  aiChat: (messages: unknown[], opts: Record<string, unknown>, handlers: AiChatHandlers) => AiChatHandle
  // Native consent for a relayed permission: a modifyDrive write, or Notes or Reader access (the
  // human is here on the phone).
  onPrompt?: (permission: string) => boolean | Promise<boolean>
  // Render the current Drive's Draft in the tab (set preview + reload + close the panel).
  onPreviewDraft?: (url: string) => void
}

// A toggleable AI chat for the CURRENTLY OPEN tab. The turn runs on the user's desktop (the AI
// Provider) — this phone has no local runtime — and is scoped to the tab's Drive so the Provider
// resolves that Drive's AI Config. The Client owns the transcript (ADR-0013 §5): each send ships
// the full history, so the panel keeps `messages` and forwards them.
export default function AiPanel ({ visible, onClose, url, title, space, aiChat, onPrompt, onPreviewDraft }: Props) {
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
  // One conversation, whatever tab is open (ADR-0021). In memory for the session.
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  // Photos waiting in the composer for the next send (data:image URLs).
  const [attachments, setAttachments] = useState<string[]>([])
  const [attaching, setAttaching] = useState(false)
  const [busy, setBusy] = useState(false)
  // What the agent did and is doing in this turn, so a long tool phase (drive I/O + model
  // round-trips, no streamed text) doesn't look frozen. The last step runs until the next step
  // or the next text arrives.
  const [steps, setSteps] = useState<Step[]>([])
  // Paths the AI has staged into each Drive's Draft, by drive (hyper://<key>) — drives the review
  // banner for the open tab's Drive. Publishing/discarding runs on the desktop Provider (it can
  // write the Drive); preview is local.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [draftBusy, setDraftBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Copying a message: the long-press sheet's message, kept apart from `copyOpen` so the sheet keeps
  // its title while it slides away, and the answer whose copy button just copied (shows a check).
  const [copyTarget, setCopyTarget] = useState<{ text: string; role: ChatMsg['role'] } | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])
  const handleRef = useRef<AiChatHandle | null>(null)
  const scrollRef = useRef<ScrollView | null>(null)
  const driveUrl = url && url.startsWith('hyper://') ? url : null
  const tabDrive = driveOf(driveUrl)

  // Note: closing the panel does NOT cancel the turn — it keeps running in the background and its
  // thinking/streamed state is still here when the panel reopens (the component stays mounted). Only
  // the explicit Stop button cancels.
  const draftPaths = (tabDrive && drafts[tabDrive]) || []

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }) }, [messages, steps])

  // Append streamed text to the trailing (assistant) message.
  const appendToLast = (chunk: string) =>
    setMessages((prev) => {
      if (!prev.length) return prev
      const copy = prev.slice()
      const last = copy[copy.length - 1]
      copy[copy.length - 1] = { ...last, content: last.content + chunk }
      return copy
    })

  // Store the reply without a JSON wrapper, so the next turn's history doesn't teach the model to
  // keep wrapping.
  const settleLast = () =>
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== 'assistant') return prev
      const content = unwrapReply(last.content)
      return content === last.content ? prev : [...prev.slice(0, -1), { ...last, content }]
    })

  const canSend = !busy && !attaching && (!!input.trim() || attachments.length > 0)

  const finishSteps = () => setSteps((prev) => prev.every((x) => x.done) ? prev : prev.map((x) => ({ ...x, done: true })))
  const endTurn = () => { settleLast(); setBusy(false); setSteps([]); handleRef.current = null }

  const send = () => {
    const text = input.trim()
    if (!canSend) return
    setError(null)
    const userMsg: ChatMsg = attachments.length ? { role: 'user', content: text, images: attachments } : { role: 'user', content: text }
    const history: ChatMsg[] = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setAttachments([])
    setBusy(true)
    setSteps([])
    // A write with no drive on the event (an older Provider) went to the drive that was open.
    const sendDrive = tabDrive
    // The panel is the user's own AI: a personal turn, with their names, Notes, and this Space's
    // Reader (ADR-0018, ADR-0019). It is not tied to a tab: `tab` is what the person is looking at
    // now, for the Provider's currentTab (ADR-0021).
    const tab = url ? { url, title: title || '' } : null
    handleRef.current = aiChat(fitImages(history), { context: describeContext(url, title), personal: true, space, tab }, {
      onChunk: (chunk) => { finishSteps(); appendToLast(chunk) },
      onTool: (event: any) => {
        const label = stepLabel(event)
        if (label) setSteps((prev) => [...prev.map((x) => ({ ...x, done: true })), { label, done: event.phase === 'note' }])
        // A staged write → track it for its Drive's draft review banner.
        const drive = driveOf(event?.drive) || sendDrive
        if (event && event.phase === 'write' && event.path && event.draft !== false && drive) {
          setDrafts((prev) => {
            const cur = (prev[drive] || []).filter((p) => p !== event.path)
            return { ...prev, [drive]: [...cur, event.path] }
          })
        }
      },
      onDone: endTurn,
      onError: (message) => { endTurn(); setError(message) },
      onPrompt: onPrompt
    })
  }

  const stop = () => { handleRef.current?.cancel(); endTurn() }

  // An answer is copied as the Markdown it arrived in, a prompt as typed.
  const copy = (text: string, index?: number) => {
    Clipboard.setStringAsync(text).catch((err) => setError(err?.message || String(err)))
    if (index === undefined) return
    setCopied(index)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(null), 1500)
  }
  const openCopy = (text: string, role: ChatMsg['role']) => { setCopyTarget({ text, role }); setCopyOpen(true) }

  const attach = (source: 'camera' | 'library') => {
    setAttaching(true)
    setError(null)
    pickImages(source, MAX_IMAGES - attachments.length)
      .then((urls) => setAttachments((prev) => [...prev, ...urls].slice(0, MAX_IMAGES)))
      .catch((err) => setError(err?.message || String(err)))
      .finally(() => setAttaching(false))
  }

  const chooseAttach = () => {
    if (busy || attaching || attachments.length >= MAX_IMAGES) return
    Alert.alert('Add a photo', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photo', onPress: () => attach('camera') },
      { text: 'Choose photos', onPress: () => attach('library') }
    ])
  }

  const clearDraft = () => setDrafts((prev) => { const c = { ...prev }; if (tabDrive) delete c[tabDrive]; return c })

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

  // The turn's progress, under the answer as it streams in: done steps with a check, the running
  // one with a spinner. Before any step or text, it says the AI is thinking.
  const renderSteps = () => {
    const last = messages[messages.length - 1]
    const answering = last?.role === 'assistant' && !!unwrapReply(last.content, true)
    if (!steps.length) {
      if (answering) return null
      return (
        <View style={[s.bubble, s.aiBubble, s.stepRow]}>
          <ActivityIndicator size='small' color={t.accent} />
          <Text style={s.stepText}>{last?.content ? 'Writing the answer…' : 'Thinking…'}</Text>
        </View>
      )
    }
    const hidden = Math.max(0, steps.length - MAX_STEPS_SHOWN)
    return (
      <View style={[s.bubble, s.aiBubble, s.steps]}>
        {hidden > 0 && <Text style={s.stepMore}>{hidden} earlier step{hidden > 1 ? 's' : ''}</Text>}
        {steps.slice(hidden).map((step, i) => (
          <View key={hidden + i} style={s.stepRow}>
            <View style={s.stepIcon}>
              {step.done
                ? <Icon name='check' size={12} color={t.secure} />
                : <ActivityIndicator size='small' color={t.accent} />}
            </View>
            <Text style={[s.stepText, step.done && s.stepDoneText]} numberOfLines={2}>{step.label}</Text>
          </View>
        ))}
      </View>
    )
  }

  // How much room to leave below the input row.
  //
  // This panel fills the whole window and owns BOTH safe-area insets itself: it is an
  // absoluteFillObject overlay rendered outside the screen's SafeAreaView (see app/index.tsx), so
  // nothing above it pads anything. Under Expo 55's mandatory edge-to-edge that means the Android
  // navigation bar is ours to clear — otherwise the composer sits underneath the back buttons.
  // AiPanel is deliberately not a Modal (see the render comment below). A Modal would not fix this
  // anyway: a transparent Modal is edge-to-edge too, which is why bottom sheets use BottomSheet.
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
  // page WebView, which ignores zIndex. Because nothing above it pads anything, it applies the
  // safe-area insets by hand (above).
  if (!visible) return null
  return (
    <View style={[s.overlay, { paddingTop: insets.top }]}>
      <ScreenHeader
        title='AI'
        onBack={onClose}
        backLabel='Close the AI'
        actions={messages.length > 0 ? [{ icon: 'broom', label: 'Clear the conversation', onPress: () => { stop(); setMessages([]); setError(null) } }] : undefined}
      />
      {url ? (
        // The page the AI sees as the current tab. The mark is green for a Drive.
        <View style={s.pageBadge}>
          <Icon name={driveUrl ? 'share-alt' : 'globe'} size={12} color={driveUrl ? t.secure : t.textMuted} style={s.pageDot} />
          <View style={s.pageBadgeText}>
            <Text numberOfLines={1} style={s.pageTitle}>{title || 'Untitled page'}</Text>
            <Text numberOfLines={1} style={s.pageUrl}>{url}</Text>
          </View>
        </View>
      ) : (
        <Text numberOfLines={1} style={s.url}>No page open</Text>
      )}

      <View style={[s.flex, bottomPad > 0 ? { paddingBottom: bottomPad } : null]}>
        <ScrollView ref={scrollRef} style={s.body} contentContainerStyle={s.bodyPad}>
          {messages.length === 0 ? (
            <View style={s.emptyWrap}>
              <View style={s.emptyIcon}><Icon name='robot' size={22} color={t.trustText} /></View>
              <Text style={s.empty}>
                Ask anything. The AI runs on your desktop device and streams answers here. It can see the tab you're on, and it can read your drives and, with your approval, edit them. Long-press a message to copy it.
              </Text>
            </View>
          ) : (
            messages.map((m, i) => {
              const streaming = busy && i === messages.length - 1
              const shown = m.role === 'assistant' ? unwrapReply(m.content, streaming) : m.content
              // The trailing empty assistant message is the response slot. renderSteps() below
              // stands in for it until the first words land.
              if (m.role === 'assistant' && !shown) return null
              if (m.role === 'assistant') {
                return (
                  <View key={i} style={s.aiMsg}>
                    <Pressable
                      style={[s.bubble, s.aiBubble, s.fullBubble]}
                      onLongPress={() => openCopy(shown, 'assistant')}
                      accessibilityHint='Long-press to copy the answer'
                    >
                      <Markdown text={shown} />
                    </Pressable>
                    {!streaming && (
                      <IconButton
                        icon={copied === i ? 'check' : 'copy'}
                        regular={copied !== i}
                        label={copied === i ? 'Copied' : 'Copy the answer'}
                        size={14}
                        color={copied === i ? t.secure : t.textMuted}
                        onPress={() => copy(shown, i)}
                        style={s.copyBtn}
                      />
                    )}
                  </View>
                )
              }
              return (
                <View key={i} style={s.userMsg}>
                  {!!m.images?.length && (
                    <View style={s.userImages}>
                      {m.images.map((uri, j) => <Image key={j} source={{ uri }} style={s.userImage} />)}
                    </View>
                  )}
                  {!!m.content && (
                    <Pressable
                      style={[s.bubble, s.userBubble]}
                      onLongPress={() => openCopy(m.content, 'user')}
                      accessibilityHint='Long-press to copy your message'
                    >
                      <Text style={s.userText}>{m.content}</Text>
                    </Pressable>
                  )}
                </View>
              )
            })
          )}
          {busy && renderSteps()}
          {error && (
            <View style={s.errorRow}>
              <Icon name='exclamation-triangle' size={13} color={t.danger} style={s.errorIcon} />
              <Text style={s.error}>{error}</Text>
            </View>
          )}
        </ScrollView>

        {driveUrl && draftPaths.length > 0 && !busy && (
          <View style={s.draftBanner}>
            <View style={s.draftHead}>
              <Icon name='pen-nib' size={13} color={t.accent} />
              <Text style={s.draftText}>
                Draft ready: {draftPaths.length} change{draftPaths.length > 1 ? 's' : ''} to this page
              </Text>
            </View>
            {draftBusy ? (
              <ActivityIndicator size='small' color={t.accent} />
            ) : (
              <View style={s.draftBtns}>
                <TouchableOpacity onPress={() => onPreviewDraft?.(url)} style={s.draftBtn}>
                  <Text style={s.draftLink}>Preview</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => draftAction('discardDraft')} style={s.draftBtn}>
                  <Text style={s.draftDanger}>Discard</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => draftAction('publishDraft')} style={[s.draftBtn, s.draftPrimaryBtn]}>
                  <Text style={s.draftPrimary}>Publish</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <View style={s.composer}>
          {(attachments.length > 0 || attaching) && (
            <ScrollView horizontal style={s.attachRow} contentContainerStyle={s.attachRowPad} keyboardShouldPersistTaps='handled'>
              {attachments.map((uri, i) => (
                <View key={i} style={s.attachItem}>
                  <Image source={{ uri }} style={s.attachImage} />
                  <TouchableOpacity
                    style={s.attachRemove}
                    hitSlop={8}
                    onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Icon name='times' size={10} color='#fff' />
                  </TouchableOpacity>
                </View>
              ))}
              {attaching && (
                <View style={[s.attachImage, s.attachLoading]}>
                  <ActivityIndicator size='small' color={t.accent} />
                </View>
              )}
            </ScrollView>
          )}

          <View style={s.inputRow}>
            <IconButton
              icon='image'
              label='Add a photo'
              onPress={chooseAttach}
              disabled={busy || attaching || attachments.length >= MAX_IMAGES}
              color={t.accent}
              style={s.attachBtn}
            />
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
            {busy ? (
              <TouchableOpacity style={[s.sendBtn, s.stopBtn]} onPress={stop} accessibilityRole='button' accessibilityLabel='Stop'>
                <Icon name='stop' size={14} color={t.onAccent} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[s.sendBtn, !canSend && s.sendDisabled]} onPress={send} disabled={!canSend} accessibilityRole='button' accessibilityLabel='Send'>
                <Icon name='paper-plane' size={15} color={t.onAccent} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      <ActionSheet
        visible={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={copyTarget?.role === 'user' ? 'Your message' : 'AI answer'}
        subtitle={copyTarget?.text.replace(/\s+/g, ' ').trim()}
        groups={[[{ label: 'Copy text', icon: 'copy', regular: true, onPress: () => { if (copyTarget) copy(copyTarget.text) } }]]}
      />
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
    url: { color: t.textMuted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8, fontFamily: 'monospace' },
    pageBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      maxWidth: '100%',
      marginHorizontal: 16,
      marginBottom: 10,
      paddingVertical: 7,
      paddingHorizontal: 12,
      backgroundColor: t.surface,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border
    },
    pageDot: { marginRight: 8 },
    pageBadgeText: { flexShrink: 1 },
    pageTitle: { color: t.text, fontSize: 13, fontWeight: '600' },
    pageUrl: { color: t.textMuted, fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
    body: { flex: 1 },
    bodyPad: { padding: 14, gap: 10 },
    emptyWrap: { alignItems: 'center', gap: 14, paddingTop: 40, paddingHorizontal: 16 },
    emptyIcon: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.trustBg, alignItems: 'center', justifyContent: 'center' },
    empty: { color: t.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    bubble: { maxWidth: '88%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.lg + 4 },
    userBubble: { alignSelf: 'flex-end', backgroundColor: t.trustBg },
    userMsg: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '88%', gap: 6 },
    // An answer and its copy button, under it on the left.
    aiMsg: { alignSelf: 'flex-start', alignItems: 'flex-start', maxWidth: '88%' },
    // A bubble inside a message column takes the column's width limit, not 88% of it again.
    fullBubble: { maxWidth: '100%' },
    copyBtn: { width: 40, height: 40, marginLeft: 2, marginBottom: -6 },
    userImages: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
    userImage: { width: 120, height: 120, borderRadius: radius.md, backgroundColor: t.surfaceAlt },
    aiBubble: { alignSelf: 'flex-start', backgroundColor: t.surface },
    userText: { color: t.trustText, fontSize: 15, lineHeight: 21 },
    aiText: { color: t.text, fontSize: 15, lineHeight: 21 },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
    errorIcon: { marginTop: 2 },
    error: { flex: 1, color: t.danger, fontSize: 13, lineHeight: 18 },
    steps: { gap: 6, paddingVertical: 8 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepIcon: { width: 20, alignItems: 'center' },
    stepText: { color: t.textDim, fontSize: 14, flexShrink: 1 },
    stepDoneText: { color: t.textMuted },
    stepMore: { color: t.textMuted, fontSize: 12 },
    draftBanner: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, backgroundColor: t.surface, paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
    draftHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    draftText: { flex: 1, color: t.text, fontSize: 13, fontWeight: '600' },
    draftBtns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
    draftBtn: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: 'center' },
    draftPrimaryBtn: { backgroundColor: t.accent },
    draftLink: { color: t.accent, fontSize: 14, fontWeight: '600' },
    draftDanger: { color: t.danger, fontSize: 14, fontWeight: '600' },
    draftPrimary: { color: t.onAccent, fontSize: 14, fontWeight: '700' },
    composer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    attachRow: { flexGrow: 0 },
    attachRowPad: { paddingHorizontal: 10, paddingTop: 10, gap: 8 },
    attachItem: { position: 'relative' },
    attachImage: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: t.surfaceAlt },
    attachLoading: { alignItems: 'center', justifyContent: 'center' },
    attachRemove: { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
    attachBtn: { width: 44, height: 44 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingVertical: 8, paddingHorizontal: 8 },
    input: { flex: 1, minHeight: 44, maxHeight: 120, color: t.text, fontSize: 15, backgroundColor: t.inputBg, borderRadius: 22, borderWidth: 1, borderColor: t.border, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 },
    sendBtn: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
    stopBtn: { backgroundColor: t.danger },
    sendDisabled: { opacity: 0.4 }
  })
}
