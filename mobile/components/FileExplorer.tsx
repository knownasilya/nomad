import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StyleSheet
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import b4a from 'b4a'
import { useTheme, radius, type Theme } from '../lib/theme'
import { type DriveType } from '../lib/hyperUrl'
import type { DirEntry } from '../lib/types'
import type { Backend } from '../lib/useBackend'

// The drive an explorer session targets. Always one you own (it carries `ns`),
// so every op below opens it writable in the backend.
export interface ExplorerDrive {
  url: string
  key: string // drive key hex
  name: string
  type: DriveType
  ns: string
}

interface Props {
  visible: boolean
  drive: ExplorerDrive | null
  backend: Backend
  onClose: () => void
}

// Files whose extension (or text-ish mime) we'll open in the editor; everything
// else is treated as binary and shown read-only.
const TEXT_EXT =
  /\.(txt|md|markdown|html?|css|js|mjs|cjs|jsx|ts|tsx|json|jsonc|xml|svg|csv|tsv|yml|yaml|toml|ini|conf|sh|bash|zsh|py|rb|go|rs|c|h|cc|cpp|hpp|java|kt|swift|php|sql|log|map|gitignore|env)$/i

function isEditable (mime: string | undefined, path: string): boolean {
  if (mime && (mime.startsWith('text/') || /(json|javascript|ecmascript|xml|svg|x-sh|yaml|toml)/.test(mime))) return true
  if (TEXT_EXT.test(path)) return true
  // Extensionless files (README, LICENSE, Dockerfile) are usually text.
  if (/\/[^/.]+$/.test(path)) return true
  return false
}

// Folder placeholder the backend writes for empty dirs — hidden from the UI.
const PLACEHOLDER = '.keep'

const ensureSlash = (p: string) => (p.endsWith('/') ? p : p + '/')
const joinPath = (folder: string, name: string) => ensureSlash(folder) + name
function parentOf (folder: string): string {
  const f = folder.replace(/\/+$/, '')
  if (!f) return '/'
  const i = f.lastIndexOf('/')
  return i <= 0 ? '/' : f.slice(0, i) + '/'
}

type EditorState = {
  path: string
  name: string
  mime: string
  editable: boolean
  text: string
  bytes: number
  dirty: boolean
  loading: boolean
  saving: boolean
}

type PromptState = {
  title: string
  placeholder: string
  value: string
  cta: string
  onSubmit: (value: string) => void
}

