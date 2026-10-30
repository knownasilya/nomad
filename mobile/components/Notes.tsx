import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { Backend, Note } from '../lib/useBackend'
import editorHtml from '../lib/noteEditorHtml'
import LinkPhone from './LinkPhone'
import ScreenHeader from './ScreenHeader'
import IconButton from './IconButton'
import Icon from './Icon'
import { ListSection } from './List'

const SAVE_DELAY = 800

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space?: string // the active Space's Root Drive key: a Space can keep notes of its own (ADR-0029)
  spaceName?: string
  onOpenDevices: () => void
  // A link to a page; noteId is the note it was in, which openNoteId gets back when back returns here.
  onOpenUrl: (url: string, noteId?: string) => void
  openNoteId?: string // a note to open as Notes shows
}

// The note in the editor. One object per open note, changed in place, so a save that finishes after
// more typing still gives the new note its id. base: the updatedAt of the version it started from.
// inSpace: the note is kept only in the active Space.
interface Draft { id: string | null; body: string; title: string; base: string | null; openedTitle: string | null; conflictOf: string | null; inSpace: boolean }

// The editor's formatting buttons: [command in app/userland/notes/js/editor/commands.js, label].
const TOOLS: [string, string][] = [['heading', 'H'], ['bold', 'B'], ['italic', 'I'], ['strike', 'S'], ['bullet', '•'], ['task', '☑'], ['quote', '❝'], ['code', '</>'], ['link', '[[ ]]']]

