import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { Backend, Note } from '../lib/useBackend'
import editorHtml from '../lib/noteEditorHtml'
import LinkPhone from './LinkPhone'

const SAVE_DELAY = 800

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onOpenDevices: () => void
  onOpenUrl: (url: string) => void
}

// The note in the editor. One object per open note, changed in place, so a save that finishes after
// more typing still gives the new note its id. base: the updatedAt of the version it started from.
interface Draft { id: string | null; body: string; title: string; base: string | null; openedTitle: string | null; conflictOf: string | null }

// The editor's formatting buttons: [command in app/userland/notes/js/editor/commands.js, label].
const TOOLS: [string, string][] = [['heading', 'H'], ['bold', 'B'], ['italic', 'I'], ['strike', 'S'], ['bullet', '•'], ['task', '☑'], ['quote', '❝'], ['code', '</>'], ['link', '[[ ]]']]

// The phone's Notes (ADR-0017): the same Markdown notes as desktop's nomad://notes, kept in the Vault,
// edited the same way: Obsidian-style Live Preview, [[ links between notes, and linked mentions. The
// editor is desktop's, bundled into a page (lib/noteEditorHtml.ts, from app/userland/notes/js/mobile.js)
// and run in a WebView. Edits save a moment after typing stops. An edit that crosses another Device's
// becomes a conflict copy. A new note left empty is never stored; an emptied one is deleted when you
// leave it. Retitling a note updates the links to it.
export default function Notes ({ visible, onClose, apps, onOpenDevices, onOpenUrl }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  // backend.apps is a new function on every parent render. Calling through a ref keeps the effects
  // below from re-running (and reloading) on each one.
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args) => appsRef.current(app, action, args)) as Backend['apps'], [])

  const [notes, setNotes] = useState<Note[] | null>(null)
  const [writable, setWritable] = useState(true)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [banner, setBanner] = useState<string | null>(null)

  const notesRef = useRef<Note[]>([])
  const draft = useRef<Draft | null>(null)
  const dirty = useRef(false)
  const saving = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const web = useRef<WebView>(null)
  const ready = useRef(false)
  const pendingHeading = useRef('')

  const keepNotes = (list: Note[]) => {
    notesRef.current = list
    setNotes(list)
  }

  // Tell the editor page something: window.__noteEditor in app/userland/notes/js/mobile.js.
  const send = useCallback((msg: Record<string, unknown>) => {
    web.current?.injectJavaScript(`window.__noteEditor && window.__noteEditor(${JSON.stringify(msg)});true;`)
  }, [])

  const load = useCallback(async () => {
    setError('')
    const res = await call<{ notes: Note[]; writable: boolean }>('notes', 'list')
    if (res.noVault) { setNoVault(true); setNotes(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load your notes'); return }
    keepNotes(res.value.notes)
    setWritable(res.value.writable)
    if (ready.current) send({ type: 'notes', notes: res.value.notes })
  }, [call, send])

  useEffect(() => { if (visible) load() }, [visible, load])

  const showDraft = useCallback((focus: boolean) => {
    const d = draft.current
    if (!d) return
    send({ type: 'load', theme: t, id: d.id, body: d.body, notes: notesRef.current, readOnly: !writable, focus, heading: pendingHeading.current })
    pendingHeading.current = ''
  }, [send, t, writable])

  const save = useCallback(async (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (saving.current) { await saving.current; return save() }
    const target = draft.current
    if (!target || !dirty.current) return
    dirty.current = false
    if (!target.id && !target.body.trim()) return // an empty new note is never stored

    setStatus('Saving…')
    const wasId = target.id
    const run = (async () => {
      const res = await call<Note>('notes', 'save', { id: target.id || undefined, body: target.body, baseUpdatedAt: target.base || undefined })
      if (!res.ok || !res.value) {
        dirty.current = true
        setStatus('Not saved: ' + (res.message || 'unknown error'))
        return
      }
      const note = res.value
      if (wasId && note.id !== wasId) {
        // Another Device saved this note while we edited it: our text is now a conflict copy.
        Object.assign(target, { id: note.id, body: note.body, title: note.title, openedTitle: note.title, conflictOf: wasId })
        if (draft.current === target) {
          send({ type: 'setText', body: note.body })
          send({ type: 'setId', id: note.id })
          setBanner('This note changed on another device while you edited it. Your version is saved as a copy.')
        }
      } else if (!wasId) {
        Object.assign(target, { id: note.id, openedTitle: note.title })
        if (draft.current === target) send({ type: 'setId', id: note.id })
      }
      target.base = note.updatedAt
      const list = [note, ...notesRef.current.filter((n) => n.id !== note.id)]
      keepNotes(list)
      send({ type: 'notes', notes: list })
      setStatus('Saved')
    })()
    saving.current = run
    await run
    saving.current = null
  }, [call, send])

  // Save, then let go of the open note. An emptied note is deleted rather than kept blank; a note
  // whose title changed gets the links to it updated (like a rename in Obsidian).
  const leave = useCallback(async () => {
    const target = draft.current
    await save()
    if (!target || !target.id || !writable) return
    if (!target.body.trim()) {
      const res = await call('notes', 'delete', { id: target.id })
      if (res.ok) keepNotes(notesRef.current.filter((n) => n.id !== target.id))
      return
    }
    if (target.openedTitle && target.title && target.title !== target.openedTitle) {
      const res = await call<number>('notes', 'renameLinks', { id: target.id, from: target.openedTitle, to: target.title })
      if (res.ok && res.value) await load()
    }
  }, [call, save, writable, load])

  const openEditor = (note: Note | null, { body = '', heading = '' } = {}) => {
    draft.current = note
      ? { id: note.id, body: note.body, title: note.title, base: note.updatedAt, openedTitle: note.title, conflictOf: note.conflictOf || null }
      : { id: null, body, title: '', base: null, openedTitle: null, conflictOf: null }
    dirty.current = !note && !!body
    pendingHeading.current = heading
    setStatus('')
    setBanner(null)
    if (ready.current) showDraft(!note)
    else setEditorOpen(true) // the page loads, says 'ready', and then gets the note
    if (dirty.current) save()
  }

  const closeEditor = useCallback(async () => {
    await leave()
    draft.current = null
    ready.current = false
    setEditorOpen(false)
    load()
  }, [leave, load])

  // Follow a [[link]] from the editor: to another note, or to a new one with that title.
  const openLinked = async (id: string, heading: string) => {
    await leave()
    const note = notesRef.current.find((n) => n.id === id)
    if (note) openEditor(note, { heading })
  }

  const createLinked = async (title: string) => {
    await leave()
    if (writable) openEditor(null, { body: `# ${title}\n\n` })
  }

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: any
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    const d = draft.current
    if (msg.type === 'ready') {
      ready.current = true
      showDraft(!d?.id)
    } else if (msg.type === 'change' && d) {
      d.body = msg.body
      d.title = msg.title
      dirty.current = true
      setStatus('')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(save, SAVE_DELAY)
    } else if (msg.type === 'openNote') {
      openLinked(msg.id, msg.heading || '')
    } else if (msg.type === 'createNote') {
      createLinked(msg.title)
    } else if (msg.type === 'openUrl') {
      closeEditor().then(() => onOpenUrl(msg.href))
    }
  }

  const deleteNote = () => {
    const target = draft.current
    if (!target) return
    if (!target.id) { draft.current = null; ready.current = false; setEditorOpen(false); return }
    Alert.alert('Delete this note?', 'It is removed from all your linked devices.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (timer.current) clearTimeout(timer.current)
          if (saving.current) await saving.current
          dirty.current = false
          const res = await call('notes', 'delete', { id: target.id })
          if (!res.ok) return Alert.alert('Couldn’t delete', res.message || 'Unknown error')
          keepNotes(notesRef.current.filter((n) => n.id !== target.id))
          draft.current = null
          ready.current = false
          setEditorOpen(false)
        }
      }
    ])
  }

  const closeAll = useCallback(async () => {
    if (editorOpen) await closeEditor()
    onClose()
  }, [editorOpen, closeEditor, onClose])

  const q = query.trim().toLowerCase()
  const shown = (notes || []).filter((n) => !q || n.body.toLowerCase().includes(q))
  const conflictOf = draft.current?.conflictOf
  const original = conflictOf ? notesRef.current.find((n) => n.id === conflictOf) : null

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={editorOpen ? closeEditor : onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {editorOpen ? (
          <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.header}>
              <TouchableOpacity onPress={closeEditor} hitSlop={10} style={s.back}>
                <Text style={s.backText}>‹ Notes</Text>
              </TouchableOpacity>
              <Text numberOfLines={1} style={s.status}>{writable ? status : 'Read only for now'}</Text>
              <TouchableOpacity onPress={deleteNote} hitSlop={10} style={s.back} disabled={!writable}>
                <Text style={[s.deleteText, !writable && { color: t.textMuted }]}>Delete</Text>
              </TouchableOpacity>
            </View>
            {(banner || conflictOf) && (
              <View style={s.banner}>
                <Text style={s.bannerText}>
                  {banner || 'This is a conflict copy, made when two devices edited the same note at once.'} Merge what you need, then delete the copy.
                </Text>
                {original && (
                  <TouchableOpacity onPress={() => openLinked(original.id, '')} hitSlop={8}>
                    <Text style={s.bannerAction}>Open original</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tools} contentContainerStyle={s.toolsContent} keyboardShouldPersistTaps='always'>
              {TOOLS.map(([cmd, label]) => (
                <TouchableOpacity key={cmd} style={s.tool} disabled={!writable} onPress={() => send({ type: 'command', name: cmd })}>
                  <Text style={[s.toolText, cmd === 'bold' && s.bold, cmd === 'italic' && s.italic, cmd === 'strike' && s.strike, !writable && { color: t.textMuted }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <WebView
              ref={web}
              style={s.web}
              originWhitelist={['*']}
              source={{ html: editorHtml }}
              onMessage={onMessage}
              keyboardDisplayRequiresUserAction={false}
              hideKeyboardAccessoryView
              setSupportMultipleWindows={false}
              // Links are handled in onMessage, so never let the page itself go to a site. (The page
              // loads as about:blank or a data: URL depending on the platform; those must pass.)
              onShouldStartLoadWithRequest={(req) => !/^(https?|hyper):/i.test(req.url)}
            />
          </KeyboardAvoidingView>
        ) : (
          <>
            <View style={s.header}>
              <Text style={s.title}>Notes</Text>
              <TouchableOpacity onPress={closeAll} hitSlop={10} style={s.close}>
                <Text style={s.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            {noVault ? (
              <LinkPhone what='Notes' onOpenDevices={onOpenDevices} />
            ) : error ? (
              <View style={s.page}><Text style={s.errText}>{error}</Text></View>
            ) : !notes ? (
              <View style={s.center}><ActivityIndicator color={t.accent} /></View>
            ) : (
              <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps='handled'>
                <View style={s.toolRow}>
                  <TextInput
                    style={s.search}
                    value={query}
                    onChangeText={setQuery}
                    placeholder='Search notes'
                    placeholderTextColor={t.textMuted}
                    autoCorrect={false}
                    clearButtonMode='while-editing'
                  />
                  <TouchableOpacity style={[s.newBtn, !writable && s.newBtnOff]} onPress={() => openEditor(null)} disabled={!writable}>
                    <Text style={s.newBtnText}>New</Text>
                  </TouchableOpacity>
                </View>
                {!writable && (
                  <Text style={s.hint}>This phone can’t save changes to your Vault yet. Keep your other device online until it syncs.</Text>
                )}
                {shown.length === 0 ? (
                  <Text style={s.empty}>{q ? 'No notes match.' : 'No notes yet. Tap New to write one. It shows on your computer too.'}</Text>
                ) : (
                  <View style={s.card}>
                    {shown.map((n, i) => (
                      <TouchableOpacity key={n.id} style={[s.row, i > 0 && s.rowDivider]} activeOpacity={0.7} onPress={() => openEditor(n)}>
                        <Text numberOfLines={1} style={s.rowTitle}>{n.title}</Text>
                        <Text numberOfLines={1} style={s.rowSub}>
                          <Text style={s.rowDate}>{relativeDate(n.updatedAt)}</Text>
                          {n.snippet ? `  ${n.snippet}` : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function relativeDate (iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday'
  return d.toLocaleDateString(undefined, d.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52, gap: 8 },
    title: { color: t.text, fontSize: 20, fontWeight: '700' },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: t.textDim, fontSize: 18 },
    back: { minWidth: 64, height: 40, justifyContent: 'center' },
    backText: { color: t.accent, fontSize: 15, fontWeight: '600' },
    deleteText: { color: t.danger, fontSize: 15, fontWeight: '600', textAlign: 'right' },
    status: { flex: 1, color: t.textMuted, fontSize: 12, textAlign: 'center' },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: radius.md, backgroundColor: t.surfaceAlt },
    bannerText: { flex: 1, color: t.text, fontSize: 13, lineHeight: 18 },
    bannerAction: { color: t.accent, fontSize: 13, fontWeight: '600' },
    tools: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border, backgroundColor: t.surface },
    toolsContent: { paddingHorizontal: 6, alignItems: 'center' },
    tool: { minWidth: 40, height: 40, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
    toolText: { color: t.textDim, fontSize: 15, fontWeight: '600' },
    bold: { fontWeight: '800' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    web: { flex: 1, backgroundColor: t.surface },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    page: { padding: 16 },
    toolRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    search: { flex: 1, height: 42, color: t.text, fontSize: 14, backgroundColor: t.inputBg, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: 10 },
    newBtn: { backgroundColor: t.accent, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 11 },
    newBtnOff: { opacity: 0.4 },
    newBtnText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
    errText: { color: t.danger, fontSize: 14, textAlign: 'center', marginTop: 30 },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 19 },
    card: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    row: { paddingHorizontal: 14, paddingVertical: 11, minHeight: 56, justifyContent: 'center' },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    rowTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
    rowSub: { color: t.textMuted, fontSize: 13, marginTop: 2 },
    rowDate: { color: t.textDim }
  })
}