// A file manager for a drive you own: navigate folders, edit text source, and
// add / rename / delete files and folders. Mobile adaptation of nomad's editor
// file tree (app/userland/editor): a navigable screen rather than a sidebar.
export default function FileExplorer ({ visible, drive, backend, onClose }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])

  const [cwd, setCwd] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [writable, setWritable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [actionFor, setActionFor] = useState<DirEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const driveKey = drive?.key
  const driveType = drive?.type
  const ns = drive?.ns

  const load = useCallback(
    async (path: string) => {
      if (!drive) return
      setLoading(true)
      setError(null)
      const res = await backend.fsList(drive.type, drive.key, drive.ns, path)
      if (!res.ok) {
        setError(res.message || 'Could not read this folder')
        setEntries([])
      } else {
        setEntries((res.entries || []).filter((e) => e.name !== PLACEHOLDER))
        setWritable(!!res.writable)
      }
      setLoading(false)
    },
    [backend, drive]
  )

  // Reset to the root and clear transient UI whenever a new drive opens.
  useEffect(() => {
    if (!visible || !driveKey) return
    setCwd('/')
    setEditor(null)
    setPrompt(null)
    setActionFor(null)
  }, [visible, driveKey])

  // (Re)list whenever the current folder changes.
  useEffect(() => {
    if (!visible || !driveKey) return
    load(cwd)
  }, [visible, driveKey, cwd, load])

  const refresh = useCallback(() => load(cwd), [load, cwd])

  // --- file open / edit ---------------------------------------------------
  const openFile = useCallback(
    async (entry: DirEntry) => {
      if (!drive) return
      const editable = isEditable(undefined, entry.path)
      setEditor({ path: entry.path, name: entry.name, mime: '', editable, text: '', bytes: 0, dirty: false, loading: true, saving: false })
      const res = await backend.fsRead(drive.type, drive.key, drive.ns, entry.path)
      if (!res.ok) {
        setEditor(null)
        Alert.alert('Could not open file', res.message || 'Unknown error')
        return
      }
      const b64 = res.base64 || ''
      const buf = b4a.from(b64, 'base64')
      const reallyEditable = isEditable(res.mime, entry.path)
      setEditor({
        path: entry.path,
        name: entry.name,
        mime: res.mime || '',
        editable: reallyEditable,
        text: reallyEditable ? b4a.toString(buf) : '',
        bytes: buf.length,
        dirty: false,
        loading: false,
        saving: false
      })
    },
    [backend, drive]
  )

  const writeEditor = useCallback(async () => {
    if (!drive || !editor) return
    setEditor((e) => (e ? { ...e, saving: true } : e))
    const base64 = b4a.toString(b4a.from(editor.text), 'base64')
    const res = await backend.fsWrite(drive.type, drive.key, drive.ns, editor.path, base64)
    if (!res.ok) {
      setEditor((e) => (e ? { ...e, saving: false } : e))
      Alert.alert('Save failed', res.message || 'Unknown error')
      return
    }
    setEditor((e) => (e ? { ...e, saving: false, dirty: false } : e))
  }, [backend, drive, editor])

  // Guard JSON files before writing. /index.json is the drive manifest (the
  // nomad.dev schema): saving broken JSON there can make the drive unreadable,
  // so confirm before overwriting with anything that won't parse.
  const saveFile = useCallback(() => {
    if (!drive || !editor || !editor.editable) return
    if (/\.json$/i.test(editor.path)) {
      try {
        JSON.parse(editor.text)
      } catch {
        Alert.alert(
          'Invalid JSON',
          editor.name === 'index.json'
            ? 'This is the drive manifest. Saving invalid JSON may make the drive unreadable.'
            : `${editor.name} isn’t valid JSON.`,
          [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Save anyway', style: 'destructive', onPress: () => { writeEditor() } }
          ]
        )
        return
      }
    }
    writeEditor()
  }, [drive, editor, writeEditor])

  const closeEditor = useCallback(() => {
    if (editor?.dirty) {
      Alert.alert('Discard changes?', `${editor.name} has unsaved changes.`, [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { setEditor(null); refresh() } }
      ])
      return
    }
    setEditor(null)
    refresh()
  }, [editor, refresh])

  // --- create / rename / delete ------------------------------------------
  const promptNewFile = useCallback(() => {
    setPrompt({
      title: 'New file',
      placeholder: 'name.txt',
      value: '',
      cta: 'Create',
      onSubmit: async (raw) => {
        const name = raw.trim()
        if (!name || !drive) return
        setBusy(true)
        const path = joinPath(cwd, name)
        const res = await backend.fsWrite(drive.type, drive.key, drive.ns, path, '')
        setBusy(false)
        if (!res.ok) return Alert.alert('Could not create file', res.message || 'Unknown error')
        await refresh()
        openFile({ name, path, isDir: false })
      }
    })
  }, [backend, drive, cwd, refresh, openFile])

  const promptNewFolder = useCallback(() => {
    setPrompt({
      title: 'New folder',
      placeholder: 'folder',
      value: '',
      cta: 'Create',
      onSubmit: async (raw) => {
        const name = raw.trim().replace(/\/+$/, '')
        if (!name || !drive) return
        setBusy(true)
        const res = await backend.fsMkdir(drive.type, drive.key, drive.ns, joinPath(cwd, name))
        setBusy(false)
        if (!res.ok) return Alert.alert('Could not create folder', res.message || 'Unknown error')
        refresh()
      }
    })
  }, [backend, drive, cwd, refresh])

  const promptRename = useCallback(
    (entry: DirEntry) => {
      setActionFor(null)
      setPrompt({
        title: `Rename ${entry.isDir ? 'folder' : 'file'}`,
        placeholder: 'new name',
        value: entry.name,
        cta: 'Rename',
        onSubmit: async (raw) => {
          const name = raw.trim().replace(/\/+$/, '')
          if (!name || name === entry.name || !drive) return
          setBusy(true)
          const from = entry.isDir ? ensureSlash(entry.path) : entry.path
          const to = entry.isDir ? ensureSlash(joinPath(cwd, name)) : joinPath(cwd, name)
          const res = await backend.fsRename(drive.type, drive.key, drive.ns, from, to, entry.isDir)
          setBusy(false)
          if (!res.ok) return Alert.alert('Rename failed', res.message || 'Unknown error')
          // If the open file was the one renamed, follow it.
          if (editor && !entry.isDir && editor.path === entry.path) {
            setEditor((e) => (e ? { ...e, path: joinPath(cwd, name), name } : e))
          }
          refresh()
        }
      })
    },
    [backend, drive, cwd, editor, refresh]
  )

  const confirmDelete = useCallback(
    (entry: DirEntry) => {
      setActionFor(null)
      Alert.alert(
        `Delete ${entry.name}?`,
        entry.isDir ? 'This removes the folder and everything inside it.' : 'This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (!drive) return
              setBusy(true)
              const path = entry.isDir ? ensureSlash(entry.path) : entry.path
              const res = await backend.fsDelete(drive.type, drive.key, drive.ns, path, entry.isDir)
              setBusy(false)
              if (!res.ok) return Alert.alert('Delete failed', res.message || 'Unknown error')
              if (editor && !entry.isDir && editor.path === entry.path) setEditor(null)
              refresh()
            }
          }
        ]
      )
    },
    [backend, drive, editor, refresh]
  )

  // --- breadcrumb ---------------------------------------------------------
  const crumbs = useMemo(() => {
    const segs = cwd.split('/').filter(Boolean)
    const out = [{ label: drive?.name || 'Root', path: '/' }]
    let acc = ''
    for (const seg of segs) {
      acc += '/' + seg
      out.push({ label: seg, path: acc + '/' })
    }
    return out
  }, [cwd, drive?.name])

  if (!drive) return null

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={editor ? closeEditor : onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        {editor ? (
          <EditorScreen
            s={s}
            t={t}
            editor={editor}
            writable={writable}
            onBack={closeEditor}
            onChange={(text) => setEditor((e) => (e ? { ...e, text, dirty: true } : e))}
            onSave={saveFile}
          />
        ) : (
          <>
            <View style={s.header}>
              <View style={s.headerText}>
                <Text numberOfLines={1} style={s.title}>{drive.name}</Text>
                <Text style={s.subtitle}>
                  {drive.type === 'autobase' ? 'Collaborative' : 'Hyperdrive'}
                  {writable ? '' : '  ·  read-only'}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={10} style={s.close}>
                <Text style={s.closeText}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.crumbBar} contentContainerStyle={s.crumbContent}>
              {crumbs.map((c, i) => (
                <View key={c.path} style={s.crumbWrap}>
                  {i > 0 && <Text style={s.crumbSep}>/</Text>}
                  <TouchableOpacity onPress={() => setCwd(c.path)} disabled={c.path === cwd} hitSlop={6}>
                    <Text numberOfLines={1} style={[s.crumb, c.path === cwd && s.crumbActive]}>{c.label}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            {writable && (
              <View style={s.toolbar}>
                <TouchableOpacity style={s.toolBtn} onPress={promptNewFile} disabled={busy}>
                  <Text style={s.toolBtnText}>+ File</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.toolBtn} onPress={promptNewFolder} disabled={busy}>
                  <Text style={s.toolBtnText}>+ Folder</Text>
                </TouchableOpacity>
              </View>
            )}

            {loading ? (
              <View style={s.center}><ActivityIndicator color={t.accent} /></View>
            ) : error ? (
              <View style={s.center}><Text style={s.errText}>{error}</Text></View>
            ) : (
              <FlatList
                data={entries}
                keyExtractor={(e) => e.path}
                ListHeaderComponent={
                  cwd !== '/' ? (
                    <TouchableOpacity style={s.entry} onPress={() => setCwd(parentOf(cwd))} activeOpacity={0.7}>
                      <Text style={[s.entryIcon, { color: t.accent }]}>↰</Text>
                      <Text style={s.entryName}>..</Text>
                    </TouchableOpacity>
                  ) : null
                }
                ListEmptyComponent={<Text style={s.empty}>Empty folder</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.entry}
                    activeOpacity={0.7}
                    onPress={() => (item.isDir ? setCwd(ensureSlash(item.path)) : openFile(item))}
                    onLongPress={() => writable && setActionFor(item)}
                  >
                    <Text style={[s.entryIcon, { color: item.isDir ? t.accent : t.textMuted }]}>{item.isDir ? '▸' : '·'}</Text>
                    <Text numberOfLines={1} style={s.entryName}>{item.name}{item.isDir ? '/' : ''}</Text>
                    {writable && (
                      <TouchableOpacity hitSlop={10} onPress={() => setActionFor(item)} style={s.entryMore}>
                        <Text style={s.entryMoreText}>⋯</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </>
        )}

        {/* row action sheet */}
        {actionFor && (
          <Overlay onDismiss={() => setActionFor(null)} s={s}>
            <Text numberOfLines={1} style={s.sheetTitle}>{actionFor.name}{actionFor.isDir ? '/' : ''}</Text>
            <TouchableOpacity style={s.sheetItem} onPress={() => promptRename(actionFor)}>
              <Text style={s.sheetItemText}>Rename</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.sheetItem} onPress={() => confirmDelete(actionFor)}>
              <Text style={[s.sheetItemText, { color: t.danger }]}>Delete</Text>
            </TouchableOpacity>
          </Overlay>
        )}

        {/* text-input prompt (new / rename) */}
        {prompt && (
          <Overlay onDismiss={() => setPrompt(null)} s={s}>
            <PromptBody key={prompt.title + prompt.value} s={s} t={t} prompt={prompt} onDone={() => setPrompt(null)} />
          </Overlay>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function EditorScreen ({
  s,
  t,
  editor,
  writable,
  onBack,
  onChange,
  onSave
}: {
  s: Styles
  t: Theme
  editor: EditorState
  writable: boolean
  onBack: () => void
  onChange: (text: string) => void
  onSave: () => void
}) {
  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={s.close}>
          <Text style={s.closeText}>‹ Files</Text>
        </TouchableOpacity>
        <View style={[s.headerText, { alignItems: 'center' }]}>
          <Text numberOfLines={1} style={s.title}>{editor.name}{editor.dirty ? ' •' : ''}</Text>
        </View>
        {writable && editor.editable ? (
          <TouchableOpacity onPress={onSave} hitSlop={10} style={s.close} disabled={editor.saving || !editor.dirty}>
            <Text style={[s.closeText, { color: editor.dirty ? t.accent : t.textMuted, fontWeight: '700' }]}>{editor.saving ? '…' : 'Save'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.close} />
        )}
      </View>

      {editor.loading ? (
        <View style={s.center}><ActivityIndicator color={t.accent} /></View>
      ) : editor.editable ? (
        <TextInput
          style={s.code}
          value={editor.text}
          onChangeText={onChange}
          editable={writable}
          multiline
          autoCapitalize='none'
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical='top'
          placeholder={writable ? 'Empty file' : ''}
          placeholderTextColor={t.textMuted}
        />
      ) : (
        <View style={s.center}>
          <Text style={s.binIcon}>⬡</Text>
          <Text style={s.binTitle}>Can’t edit this file here</Text>
          <Text style={s.binSub}>{editor.mime || 'binary'} · {formatBytes(editor.bytes)}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

function PromptBody ({ s, t, prompt, onDone }: { s: Styles; t: Theme; prompt: PromptState; onDone: () => void }) {
  const [value, setValue] = useState(prompt.value)
  return (
    <>
      <Text style={s.sheetTitle}>{prompt.title}</Text>
      <TextInput
        style={s.promptInput}
        value={value}
        onChangeText={setValue}
        placeholder={prompt.placeholder}
        placeholderTextColor={t.textMuted}
        autoFocus
        autoCapitalize='none'
        autoCorrect={false}
        spellCheck={false}
        onSubmitEditing={() => { prompt.onSubmit(value); onDone() }}
      />
      <View style={s.promptRow}>
        <TouchableOpacity style={s.promptCancel} onPress={onDone}>
          <Text style={s.promptCancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.promptOk} onPress={() => { prompt.onSubmit(value); onDone() }}>
          <Text style={s.promptOkText}>{prompt.cta}</Text>
        </TouchableOpacity>
      </View>
    </>
  )
}

function Overlay ({ children, onDismiss, s }: { children: ReactNode; onDismiss: () => void; s: Styles }) {
  return (
    <View style={s.overlay}>
      <TouchableOpacity style={s.overlayBackdrop} activeOpacity={1} onPress={onDismiss} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>{children}</View>
      </KeyboardAvoidingView>
    </View>
  )
}

function formatBytes (n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 52, gap: 8 },
    headerText: { flex: 1 },
    title: { color: t.text, fontSize: 17, fontWeight: '700' },
    subtitle: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    close: { minWidth: 56, height: 40, alignItems: 'flex-end', justifyContent: 'center' },
    closeText: { color: t.accent, fontSize: 15, fontWeight: '600' },
    crumbBar: { maxHeight: 38, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    crumbContent: { alignItems: 'center', paddingHorizontal: 14, gap: 2 },
    crumbWrap: { flexDirection: 'row', alignItems: 'center' },
    crumbSep: { color: t.textMuted, fontSize: 13, marginHorizontal: 6 },
    crumb: { color: t.accent, fontSize: 13, maxWidth: 160 },
    crumbActive: { color: t.text, fontWeight: '700' },
    toolbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    toolBtn: { backgroundColor: t.trustBg, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7 },
    toolBtnText: { color: t.trustText, fontSize: 13, fontWeight: '600' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    errText: { color: t.danger, fontSize: 14, textAlign: 'center' },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', marginTop: 40 },
    entry: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    entryIcon: { fontSize: 16, width: 16, textAlign: 'center' },
    entryName: { color: t.text, fontSize: 15, flex: 1 },
    entryMore: { paddingHorizontal: 6 },
    entryMoreText: { color: t.textMuted, fontSize: 20, fontWeight: '700' },
    code: { flex: 1, color: t.text, backgroundColor: t.surface, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 19, padding: 16 },
    binIcon: { color: t.textMuted, fontSize: 32 },
    binTitle: { color: t.text, fontSize: 16, fontWeight: '600', marginTop: 12 },
    binSub: { color: t.textMuted, fontSize: 13, marginTop: 6 },
    overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
    overlayBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, paddingBottom: 28, gap: 4 },
    sheetTitle: { color: t.text, fontSize: 15, fontWeight: '700', marginBottom: 8, paddingHorizontal: 4 },
    sheetItem: { paddingHorizontal: 8, paddingVertical: 14 },
    sheetItemText: { color: t.text, fontSize: 16 },
    promptInput: { height: 46, color: t.text, fontSize: 15, backgroundColor: t.inputBg, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: 12, marginBottom: 12 },
    promptRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    promptCancel: { paddingHorizontal: 16, paddingVertical: 10 },
    promptCancelText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    promptOk: { backgroundColor: t.accent, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10 },
    promptOkText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