// The phone's Notes (ADR-0017): the same Markdown notes as desktop's nomad://notes, kept in the Vault,
// edited the same way: Obsidian-style Live Preview, [[ links between notes, and linked mentions. The
// editor is desktop's, bundled into a page (lib/noteEditorHtml.ts, from app/userland/notes/js/mobile.js)
// and run in a WebView. Edits save a moment after typing stops. An edit that crosses another Device's
// becomes a conflict copy. A new note left empty is never stored; an emptied one is deleted when you
// leave it. Retitling a note updates the links to it. Another Device's edits show while this is open.
// Back from a note reached by a [[link]] returns to the note the link was in, then to the list.
// A note is the user's, shown in every Space, or kept only in the active Space (ADR-0029): the list
// shows the Space's first, and the pin in the editor moves a note between the two.
export default function Notes ({ visible, onClose, apps, onVaultChange, space, spaceName, onOpenDevices, onOpenUrl, openNoteId }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const insets = useSafeAreaInsets()
  // backend.apps is a new function on every parent render. Calling through a ref keeps the effects
  // below from re-running (and reloading) on each one. Every call names the active Space, and a new
  // Space reloads the list.
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args = {}) => appsRef.current(app, action, { space, ...args })) as Backend['apps'], [space])

  const [notes, setNotes] = useState<Note[] | null>(null)
  const [writable, setWritable] = useState(true)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [banner, setBanner] = useState<string | null>(null)
  const [listLoaded, setListLoaded] = useState(false) // since Notes last opened
  const [inSpace, setInSpace] = useState(false) // the open note's place, for the pin
  // A shared Space (ADR-0029): its Notes are its members'. canWriteSpace is false for a viewer.
  const [shared, setShared] = useState(false)
  const [canWriteSpace, setCanWriteSpace] = useState(true)
  // The open note can be changed: the Vault writes, and a Space note needs the Space to, too.
  const editable = writable && (!inSpace || canWriteSpace)

  const notesRef = useRef<Note[]>([])
  const draft = useRef<Draft | null>(null)
  const dirty = useRef(false)
  const saving = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const web = useRef<WebView>(null)
  const ready = useRef(false)
  const pendingHeading = useRef('')
  // The notes [[links]] were followed from to reach the open one, oldest first: back walks them.
  const trail = useRef<string[]>([])

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
    const res = await call<{ notes: Note[]; writable: boolean; shared?: boolean; canWriteSpace?: boolean }>('notes', 'list')
    if (res.noVault) { setNoVault(true); setNotes(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load your notes'); return }
    keepNotes(res.value.notes)
    setWritable(res.value.writable)
    setShared(!!res.value.shared)
    setCanWriteSpace(res.value.canWriteSpace !== false)
    setListLoaded(true)
    if (ready.current) send({ type: 'notes', notes: res.value.notes })
  }, [call, send])

  useEffect(() => { if (visible) load(); else setListLoaded(false) }, [visible, load])

  // Another Device added, edited or deleted a note (our own saves land here too, and change
  // nothing). The open note takes the new text unless there are edits here not saved yet: those
  // win, and saving them makes a conflict copy if the note changed (planNoteSave).
  useEffect(() => {
    if (!visible) return
    return onVaultChange(async () => {
      await load()
      const d = draft.current
      if (!d || !d.id || dirty.current || saving.current) return
      const fresh = notesRef.current.find((n) => n.id === d.id)
      if (!fresh) {
        // Deleted on another Device.
        trail.current = []
        draft.current = null
        ready.current = false
        setEditorOpen(false)
      } else if (fresh.updatedAt !== d.base) {
        Object.assign(d, { body: fresh.body, title: fresh.title, base: fresh.updatedAt, openedTitle: fresh.title })
        send({ type: 'setText', body: fresh.body })
      }
    })
  }, [visible, onVaultChange, load, send])

  const showDraft = useCallback((focus: boolean) => {
    const d = draft.current
    if (!d) return
    send({ type: 'load', theme: t, id: d.id, body: d.body, notes: notesRef.current, readOnly: !writable || (d.inSpace && !canWriteSpace), focus, heading: pendingHeading.current })
    pendingHeading.current = ''
  }, [send, t, writable, canWriteSpace])

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
      const res = await call<Note>('notes', 'save', { id: target.id || undefined, body: target.body, baseUpdatedAt: target.base || undefined, inSpace: target.inSpace })
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
      ? { id: note.id, body: note.body, title: note.title, base: note.updatedAt, openedTitle: note.title, conflictOf: note.conflictOf || null, inSpace: !!note.space }
      : { id: null, body, title: '', base: null, openedTitle: null, conflictOf: null, inSpace: !!space && shared && canWriteSpace }
    setInSpace(draft.current.inSpace)
    dirty.current = !note && !!body
    pendingHeading.current = heading
    setStatus('')
    setBanner(null)
    if (ready.current) showDraft(!note)
    else setEditorOpen(true) // the page loads, says 'ready', and then gets the note
    if (dirty.current) save()
  }

  // A note opened from the list (or the New note button) starts a new trail.
  const openFromList = (note: Note | null) => {
    trail.current = []
    openEditor(note)
  }

  const showList = useCallback(() => {
    draft.current = null
    ready.current = false
    setEditorOpen(false)
    load()
  }, [load])

  const closeEditor = useCallback(async () => {
    await leave()
    showList()
  }, [leave, showList])

  // Back from the editor: to the note the [[link]] was followed from, else to the list.
  const backFromEditor = async () => {
    while (trail.current.length && !notesRef.current.some((n) => n.id === trail.current[trail.current.length - 1])) trail.current.pop()
    const id = trail.current.pop()
    if (!id) return closeEditor()
    await leave()
    // Found again after leave(), which can rewrite links in it when the open note was retitled.
    const note = notesRef.current.find((n) => n.id === id)
    if (note) openEditor(note)
    else showList()
  }

  // Follow a [[link]] from the editor: to another note, or to a new one with that title. The note
  // it was in goes on the trail, so back returns to it.
  const openLinked = async (id: string, heading: string) => {
    const from = draft.current?.id
    await leave()
    const note = notesRef.current.find((n) => n.id === id)
    if (!note) return
    if (from && from !== id) trail.current.push(from)
    openEditor(note, { heading })
  }

  const createLinked = async (title: string) => {
    const from = draft.current?.id
    await leave()
    if (!writable) return
    if (from) trail.current.push(from)
    openEditor(null, { body: `# ${title}\n\n` })
  }

  // Open the note Notes was asked for, once each time it opens, after the list has loaded.
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!visible) { openedFor.current = null; return }
    if (!openNoteId || !listLoaded || openedFor.current === openNoteId) return
    openedFor.current = openNoteId
    const note = notesRef.current.find((n) => n.id === openNoteId)
    if (note && !draft.current) openEditor(note)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openNoteId, listLoaded])

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
      // The note's id is read after closing: a new note gets one when that saves it.
      const from = draft.current
      closeEditor().then(() => onOpenUrl(msg.href, from?.id || undefined))
    }
  }

  // The pin: keep the open note only in this Space, or show it in every Space. A note not saved yet
  // is saved there when it first is.
  const toggleScope = async () => {
    const target = draft.current
    if (!target || !space) return
    const next = !target.inSpace
    if (!target.id) { target.inSpace = next; setInSpace(next); return }
    await save()
    const res = await call<Note>('notes', 'move', { id: target.id, inSpace: next })
    if (!res.ok || !res.value) return Alert.alert('Couldn’t move the note', res.message || 'Unknown error')
    const note = res.value
    target.inSpace = !!note.space
    setInSpace(target.inSpace)
    keepNotes(notesRef.current.map((n) => (n.id === note.id ? { ...n, space: note.space } : n)))
    setStatus(note.space ? (shared ? `Shared in ${spaceName || 'this Space'}` : `Only in ${spaceName || 'this Space'}`) : shared ? 'Only yours' : 'In every Space')
  }

  const deleteNote = () => {
    const target = draft.current
    if (!target) return
    if (!target.id) { trail.current = []; draft.current = null; ready.current = false; setEditorOpen(false); return }
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
          trail.current = []
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
  // The Space's own notes first, under its name, when it has any.
  const sections: { title: string | null; notes: Note[] }[] =
    space && shown.some((n) => n.space)
      ? [
          { title: shared ? `Shared in ${spaceName || 'this Space'}` : `Only in ${spaceName || 'this Space'}`, notes: shown.filter((n) => n.space) },
          { title: shared ? 'Only yours' : 'All Spaces', notes: shown.filter((n) => !n.space) }
        ].filter((sec) => sec.notes.length)
      : [{ title: null, notes: shown }]
  const conflictOf = draft.current?.conflictOf
  const original = conflictOf ? notesRef.current.find((n) => n.id === conflictOf) : null

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={editorOpen ? backFromEditor : onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {editorOpen ? (
          <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.header}>
              <IconButton icon='arrow-left' label='Back' onPress={backFromEditor} color={t.text} />
              <Text numberOfLines={1} style={s.status}>{editable ? status : writable ? 'You can view this Space’s notes' : 'Read only for now'}</Text>
              {space ? (
                shared ? (
                  <IconButton
                    icon={inSpace ? 'user-friends' : 'lock'}
                    label={inSpace ? `Shared in ${spaceName || 'this Space'}. Keep it to yourself` : `Only yours. Share it in ${spaceName || 'this Space'}`}
                    onPress={toggleScope}
                    disabled={!writable || !canWriteSpace}
                    active={inSpace}
                    size={17}
                  />
                ) : (
                  <IconButton
                    icon={inSpace ? 'thumbtack' : 'globe'}
                    label={inSpace ? `Only in ${spaceName || 'this Space'}. Show it in every Space` : `In every Space. Keep it only in ${spaceName || 'this Space'}`}
                    onPress={toggleScope}
                    disabled={!writable}
                    active={inSpace}
                    size={17}
                  />
                )
              ) : null}
              <IconButton icon='trash-alt' label='Delete note' onPress={deleteNote} disabled={!editable} color={t.danger} />
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
                <TouchableOpacity key={cmd} style={s.tool} disabled={!editable} onPress={() => send({ type: 'command', name: cmd })}>
                  <Text style={[s.toolText, cmd === 'bold' && s.bold, cmd === 'italic' && s.italic, cmd === 'strike' && s.strike, !editable && { color: t.textMuted }]}>{label}</Text>
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
            <ScreenHeader title='Notes' onBack={closeAll} />

            {noVault ? (
              <LinkPhone what='Notes' onOpenDevices={onOpenDevices} />
            ) : error ? (
              <View style={s.page}><Text style={s.errText}>{error}</Text></View>
            ) : !notes ? (
              <View style={s.center}><ActivityIndicator color={t.accent} /></View>
            ) : (
              <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps='handled'>
                <View style={s.toolRow}>
                  <Icon name='search' size={14} color={t.textMuted} />
                  <TextInput
                    style={s.search}
                    value={query}
                    onChangeText={setQuery}
                    placeholder='Search notes'
                    placeholderTextColor={t.textMuted}
                    autoCorrect={false}
                    clearButtonMode='while-editing'
                  />
                </View>
                {!writable && (
                  <Text style={s.hint}>This phone can’t save changes to your Vault yet. Keep your other device online until it syncs.</Text>
                )}
                {shown.length === 0 ? (
                  <Text style={s.empty}>{q ? 'No notes match.' : 'No notes yet. Tap New note to write one. It shows on your computer too.'}</Text>
                ) : (
                  sections.map((sec) => (
                    <ListSection key={sec.title || 'all'} title={sec.title || undefined}>
                        {sec.notes.map((n, i) => (
                          <Pressable key={n.id} style={[s.row, i > 0 && s.rowDivider]} android_ripple={{ color: t.ripple }} onPress={() => openFromList(n)}>
                            <Text numberOfLines={1} style={s.rowTitle}>{n.title}</Text>
                            <Text numberOfLines={1} style={s.rowSub}>
                              <Text style={s.rowDate}>{relativeDate(n.updatedAt)}</Text>
                              {n.snippet ? `  ${n.snippet}` : ''}
                            </Text>
                          </Pressable>
                        ))}
                    </ListSection>
                  ))
                )}
              </ScrollView>
            )}
            {/* Material's extended floating action button: the one thing this page is for. */}
            {notes && !noVault && !error ? (
              <Pressable
                // Absolute, so the SafeAreaView's padding doesn't lift it: add the inset itself.
                style={[s.fab, { bottom: 16 + insets.bottom }, !writable && s.fabOff]}
                onPress={() => openFromList(null)}
                disabled={!writable}
                android_ripple={{ color: t.ripple }}
                accessibilityRole='button'
              >
                <Icon name='pen' size={15} color={t.onAccent} />
                <Text style={s.fabText}>New note</Text>
              </Pressable>
            ) : null}
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, height: 56, gap: 8 },
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
    page: { padding: 16, paddingBottom: 96 },
    toolRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 16,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.border
    },
    search: { flex: 1, color: t.text, fontSize: 15, padding: 0 },
    fab: {
      position: 'absolute',
      right: 16,
      bottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 56,
      paddingHorizontal: 20,
      borderRadius: radius.lg + 2,
      backgroundColor: t.accent,
      overflow: 'hidden',
      elevation: 4,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 }
    },
    fabOff: { opacity: 0.4 },
    fabText: { color: t.onAccent, fontSize: 15, fontWeight: '600' },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
    errText: { color: t.danger, fontSize: 14, textAlign: 'center', marginTop: 30 },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 19 },
    card: { backgroundColor: t.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    row: { paddingHorizontal: 16, paddingVertical: 12, minHeight: 64, justifyContent: 'center' },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    rowTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
    rowSub: { color: t.textMuted, fontSize: 13, marginTop: 2 },
    rowDate: { color: t.textDim }
  })
}
