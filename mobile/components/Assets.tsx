import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal, View, Text, TextInput, FlatList, Image, Pressable, ScrollView, ActivityIndicator, Alert, LayoutAnimation, StyleSheet, ToastAndroid, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { File, Directory, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as Clipboard from 'expo-clipboard'
import { useTheme, radius, space as sp, type Theme } from '../lib/theme'
import type { Backend, AssetRecord, AssetsList } from '../lib/useBackend'
import { pickMedia, pickFiles, prepare, cachedFile, type PickedFile } from '../lib/assetFiles'
import docViewerHtml from '../lib/docViewerHtml'
import * as as from '../lib/assetRules'
import { assetLink, assetFolderLink, assetTagLink } from '../lib/itemLinks'
import ActionSheet from './ActionSheet'
import BottomSheet from './BottomSheet'
import { ListSection, ListRow } from './List'
import IconButton from './IconButton'
import Icon, { type IconName } from './Icon'
import LinkPhone from './LinkPhone'
import Markdown from './Markdown'
import ScreenHeader, { type HeaderAction } from './ScreenHeader'
import AiOrigins from './AiOrigins'

interface Props {
  visible: boolean
  onClose: () => void
  openAssetId?: string // a file to open, e.g. from a link in an AI answer
  openFolder?: string // a folder to show, from a link in a note or an AI answer
  openTag?: string // a tag to show, the same way
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space?: string // the active Space's Root Drive key: its Assets
  spaceName?: string
  onOpenDevices: () => void
  onOpenLibrary: () => void // My Library, where a Space is shared or a home set up
  onOpenJob?: (id: string) => void // the AI Job that saved a file (ADR-0047)
  onOpenAiChat?: (id: string) => void // carry on the AI chat that saved it, in the AI panel
}

// A Space's Assets (ADR-0044): every file it keeps, newest first by month, filtered by kind, and
// Add from the gallery, the camera or the file picker. A photo is scaled here (lib/assetFiles.ts),
// the same sizes as desktop's nomad://assets; any other file is kept as it is. Tap one to see it:
// pictures, video and audio play here, PDFs and e-books (EPUB, MOBI) open in a viewer page
// (lib/docViewerHtml.ts), Markdown and text show as text, and anything else opens in another app.
// In a shared Space a file shows who added it, and its adder, or the Space's owner, can remove it;
// in any other Space they are the user's own.
//
// Pinch the grid to zoom: out to more, smaller tiles and then a list, in to fewer and bigger ones,
// down to one picture the width of the screen. The level is kept on this phone. TalkBack users
// change it with the swipe-up and swipe-down actions.
//
// Files can be in folders and have tags (shared/assets.mjs). Touch and hold a file to select it, then
// move, tag or remove all the selected ones at once; touch and hold a folder (or use the folder's
// ⋮) to rename, move or remove it. Copy link gives a Markdown link to paste in a note.

// Columns, from the list (0) to one tile across.
const LEVELS = [0, 6, 5, 4, 3, 2, 1]
const DEFAULT_LEVEL = LEVELS.indexOf(3)
const ZOOM_KEY = 'nomad-assets-zoom'
// How far apart the fingers move, as a share of where they started, for each step.
const PINCH_STEP = 1.3
const GAP = 3
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type FolderRow = { path: string; name: string; count: number }
type Row =
  | { kind: 'folders'; key: string; folders: FolderRow[] }
  | { kind: 'month'; key: string; label: string; count: number }
  | { kind: 'assets'; key: string; assets: AssetRecord[] }
  | { kind: 'line'; key: string; asset: AssetRecord }

// The grid's rows: the folder's own folders first, then its files by month, `columns` to a row.
// `columns` 0 is the list: a line per file.
function rowsOf (assets: AssetRecord[], folders: FolderRow[], columns: number): Row[] {
  const months = new Map<string, AssetRecord[]>()
  for (const a of assets) {
    const d = new Date(a.takenAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months.has(key)) months.set(key, [])
    months.get(key)!.push(a)
  }
  const rows: Row[] = folders.length ? [{ kind: 'folders', key: 'folders', folders }] : []
  for (const [key, list] of months) {
    const d = new Date(list[0].takenAt)
    rows.push({ kind: 'month', key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, count: list.length })
    if (!columns) for (const a of list) rows.push({ kind: 'line', key: a.id, asset: a })
    else for (let i = 0; i < list.length; i += columns) rows.push({ kind: 'assets', key: `${key}:${columns}:${i}`, assets: list.slice(i, i + columns) })
  }
  return rows
}

const labelOf = (a: AssetRecord) => `${a.name}, ${as.KIND_LABELS[a.kind] || 'File'}, ${whenText(a.takenAt)}${a.by ? `, added by ${a.by}` : ''}${a.source === 'ai' ? ', saved by your AI' : ''}`
const whenText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
const describe = (a: AssetRecord) => [as.KIND_LABELS[a.kind] || 'File', as.formatBytes(a.bytes), a.duration ? as.formatDuration(a.duration) : ''].filter(Boolean).join(' · ')
const iconOf = (a: AssetRecord) => (as.KIND_ICONS[a.kind] || 'file') as IconName
// A picture with no thumbnail (the AI saved a GIF) shows itself in the grid up to this size.
const SMALL_PICTURE = 3 * 1024 * 1024
const hasPicture = (a: AssetRecord) => !!a.thumb || (a.kind === 'image' && a.bytes <= SMALL_PICTURE && a.mime !== 'image/svg+xml')
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const crumbs = (path: string) => path.split('/').join(' › ')
// A Markdown link to paste in a Note (desktop's Copy link writes the same).
const mdLink = (name: string, url: string) => `[${name.replace(/[[\]]/g, '')}](${url})`

export default function Assets ({ visible, onClose, openAssetId, openFolder, openTag, apps, onVaultChange, space, spaceName, onOpenDevices, onOpenLibrary, onOpenJob, onOpenAiChat }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const { width } = useWindowDimensions()
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  const columns = LEVELS[level]
  const tile = columns ? Math.floor((width - sp.lg * 2 - GAP * (columns - 1)) / columns) : 0
  useEffect(() => {
    AsyncStorage.getItem(ZOOM_KEY).then((v) => { const n = Number(v); if (v != null && n >= 0 && n < LEVELS.length) setLevel(n) }).catch(() => {})
  }, [])
  const zoom = useCallback((step: number) => {
    setLevel((l) => {
      const next = Math.max(0, Math.min(LEVELS.length - 1, l + step))
      if (next !== l) {
        LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'))
        AsyncStorage.setItem(ZOOM_KEY, String(next)).catch(() => {})
      }
      return next
    })
  }, [])
  const pinch = usePinch(zoom)
  // Pinching, for TalkBack: each file has "Bigger tiles" and "Smaller tiles" actions.
  const zoomActions = useMemo(() => ({
    accessibilityActions: [
      ...(level < LEVELS.length - 1 ? [{ name: 'zoomIn', label: 'Bigger tiles' }] : []),
      ...(level > 0 ? [{ name: 'zoomOut', label: level === 1 ? 'Show as a list' : 'Smaller tiles' }] : [])
    ],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => zoom(e.nativeEvent.actionName === 'zoomIn' ? 1 : -1)
  }), [level, zoom])
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args = {}) => appsRef.current(app, action, { space, ...args })) as Backend['apps'], [space])
  const [list, setList] = useState<AssetsList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const asked = useRef(new Set<string>())
  // At one tile across a thumbnail is too soft: the picture itself, from this phone's cache.
  const [big, setBig] = useState<Record<string, string>>({})
  const askedBig = useRef(new Set<string>())
  const [filter, setFilter] = useState('all')
  const [folder, setFolder] = useState('') // the folder shown, '' for the top
  const [tag, setTag] = useState('') // the tag shown, '' for none
  const [selected, setSelected] = useState<string[]>([]) // files picked for a change to many at once
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const [folderMenu, setFolderMenu] = useState<string | null>(null) // a folder's actions
  const [fileMenu, setFileMenu] = useState<AssetRecord | null>(null) // a file's actions, from the viewer
  const [prompt, setPrompt] = useState<{ title: string; label: string; value: string; ok: string; onSubmit: (v: string) => void } | null>(null)
  const [picker, setPicker] = useState<{ title: string; current: string | null; not?: string; onPick: (folder: string) => void } | null>(null)
  const [tagsFor, setTagsFor] = useState<string[] | null>(null) // the files whose tags are being changed
  const place = spaceName || 'this Space'

  const refresh = useCallback(async () => {
    const res = await call<AssetsList>('assets', 'list')
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load the files'); return }
    setError('')
    setList(res.value)
    setSelected((ids) => ids.filter((id) => res.value!.assets.some((a) => a.id === id)))
  }, [call])

  useEffect(() => { if (visible) refresh() }, [visible, refresh])
  useEffect(() => { if (visible) return onVaultChange(refresh) }, [visible, onVaultChange, refresh])
  // A Space switch starts over.
  useEffect(() => { setThumbs({}); asked.current.clear(); setBig({}); askedBig.current.clear(); setOpen(null); setFilter('all'); setFolder(''); setTag(''); setSelected([]) }, [space])
  useEffect(() => { if (visible && openAssetId) setOpen(openAssetId) }, [visible, openAssetId])
  // A link to a folder or a tag (from a note, or an AI answer) shows it.
  useEffect(() => {
    if (!visible || (!openFolder && !openTag)) return
    setFolder(as.cleanFolder(openFolder || ''))
    setTag(as.cleanTag(openTag || ''))
    setFilter('all')
    setSelected([])
  }, [visible, openFolder, openTag])

  // Thumbnails load as their rows show. One not replicated yet is asked for again on the next change.
  const loadThumbs = useCallback((items: AssetRecord[]) => {
    for (const a of items) {
      if (columns === 1 && a.kind === 'image' && a.mime !== 'image/svg+xml' && !askedBig.current.has(a.id)) {
        askedBig.current.add(a.id)
        fetchFile(call, a).then((uri) => { if (uri) setBig((m) => ({ ...m, [a.id]: uri })) }).catch(() => setTimeout(() => askedBig.current.delete(a.id), 5000))
      }
      if (!hasPicture(a) || asked.current.has(a.id)) continue
      asked.current.add(a.id)
      call<string | null>('assets', 'read', { id: a.id, thumb: !!a.thumb }).then((res) => {
        if (res.ok && res.value) setThumbs((m) => ({ ...m, [a.id]: `data:${a.thumb ? 'image/jpeg' : a.mime};base64,` + res.value }))
        else setTimeout(() => asked.current.delete(a.id), 5000)
      })
    }
  }, [call, columns])

  const onViewable = useViewable(loadThumbs)
  const all = list?.assets || []
  const folders = list?.folders || []
  // Just looking around (no kind or tag): the folder's own folders and files. A kind or a tag looks
  // in the folder and every folder in it.
  const browsing = filter === 'all' && !tag
  const scoped = useMemo(() => all.filter((a) => as.inFolder(a.folder || '', folder)), [all, folder])
  const shown = useMemo(() => (browsing ? as.filterAssets(all, { folder }) : as.filterAssets(scoped, { filter, tag })), [all, scoped, folder, filter, tag, browsing])
  const subs = useMemo(() => (browsing ? as.childFolders(folders, folder, all) : []), [browsing, folders, folder, all])
  const rows = useMemo(() => rowsOf(shown, subs, columns), [shown, subs, columns])
  const current = open ? all.find((a) => a.id === open) || null : null
  const counts = useMemo(() => new Map(as.FILTERS.map((f) => [f.id, as.filterAssets(scoped, { filter: f.id }).length])), [scoped])
  const tags = useMemo(() => {
    const list = as.tagCounts(scoped)
    if (tag && !list.some((x) => x.tag === tag)) list.unshift({ tag, count: 0 })
    return list
  }, [scoped, tag])
  const known = useMemo(() => as.tagCounts(all).map((x) => x.tag), [all])
  const selecting = selected.length > 0
  const missing = !!folder && !!list && !folders.includes(folder)

  const step = (n: number) => {
    const i = shown.findIndex((a) => a.id === open)
    if (i >= 0 && shown.length > 1) setOpen(shown[(i + n + shown.length) % shown.length].id)
  }

  const go = (next: { folder?: string; tag?: string }) => {
    if (next.folder !== undefined) setFolder(next.folder)
    if (next.tag !== undefined) setTag(next.tag)
    setSelected([])
  }

  // Back: the viewer, then the selection, then the tag, then up a folder, then out.
  const back = () => {
    if (open) setOpen(null)
    else if (selecting) setSelected([])
    else if (tag) setTag('')
    else if (filter !== 'all') setFilter('all')
    else if (folder) setFolder(as.parentFolder(folder))
    else onClose()
  }

  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  // Run a change; on a failure say so. Returns the value, or undefined.
  const run = async <T, >(action: string, args: Record<string, unknown>, failed: string): Promise<T | undefined> => {
    const res = await call<T>('assets', action, args)
    if (!res.ok) { Alert.alert(failed, res.message || 'Unknown error'); return undefined }
    refresh()
    return res.value as T
  }

  const add = async (from: 'camera' | 'library' | 'files') => {
    let picked: PickedFile[]
    try {
      picked = from === 'files' ? await pickFiles() : await pickMedia(from)
    } catch (err) {
      Alert.alert('Couldn’t add files', (err as Error)?.message || String(err))
      return
    }
    if (!picked.length) return
    setAdding({ done: 0, total: picked.length })
    let failed = 0
    let last = ''
    // A file added in a folder goes in it, and one added while a tag is shown gets the tag.
    const where = { folder: folder || undefined, tags: tag ? [tag] : undefined }
    for (let i = 0; i < picked.length; i++) {
      try {
        const asset = await prepare(picked[i])
        const res = await call('assets', 'add', { asset: { ...asset, ...where } })
        if (!res.ok) throw new Error(res.message || 'Unknown error')
      } catch (err) {
        failed++
        last = (err as Error)?.message || String(err)
      }
      setAdding({ done: i + 1, total: picked.length })
    }
    setAdding(null)
    refresh()
    if (failed) Alert.alert(failed === picked.length ? 'Couldn’t add the files' : `${failed} of ${picked.length} weren’t added`, last)
  }

  const remove = (a: AssetRecord) => {
    Alert.alert(`Remove “${a.name}”?`, list?.shared ? `It goes from ${place}’s Assets, for everyone in it.` : 'It goes from your Assets on all your devices.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const res = await call('assets', 'delete', { id: a.id })
          if (!res.ok) { Alert.alert('Couldn’t remove it', res.message || 'Unknown error'); return }
          setOpen(null)
          refresh()
        }
      }
    ])
  }

  const removeSelected = () => {
    const picked = all.filter((a) => selected.includes(a.id))
    const mine = picked.filter((a) => a.canDelete)
    const theirs = picked.length - mine.length
    if (!mine.length) { Alert.alert('You can’t remove these', 'Only the person who added a file, or the Space’s owner, can remove it.'); return }
    Alert.alert(`Remove ${plural(mine.length, 'file')}?`, [list?.shared ? `They go from ${place}’s Assets, for everyone in it.` : 'They go from your Assets on all your devices.', theirs ? `${plural(theirs, 'file')} someone else added will stay.` : ''].filter(Boolean).join(' '), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const done = await run<{ removed: number }>('deleteMany', { ids: mine.map((a) => a.id) }, 'Couldn’t remove them')
          if (done) setSelected([])
        }
      }
    ])
  }

  const moveFiles = (ids: string[]) => {
    const here = ids.length === 1 ? all.find((a) => a.id === ids[0])?.folder || '' : null
    setPicker({
      title: ids.length === 1 ? 'Move to…' : `Move ${plural(ids.length, 'file')} to…`,
      current: here,
      onPick: async (dest) => {
        const done = await run<{ changed: number }>('updateMany', { ids, folder: dest }, 'Couldn’t move them')
        if (done) setSelected([])
      }
    })
  }

  const renameFile = (a: AssetRecord) => setPrompt({
    title: 'Rename',
    label: 'Name',
    value: a.name,
    ok: 'Rename',
    onSubmit: (name) => { if (name.trim() && name.trim() !== a.name) run('update', { id: a.id, name: name.trim() }, 'Couldn’t rename it') }
  })

  const newFolder = () => setPrompt({
    title: 'New folder',
    label: folder ? `In ${crumbs(folder)}` : 'In Assets',
    value: '',
    ok: 'Create',
    onSubmit: (name) => {
      const clean = as.cleanFolderName(name)
      if (clean) run('addFolder', { path: as.joinFolder(folder, clean) }, 'Couldn’t make the folder')
    }
  })

  // Where the open folder is after `from` moved to `to`.
  const moved = (path: string, from: string, to: string) => (as.inFolder(path, from) ? as.cleanFolder(to + path.slice(from.length)) : path)

  const moveFolderTo = async (from: string, to: string) => {
    if (to === from) return
    if (folders.includes(to)) { Alert.alert('That folder is already there', `There’s already a folder called ${as.folderName(to)} there.`); return }
    const done = await run('moveFolder', { from, to }, 'Couldn’t move the folder')
    if (done) setFolder((f) => moved(f, from, to))
  }

  const renameFolder = (path: string) => setPrompt({
    title: 'Rename folder',
    label: 'Name',
    value: as.folderName(path),
    ok: 'Rename',
    onSubmit: (name) => {
      const clean = as.cleanFolderName(name)
      if (clean) moveFolderTo(path, as.joinFolder(as.parentFolder(path), clean))
    }
  })

  const moveFolder = (path: string) => setPicker({
    title: `Move “${as.folderName(path)}” to…`,
    current: as.parentFolder(path),
    not: path,
    onPick: (dest) => moveFolderTo(path, as.joinFolder(dest, as.folderName(path)))
  })

  const removeFolder = (path: string) => {
    const n = all.filter((a) => a.folder && as.inFolder(a.folder, path)).length
    Alert.alert(`Remove “${as.folderName(path)}”?`, n ? `The ${plural(n, 'file')} in it go too${list?.shared ? `, for everyone in ${place}` : ''}.` : 'It’s empty.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const done = await run('deleteFolder', { path }, 'Couldn’t remove the folder')
          if (done && as.inFolder(folder, path)) setFolder(as.parentFolder(path))
        }
      }
    ])
  }

  const copyLink = async (name: string, url: string) => {
    await Clipboard.setStringAsync(mdLink(name, url))
    ToastAndroid.show('Link copied. Paste it in a note.', ToastAndroid.SHORT)
  }

  const saveTags = async (ids: string[], change: { add: string[]; remove: string[] }) => {
    if (!change.add.length && !change.remove.length) return
    const done = await run<{ changed: number }>('updateMany', { ids, addTags: change.add, removeTags: change.remove }, 'Couldn’t change the tags')
    if (done) setSelected([])
  }

  const canAdd = !!list?.canAdd
  const count = all.length
  const title = selecting ? `${selected.length} selected` : tag ? `#${tag}` : folder ? as.folderName(folder) : 'Assets'
  const subtitle = adding
    ? `Adding ${Math.min(adding.done + 1, adding.total)} of ${adding.total}…`
    : selecting
      ? undefined
      : tag
        ? `${folder ? crumbs(folder) : place} · ${plural(shown.length, 'file')}`
        : folder
          ? `${crumbs(as.parentFolder(folder)) || place} · ${plural(scoped.length, 'file')}`
          : list ? `${place} · ${plural(count, 'file')}` : undefined
  const actions: HeaderAction[] | undefined = selecting
    ? [
        ...(selected.length < shown.length ? [{ icon: 'check-double' as IconName, label: 'Select all', onPress: () => setSelected(shown.map((a) => a.id)) }] : []),
        ...(canAdd ? [{ icon: 'folder' as IconName, label: 'Move to a folder', onPress: () => moveFiles(selected) }, { icon: 'tag' as IconName, label: 'Tags', onPress: () => setTagsFor(selected) }] : []),
        ...(all.some((a) => selected.includes(a.id) && a.canDelete) ? [{ icon: 'trash' as IconName, label: 'Remove', onPress: removeSelected }] : [])
      ]
    : [
        ...(canAdd ? [{ icon: 'folder-plus' as IconName, label: 'New folder', onPress: newFolder }, { icon: 'plus' as IconName, label: 'Add files', onPress: () => setAddMenu(true), busy: !!adding }] : []),
        ...(folder && !tag && !missing ? [{ icon: 'ellipsis-v' as IconName, label: 'Folder options', onPress: () => setFolderMenu(folder) }] : []),
        ...(tag ? [{ icon: 'link' as IconName, label: 'Copy link for a note', onPress: () => copyLink(`#${tag}`, assetTagLink(tag)) }] : [])
      ]

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={back} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title={title}
          subtitle={subtitle}
          onBack={selecting ? () => setSelected([]) : back}
          backLabel={selecting ? 'Clear selection' : folder || tag ? 'Up' : 'Back'}
          actions={actions?.length ? actions : undefined}
        />

        {noVault ? (
          <LinkPhone what='Assets' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !list ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : !count && !folders.length ? (
          <View style={s.notice}>
            <Icon name='folder-open' size={32} color={t.textMuted} />
            <Text style={s.noticeTitle}>No files yet</Text>
            <Text style={s.noticeBody}>
              {!canAdd
                ? `When someone in ${place} adds files, they show here.`
                : list.shared
                  ? `Add photos, videos or any other file. Everyone in ${place} sees them. Your AI can save things here too.`
                  : `Keep photos, videos, PDFs and any other file for ${place} here. Only you see them, on your own devices. Your AI can save things here too.`}
            </Text>
            {canAdd && <Pressable style={[s.btn, s.btnPrimary]} onPress={() => setAddMenu(true)} accessibilityRole='button'><Text style={s.btnPrimaryText}>Add files</Text></Pressable>}
            {!list.shared && <Pressable style={s.btn} onPress={onOpenLibrary} accessibilityRole='button'><Text style={s.btnText}>Share {place}</Text></Pressable>}
          </View>
        ) : missing ? (
          <View style={s.notice}>
            <Icon name='folder' size={32} color={t.textMuted} />
            <Text style={s.noticeTitle}>This folder isn’t here</Text>
            <Text style={s.noticeBody}>Someone may have renamed, moved or removed it.</Text>
            <Pressable style={s.btn} onPress={() => go({ folder: '', tag: '' })} accessibilityRole='button'><Text style={s.btnText}>Go to all files</Text></Pressable>
          </View>
        ) : (
          <View
            style={s.grow}
            {...pinch}
          >
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={s.page}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={VIEWABILITY}
            extraData={selected}
            ListHeaderComponent={
              <>
                {folder || tag ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.crumbs}>
                    <Pressable style={s.crumb} onPress={() => go({ folder: '', tag: '' })} accessibilityRole='button' accessibilityLabel='All files'>
                      <Icon name='home' size={13} color={t.textDim} />
                      <Text style={s.crumbText}>Assets</Text>
                    </Pressable>
                    {folder.split('/').filter(Boolean).map((name, i, parts) => {
                      const path = parts.slice(0, i + 1).join('/')
                      const here = path === folder && !tag
                      return (
                        <View key={path} style={s.crumbPart}>
                          <Icon name='chevron-right' size={10} color={t.textMuted} />
                          <Pressable style={s.crumb} onPress={() => go({ folder: path, tag: '' })} disabled={here} accessibilityRole='button'>
                            <Icon name={here ? 'folder-open' : 'folder'} size={13} color={FOLDER[t.scheme]} />
                            <Text style={[s.crumbText, here && s.crumbHere]}>{name}</Text>
                          </Pressable>
                        </View>
                      )
                    })}
                  </ScrollView>
                ) : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
                  {as.FILTERS.filter((f) => f.id === 'all' || f.id === filter || counts.get(f.id)).map((f) => (
                    <Pressable
                      key={f.id}
                      style={[s.chip, filter === f.id && s.chipOn]}
                      onPress={() => setFilter(f.id)}
                      accessibilityRole='button'
                      accessibilityState={{ selected: filter === f.id }}
                    >
                      <Text style={[s.chipText, filter === f.id && s.chipTextOn]}>{f.label} <Text style={filter === f.id ? s.chipTextOn : s.chipCount}>{counts.get(f.id)}</Text></Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {tags.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tagChips}>
                    {tags.map((x) => (
                      <Pressable
                        key={x.tag}
                        style={[s.tagChip, tag === x.tag && s.chipOn]}
                        onPress={() => go({ tag: tag === x.tag ? '' : x.tag })}
                        accessibilityRole='button'
                        accessibilityState={{ selected: tag === x.tag }}
                      >
                        <Text style={[s.tagChipText, tag === x.tag && s.chipTextOn]}>#{x.tag} <Text style={tag === x.tag ? s.chipTextOn : s.chipCount}>{x.count}</Text></Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
                {!list.shared && !folder && !tag && (
                  <View style={s.hint}>
                    <Icon name='lock' size={13} color={t.textMuted} />
                    <Text style={s.hintText}>Only you see these, on your own devices.</Text>
                  </View>
                )}
              </>
            }
            ListEmptyComponent={
              <Text style={[s.noticeBody, s.emptyHere]}>
                {tag ? `No files are tagged ${tag}${folder ? ' in this folder' : ''}.` : !browsing ? 'No files of this kind.' : canAdd ? 'This folder is empty. Add files here, or move some in.' : 'This folder is empty.'}
              </Text>
            }
            renderItem={({ item }) => {
              if (item.kind === 'folders') {
                return (
                  <ListSection title='Folders' style={s.folders}>
                    {item.folders.map((f, i) => (
                      <ListRow
                        key={f.path}
                        title={f.name}
                        subtitle={f.count ? plural(f.count, 'file') : 'Empty'}
                        left={<View style={s.folderLead}><Icon name='folder' size={20} color={FOLDER[t.scheme]} /></View>}
                        chevron
                        divider={i > 0}
                        onPress={() => go({ folder: f.path })}
                        onLongPress={() => setFolderMenu(f.path)}
                        accessibilityLabel={`Folder ${f.name}, ${plural(f.count, 'file')}`}
                      />
                    ))}
                  </ListSection>
                )
              }
              if (item.kind === 'month') return <Text style={s.month} accessibilityRole='header'>{item.label} <Text style={s.monthCount}>{item.count}</Text></Text>
              const where = (a: AssetRecord) => (a.folder && !browsing ? `, in ${a.folder}` : '')
              if (item.kind === 'line') {
                const a = item.asset
                const picked = selected.includes(a.id)
                return (
                  <Pressable
                    style={[s.line, picked && s.linePicked]}
                    onPress={() => (selecting ? toggle(a.id) : setOpen(a.id))}
                    onLongPress={() => toggle(a.id)}
                    android_ripple={{ color: t.ripple }}
                    accessibilityRole={selecting ? 'checkbox' : 'button'}
                    accessibilityState={selecting ? { checked: picked } : undefined}
                    accessibilityHint={selecting ? undefined : 'Touch and hold to select'}
                    accessibilityLabel={labelOf(a) + where(a)}
                    {...zoomActions}
                  >
                    {selecting && (
                      <View style={[s.pick, s.pickLine, picked && s.pickOn]}>
                        {picked && <Icon name='check' size={11} color='#fff' />}
                      </View>
                    )}
                    <View style={[s.lineThumb, !hasPicture(a) && s.docTile]}>
                      {hasPicture(a)
                        ? thumbs[a.id] ? <Image source={{ uri: thumbs[a.id] }} style={s.thumb} /> : null
                        : <Icon name={iconOf(a)} size={20} color={kindColor(t, a.kind)} />}
                      {a.kind === 'video' && <View style={s.linePlay}><Icon name='play' size={8} color='#fff' /></View>}
                    </View>
                    <View style={s.lineText}>
                      <Text style={s.lineName} numberOfLines={1}>{a.name}</Text>
                      <Text style={s.lineSub} numberOfLines={1}>{[describe(a), a.by, a.source === 'ai' ? 'Saved by your AI' : '', ...(a.tags || []).map((x) => `#${x}`)].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </Pressable>
                )
              }
              return (
                <View style={s.row}>
                  {item.assets.map((a) => {
                    const one = columns === 1
                    const picked = selected.includes(a.id)
                    // One across: a picture keeps its shape (within reason), a document is a wide card.
                    const ratio = one ? (hasPicture(a) && a.width && a.height ? Math.min(1.5, Math.max(0.5, a.height / a.width)) : hasPicture(a) ? 1 : 0.55) : 1
                    const face = Math.max(28, Math.min(64, Math.round(tile * 0.22)))
                    return (
                      <Pressable
                        key={a.id}
                        style={[s.tile, { width: tile, height: Math.round(tile * ratio) }, !hasPicture(a) && s.docTile]}
                        onPress={() => (selecting ? toggle(a.id) : setOpen(a.id))}
                        onLongPress={() => toggle(a.id)}
                        accessibilityRole={selecting ? 'checkbox' : 'button'}
                        accessibilityState={selecting ? { checked: picked } : undefined}
                        accessibilityHint={selecting ? undefined : 'Touch and hold to select'}
                        accessibilityLabel={labelOf(a) + where(a)}
                        {...zoomActions}
                      >
                        <View style={[s.tileBody, picked && s.tileBodyPicked]}>
                          {hasPicture(a) ? (
                            big[a.id] && one ? <Image source={{ uri: big[a.id] }} style={s.thumb} /> : thumbs[a.id] ? <Image source={{ uri: thumbs[a.id] }} style={s.thumb} /> : null
                          ) : (
                            <>
                              <View style={s.docFace}>
                                <Icon name={iconOf(a)} size={columns >= 5 ? 20 : face} color={kindColor(t, a.kind)} />
                                {columns < 6 && <Text style={[s.ext, { color: kindColor(t, a.kind) }, one && s.extBig]}>{as.extOf(a.name).toUpperCase() || as.KIND_LABELS[a.kind]}</Text>}
                              </View>
                              {columns < 5 && <Text style={[s.docName, one && s.docNameBig]} numberOfLines={1}>{a.name}</Text>}
                            </>
                          )}
                          {a.kind === 'video' && (
                            <View style={s.play}><Icon name='play' size={9} color='#fff' /><Text style={s.playText}>{columns < 5 && a.duration ? as.formatDuration(a.duration) : ''}</Text></View>
                          )}
                          {a.source === 'ai' && <View style={s.ai}><Icon name='magic' size={9} color='#fff' /></View>}
                        </View>
                        {selecting && (
                          <View style={[s.pick, picked && s.pickOn]}>
                            {picked && <Icon name='check' size={11} color='#fff' />}
                          </View>
                        )}
                      </Pressable>
                    )
                  })}
                </View>
              )
            }}
          />
          </View>
        )}

        <ActionSheet
          visible={addMenu}
          onClose={() => setAddMenu(false)}
          title={folder ? `Add to ${as.folderName(folder)}` : `Add to ${place}’s Assets`}
          groups={[[
            { label: 'Photos and videos', icon: 'images', onPress: () => add('library') },
            { label: 'Take a photo', icon: 'camera', onPress: () => add('camera') },
            { label: 'Files', icon: 'folder-open', onPress: () => add('files') }
          ]]}
        />

        <ActionSheet
          visible={!!folderMenu}
          onClose={() => setFolderMenu(null)}
          title={folderMenu ? as.folderName(folderMenu) : ''}
          subtitle={folderMenu && as.parentFolder(folderMenu) ? `In ${crumbs(as.parentFolder(folderMenu))}` : undefined}
          groups={folderMenu ? [
            [
              { label: 'Copy link for a note', icon: 'link', onPress: () => copyLink(as.folderName(folderMenu), assetFolderLink(folderMenu)) },
              { label: 'Rename', icon: 'pen', onPress: () => renameFolder(folderMenu), hidden: !canAdd },
              { label: 'Move to…', icon: 'folder', onPress: () => moveFolder(folderMenu), hidden: !canAdd }
            ],
            [{ label: 'Remove folder', icon: 'trash', destructive: true, onPress: () => removeFolder(folderMenu), hidden: !canAdd }]
          ] : []}
        />

        <Viewer
          asset={current}
          many={shown.length > 1}
          canEdit={canAdd}
          thumb={current ? thumbs[current.id] : undefined}
          call={call}
          onClose={() => setOpen(null)}
          onStep={step}
          onRemove={remove}
          onSaved={refresh}
          onMenu={setFileMenu}
          onTag={(x) => { setOpen(null); go({ folder: '', tag: x }) }}
          onOpenJob={(id) => { setOpen(null); onOpenJob?.(id) }}
          onOpenChat={onOpenAiChat ? (id) => { setOpen(null); onOpenAiChat(id) } : undefined}
        >
          <ActionSheet
            visible={!!fileMenu}
            onClose={() => setFileMenu(null)}
            title={fileMenu?.name}
            subtitle={fileMenu?.folder ? `In ${crumbs(fileMenu.folder)}` : undefined}
            groups={fileMenu ? [
              [
                { label: 'Copy link for a note', icon: 'link', onPress: () => copyLink(fileMenu.name, assetLink(fileMenu.id)) },
                { label: 'Rename', icon: 'pen', onPress: () => renameFile(fileMenu), hidden: !canAdd },
                { label: 'Move to…', icon: 'folder', onPress: () => moveFiles([fileMenu.id]), hidden: !canAdd },
                { label: 'Tags', icon: 'tag', onPress: () => setTagsFor([fileMenu.id]), hidden: !canAdd }
              ],
              [{ label: 'Remove from Assets', icon: 'trash', destructive: true, onPress: () => remove(fileMenu), hidden: !fileMenu.canDelete }]
            ] : []}
          />
          <TextSheet prompt={prompt} onClose={() => setPrompt(null)} />
          <FolderSheet picker={picker} folders={folders} onClose={() => setPicker(null)} />
          <TagsSheet
            files={tagsFor ? all.filter((a) => tagsFor.includes(a.id)) : null}
            known={known}
            onClose={() => setTagsFor(null)}
            onSave={(change) => { if (tagsFor) saveTags(tagsFor, change) }}
          />
        </Viewer>

        {!current && (
          <>
            <TextSheet prompt={prompt} onClose={() => setPrompt(null)} />
            <FolderSheet picker={picker} folders={folders} onClose={() => setPicker(null)} />
            <TagsSheet
              files={tagsFor ? all.filter((a) => tagsFor.includes(a.id)) : null}
              known={known}
              onClose={() => setTagsFor(null)}
              onSave={(change) => { if (tagsFor) saveTags(tagsFor, change) }}
            />
          </>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const FOLDER = { light: '#e0a526', dark: '#f2c45a' }

// A name to type: a new folder, or a new name for a file or folder.
function TextSheet ({ prompt, onClose }: { prompt: { title: string; label: string; value: string; ok: string; onSubmit: (v: string) => void } | null; onClose: () => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [value, setValue] = useState('')
  useEffect(() => { if (prompt) setValue(prompt.value) }, [prompt])
  const submit = () => { if (!prompt) return; onClose(); prompt.onSubmit(value) }
  return (
    <BottomSheet visible={!!prompt} onClose={onClose} style={s.sheet}>
      <Text style={s.sheetTitle}>{prompt?.title}</Text>
      <Text style={s.sheetLabel}>{prompt?.label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={setValue}
        autoFocus
        selectTextOnFocus
        maxLength={as.MAX_NAME}
        onSubmitEditing={submit}
        returnKeyType='done'
        placeholderTextColor={t.textMuted}
        accessibilityLabel={prompt?.label}
      />
      <View style={s.sheetActions}>
        <Pressable style={s.btn} onPress={onClose} accessibilityRole='button'><Text style={s.btnText}>Cancel</Text></Pressable>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={submit} accessibilityRole='button'><Text style={s.btnPrimaryText}>{prompt?.ok}</Text></Pressable>
      </View>
    </BottomSheet>
  )
}

// Pick a folder to move to: '' is the top. A folder made here is kept once something moves into it.
function FolderSheet ({ picker, folders, onClose }: { picker: { title: string; current: string | null; not?: string; onPick: (folder: string) => void } | null; folders: string[]; onClose: () => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [chosen, setChosen] = useState('')
  const [extra, setExtra] = useState<string[]>([])
  const [name, setName] = useState('')
  useEffect(() => { if (picker) { setChosen(picker.current ?? ''); setExtra([]); setName('') } }, [picker])
  const rows = ['', ...[...new Set([...folders, ...extra])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).filter((f) => !picker?.not || !as.inFolder(f, picker.not))]
  const make = () => {
    const clean = as.cleanFolderName(name)
    if (!clean) return
    const path = as.joinFolder(chosen, clean)
    setExtra((e) => [...e, path])
    setChosen(path)
    setName('')
  }
  const pick = () => { if (!picker) return; onClose(); picker.onPick(chosen) }
  return (
    <BottomSheet visible={!!picker} onClose={onClose} style={s.sheet}>
      <Text style={s.sheetTitle}>{picker?.title}</Text>
      <ScrollView style={s.folderList}>
        {rows.map((f) => (
          <Pressable
            key={f || '/'}
            style={[s.folderRow, { paddingLeft: sp.md + (f ? f.split('/').length : 0) * 18 }, f === chosen && s.folderRowOn]}
            onPress={() => setChosen(f)}
            accessibilityRole='radio'
            accessibilityState={{ checked: f === chosen }}
            android_ripple={{ color: t.ripple }}
          >
            <Icon name={f ? 'folder' : 'home'} size={16} color={f === chosen ? t.onAccent : f ? FOLDER[t.scheme] : t.textDim} />
            <Text style={[s.folderRowText, f === chosen && s.folderRowTextOn]} numberOfLines={1}>{f ? as.folderName(f) : 'Assets'}</Text>
            {f === picker?.current && <Text style={[s.folderNow, f === chosen && s.folderRowTextOn]}>now</Text>}
          </Pressable>
        ))}
      </ScrollView>
      <View style={s.newFolder}>
        <TextInput
          style={[s.input, s.newFolderInput]}
          value={name}
          onChangeText={setName}
          placeholder={chosen ? `New folder in ${as.folderName(chosen)}` : 'New folder'}
          placeholderTextColor={t.textMuted}
          onSubmitEditing={make}
          returnKeyType='done'
          maxLength={as.MAX_FOLDER_PART}
          accessibilityLabel='New folder name'
        />
        <IconButton icon='folder-plus' label='Make the folder' onPress={make} disabled={!name.trim()} color={t.accent} />
      </View>
      <View style={s.sheetActions}>
        <Pressable style={s.btn} onPress={onClose} accessibilityRole='button'><Text style={s.btnText}>Cancel</Text></Pressable>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={pick} accessibilityRole='button'><Text style={s.btnPrimaryText}>Move here</Text></Pressable>
      </View>
    </BottomSheet>
  )
}

// Add tags to some files, or take tags off them.
function TagsSheet ({ files, known, onClose, onSave }: { files: AssetRecord[] | null; known: string[]; onClose: () => void; onSave: (change: { add: string[]; remove: string[] }) => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [remove, setRemove] = useState<string[]>([])
  const [add, setAdd] = useState<string[]>([])
  const [text, setText] = useState('')
  useEffect(() => { if (files) { setRemove([]); setAdd([]); setText('') } }, [files])
  const counts = files ? as.tagCounts(files) : []
  const typed = as.normalizeTags(text)
  const adding = [...add, ...typed.filter((x) => !add.includes(x))]
  const offer = known.filter((x) => !adding.includes(x) && !counts.some((c) => c.tag === x) && (!text.trim() || x.includes(as.cleanTag(text)))).slice(0, 12)
  const save = () => { onClose(); onSave({ add: adding, remove }) }
  const many = (files?.length || 0) > 1
  return (
    <BottomSheet visible={!!files} onClose={onClose} style={s.sheet}>
      <Text style={s.sheetTitle}>{many ? `Tags for ${plural(files!.length, 'file')}` : 'Tags'}</Text>
      <View style={s.tagWrap}>
        {counts.map(({ tag, count }) => {
          const off = remove.includes(tag)
          return (
            <Pressable
              key={tag}
              style={[s.tagPill, off && s.tagPillOff]}
              onPress={() => setRemove((r) => (off ? r.filter((x) => x !== tag) : [...r, tag]))}
              accessibilityRole='button'
              accessibilityLabel={off ? `Keep ${tag}` : `Take ${tag} off`}
            >
              <Text style={[s.tagPillText, off && s.tagPillTextOff]}>#{tag}{many ? ` ${count}` : ''}</Text>
              <Icon name={off ? 'undo' : 'times'} size={11} color={off ? t.textMuted : t.accent} />
            </Pressable>
          )
        })}
        {add.map((tag) => (
          <Pressable key={'+' + tag} style={[s.tagPill, s.tagPillNew]} onPress={() => setAdd((a) => a.filter((x) => x !== tag))} accessibilityRole='button' accessibilityLabel={`Don’t add ${tag}`}>
            <Text style={[s.tagPillText, s.chipTextOn]}>#{tag}</Text>
            <Icon name='times' size={11} color={t.onAccent} />
          </Pressable>
        ))}
        {!counts.length && !add.length ? <Text style={s.sheetLabel}>No tags yet.</Text> : null}
      </View>
      <TextInput
        style={s.input}
        value={text}
        onChangeText={(v) => {
          // A comma finishes a tag.
          if (/,/.test(v)) { setAdd((a) => [...new Set([...a, ...as.normalizeTags(v)])]); setText(''); return }
          setText(v)
        }}
        onSubmitEditing={() => { if (typed.length) { setAdd((a) => [...new Set([...a, ...typed])]); setText('') } }}
        placeholder='Add tags: family, recipes'
        placeholderTextColor={t.textMuted}
        autoCapitalize='none'
        returnKeyType='done'
        blurOnSubmit={false}
        accessibilityLabel='Tags to add'
      />
      {offer.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.offer} keyboardShouldPersistTaps='handled'>
          {offer.map((x) => (
            <Pressable key={x} style={s.tagChip} onPress={() => { setAdd((a) => [...a, x]); setText('') }} accessibilityRole='button' accessibilityLabel={`Add ${x}`}>
              <Text style={s.tagChipText}>#{x}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={s.sheetActions}>
        <Pressable style={s.btn} onPress={onClose} accessibilityRole='button'><Text style={s.btnText}>Cancel</Text></Pressable>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={save} accessibilityRole='button'><Text style={s.btnPrimaryText}>Save</Text></Pressable>
      </View>
    </BottomSheet>
  )
}

function Viewer ({ asset, many, canEdit, thumb, call, onClose, onStep, onRemove, onSaved, onMenu, onTag, onOpenJob, onOpenChat, children }: {
  asset: AssetRecord | null
  many: boolean
  canEdit: boolean
  thumb?: string
  call: Backend['apps']
  onClose: () => void
  onStep: (n: number) => void
  onRemove: (a: AssetRecord) => void
  onSaved: () => void
  onMenu: (a: AssetRecord) => void // rename, move, tags, copy link
  onTag: (tag: string) => void // show every file with this tag
  onOpenJob: (id: string) => void // the AI Job that saved it
  onOpenChat?: (id: string) => void // the AI chat that saved it, carried on in the AI panel
  children?: ReactNode // sheets opened from the viewer, drawn over it
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [file, setFile] = useState<{ id: string; uri: string } | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState('')
  const [source, setSource] = useState(false) // a Markdown or HTML file shown as its source
  const [got, setGot] = useState(0) // bytes of the file in this phone's cache so far
  const [caption, setCaption] = useState('')
  const id = asset?.id

  useEffect(() => {
    setFile(null); setText(null); setFailed(''); setGot(0); setSource(false)
    setCaption(asset?.caption || '')
    if (!asset) return
    let gone = false
    fetchFile(call, asset, { onProgress: (n) => { if (!gone) setGot(n) }, gone: () => gone }).then(async (uri) => {
      if (gone) return
      if (!uri) { setFailed('This file hasn’t reached this phone yet. Try again in a moment.'); return }
      setFile({ id: asset.id, uri })
      if (as.isTextKind(asset.kind) || asset.kind === 'html') {
        if (asset.bytes > MAX_TEXT_FILE) { setText(null); setFailed('It’s too long to show here. Open it in another app.'); return }
        const body = await new File(uri).text()
        // A page keeps all of it to run; its source shows the first MAX_TEXT_PREVIEW like any text.
        const keep = asset.kind === 'html' ? as.MAX_HTML_PREVIEW : as.MAX_TEXT_PREVIEW
        if (!gone) setText(body.length > keep ? body.slice(0, keep) : body)
      }
    }).catch((err) => { if (!gone) setFailed((err as Error)?.message || String(err)) })
    return () => { gone = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (!asset || !file) return
    if (!(await Sharing.isAvailableAsync())) { Alert.alert('Can’t share here', 'This phone can’t hand files to other apps.'); return }
    await Sharing.shareAsync(file.uri, { mimeType: asset.mime, dialogTitle: asset.name }).catch(() => {})
  }

  const saveCaption = async () => {
    if (!asset || (asset.caption || '') === caption.trim()) return
    const res = await call('assets', 'update', { id: asset.id, caption: caption.trim() })
    if (!res.ok) Alert.alert('Couldn’t save the caption', res.message || 'Unknown error')
    onSaved()
  }

  const a = asset
  const ready = !!a && !!file && file.id === a.id
  let body = null
  if (a) {
    if (failed) body = <Card a={a} why={failed} onOpen={ready ? share : undefined} />
    else if (!ready) {
      body = (
        <View style={s.fetching}>
          {thumb ? <Image source={{ uri: thumb }} style={s.full} resizeMode='contain' /> : null}
          <View style={s.fetchingNote}>
            <ActivityIndicator color='#fff' />
            {a.bytes > 8 * 1024 * 1024 && (
              <Text style={s.fetchingText}>{got ? `Getting ${as.formatBytes(got)} of ${as.formatBytes(a.bytes)}…` : `Getting ${as.formatBytes(a.bytes)}…`}</Text>
            )}
          </View>
        </View>
      )
    } else if (a.kind === 'image') body = <Image source={{ uri: file!.uri }} style={s.full} resizeMode='contain' />
    else if (a.kind === 'video' || a.kind === 'audio') body = <Player a={a} uri={file!.uri} onFailed={setFailed} />
    else if (a.kind === 'pdf' || a.kind === 'book') body = <DocView a={a} uri={file!.uri} onFailed={setFailed} />
    else if (a.kind === 'html' && !source) {
      body = text == null ? <ActivityIndicator color='#fff' /> : <PageView html={text} />
    } else if (as.isTextKind(a.kind) || a.kind === 'html') {
      body = text == null
        ? <ActivityIndicator color='#fff' />
        : (
          <ScrollView style={s.paper} contentContainerStyle={s.paperBody}>
            {a.kind === 'markdown' && !source
              ? <Markdown text={text} color={t.text} />
              : <Text style={s.code} selectable>{text.length > as.MAX_TEXT_PREVIEW ? text.slice(0, as.MAX_TEXT_PREVIEW) : text}</Text>}
          </ScrollView>
          )
    } else body = <Card a={a} why='There’s no preview for this kind of file here. Open it in another app.' onOpen={share} />
  }

  return (
    <Modal visible={!!a} animationType='fade' onRequestClose={onClose} presentationStyle='fullScreen'>
      {a && (
        <SafeAreaView style={s.viewer} edges={['top', 'bottom']}>
          <View style={s.viewerBar}>
            <IconButton icon='arrow-left' label='Back' onPress={onClose} color='#fff' ripple='rgba(255,255,255,0.2)' />
            <View style={s.viewerMeta}>
              <Text style={s.viewerTitle} numberOfLines={1}>{a.name}</Text>
              <Text style={s.viewerSub} numberOfLines={1}>{[describe(a), whenText(a.takenAt), a.by ? `Added by ${a.by}` : '', a.source === 'ai' ? 'Saved by your AI' : ''].filter(Boolean).join(' · ')}</Text>
            </View>
            {as.hasSource(a.kind) && (
              <IconButton
                icon={source ? 'eye' : 'code'}
                label={source ? 'Show the preview' : 'Show the source'}
                onPress={() => setSource(!source)}
                disabled={!ready}
                color='#fff'
                ripple='rgba(255,255,255,0.2)'
              />
            )}
            <IconButton icon='share-alt' label='Share or open in another app' onPress={share} disabled={!ready} color='#fff' ripple='rgba(255,255,255,0.2)' />
            {a.canDelete && <IconButton icon='trash' label='Remove from Assets' onPress={() => onRemove(a)} color='#fff' ripple='rgba(255,255,255,0.2)' />}
            <IconButton icon='ellipsis-v' label='More options' onPress={() => onMenu(a)} color='#fff' ripple='rgba(255,255,255,0.2)' />
          </View>
          <View style={s.stage}>
            {body}
            {many && (a.kind === 'image') && (
              <>
                <Pressable style={[s.side, s.sideLeft]} onPress={() => onStep(-1)} accessibilityRole='button' accessibilityLabel='Previous file' />
                <Pressable style={[s.side, s.sideRight]} onPress={() => onStep(1)} accessibilityRole='button' accessibilityLabel='Next file' />
              </>
            )}
          </View>
          {canEdit ? (
            <TextInput
              style={s.caption}
              value={caption}
              onChangeText={setCaption}
              onEndEditing={saveCaption}
              onSubmitEditing={saveCaption}
              placeholder='Add a caption'
              placeholderTextColor='rgba(255,255,255,0.45)'
              maxLength={as.MAX_CAPTION}
              returnKeyType='done'
            />
          ) : a.caption ? <Text style={s.captionText}>{a.caption}</Text> : null}
          {a.folder || a.tags?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.viewerTagsRow} contentContainerStyle={s.viewerTags}>
              {a.folder ? (
                <View style={s.viewerFolder}>
                  <Icon name='folder' size={11} color='rgba(255,255,255,0.7)' />
                  <Text style={s.viewerFolderText} numberOfLines={1}>{crumbs(a.folder)}</Text>
                </View>
              ) : null}
              {(a.tags || []).map((x) => (
                <Pressable key={x} style={s.viewerTag} onPress={() => onTag(x)} accessibilityRole='button' accessibilityLabel={`Show files tagged ${x}`}>
                  <Text style={s.viewerTagText}>#{x}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {a.ai?.length ? <View style={s.viewerOrigins}><AiOrigins list={a.ai} apps={call} onOpenJob={onOpenJob} onOpenChat={onOpenChat} dark /></View> : null}
        </SafeAreaView>
      )}
      {children}
    </Modal>
  )
}

// Video and audio play in a WebView from the file in this phone's cache. `uri` is already a URL
// (expo-file-system escapes the name), so it goes in as it is: escaping it again would ask for a
// file that isn't there. One the WebView can't play says so, with the file to open elsewhere.
function Player ({ a, uri, onFailed }: { a: AssetRecord; uri: string; onFailed: (why: string) => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const name = uri.split('/').pop() || ''
  const html = useMemo(() => {
    const src = uri.replace(/"/g, '%22').replace(/</g, '%3C')
    const media = a.kind === 'video'
      ? `<video src="${src}" controls playsinline preload="metadata"></video>`
      : `<div class="icon">♪</div><audio src="${src}" controls preload="metadata"></audio>`
    const fail = `<script>document.querySelector('video,audio').addEventListener('error',function(){window.ReactNativeWebView.postMessage(JSON.stringify({type:'failed'}))})</script>`
    return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;color:#fff;font-family:sans-serif}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}video{max-width:100%;max-height:100%}audio{width:90%}.icon{font-size:56px;opacity:.7}</style>${media}${fail}`
  }, [a.kind, uri])
  const cantPlay = `This phone can’t play this ${a.kind === 'video' ? 'video' : 'recording'} here. Open it in another app.`
  const page = useMemo(() => {
    const dir = uri.slice(0, uri.length - name.length)
    const f = new File(dir + 'player.html')
    if (f.exists) f.delete()
    f.create()
    f.write(html)
    return f.uri
  }, [uri, name, html])
  return (
    <WebView
      containerStyle={s.webBox}
      style={s.player}
      source={{ uri: page }}
      originWhitelist={['file://*']}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows={false}
      onError={() => onFailed(cantPlay)}
      onMessage={(e) => {
        try { if (JSON.parse(e.nativeEvent.data).type === 'failed') onFailed(cantPlay) } catch {}
      }}
    />
  )
}

// The file in this phone's cache (written by the backend a piece at a time), reused while it's
// there and whole. A big file, or one still coming from another Device, takes longer than one call
// may wait, so this asks again until it's all there, passing on how far it got.
// -> its file: URI, or null until it has replicated here.
interface ReadTo { size: number; written: number; done: boolean }
async function fetchFile (call: Backend['apps'], a: AssetRecord, { onProgress, gone }: { onProgress?: (bytes: number) => void; gone?: () => boolean } = {}): Promise<string | null> {
  const target = cachedFile(a.id, a.name)
  if (target.exists && target.size === a.bytes) return target.uri
  for (;;) {
    const res = await call<ReadTo | null>('assets', 'readTo', { id: a.id, to: target.uri, wait: 8000 })
    if (!res.ok) throw new Error(res.message || 'Couldn’t get the file')
    if (!res.value) return null
    if (res.value.done) return target.uri
    if (gone?.()) return null // the copy goes on in the backend, for next time
    onProgress?.(res.value.written)
  }
}

// An HTML file runs in a WebView as a string, never as a file: it gets no file access and no
// origin of its own, the preview policy (as.withPreviewCsp: no network but OpenStreetMap's tiles,
// no forms) is the first thing in it, and it can't navigate anywhere or open windows.
function PageView ({ html }: { html: string }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const page = useMemo(() => as.withPreviewCsp(html), [html])
  return (
    <WebView
      containerStyle={s.webBox}
      style={[s.player, { backgroundColor: '#fff' }]}
      source={{ html: page, baseUrl: 'about:blank' }}
      // Every URL comes to the check below (one off the list would go to another app), which lets
      // nothing but the page itself load.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={(req) => /^(about:|data:)/.test(req.url)}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      mixedContentMode='never'
      cacheEnabled={false}
      incognito
      geolocationEnabled={false}
      mediaPlaybackRequiresUserAction
    />
  )
}

// A text file bigger than this opens in another app.
const MAX_TEXT_FILE = 8 * 1024 * 1024

// A PDF or an e-book in the viewer page (lib/docViewerHtml.ts: pdf.js, and the reader desktop's
// nomad://assets uses), which reads the file from this phone's cache. The page is written once per
// version of it, next to the cached files.
function DocView ({ a, uri, onFailed }: { a: AssetRecord; uri: string; onFailed: (why: string) => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const page = useMemo(() => {
    const f = new File(new Directory(Paths.cache, 'assets'), `viewer-${docViewerHtml.length.toString(36)}.html`)
    if (!f.exists) {
      f.create({ intermediates: true })
      f.write(docViewerHtml)
    }
    return f.uri
  }, [])
  const theme = JSON.stringify({ scheme: t.scheme, bg: t.surface, text: t.text, link: t.accent })
  const src = `${page}?kind=${a.kind === 'pdf' ? 'pdf' : 'book'}&key=${encodeURIComponent(a.id)}&file=${encodeURIComponent(uri)}&theme=${encodeURIComponent(theme)}`
  const what = a.kind === 'pdf' ? 'PDF' : 'book'
  // The page says each step it takes (phone-viewer.js). Until a PDF's first page is drawn (a book's
  // first screen), going quiet for VIEWER_QUIET_MS means it's stuck: say so, with the file to open
  // elsewhere, and keep the last step in the log.
  const last = useRef('nothing yet')
  const done = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quiet = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    if (done.current) return
    timer.current = setTimeout(() => {
      console.warn('[assets] the viewer stopped', a.kind, 'after', last.current)
      onFailed(`This ${what} didn’t open here (it stopped after: ${last.current}). Open it in another app.`)
    }, VIEWER_QUIET_MS)
  }, [a.kind, what, onFailed])
  useEffect(() => {
    done.current = false
    last.current = 'nothing yet'
    quiet()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [src, quiet])
  const finish = () => { done.current = true; if (timer.current) clearTimeout(timer.current) }
  return (
    <WebView
      containerStyle={s.webBox}
      style={a.kind === 'book' ? [s.player, { backgroundColor: t.surface }] : s.player}
      source={{ uri: src }}
      originWhitelist={['file://*']}
      allowFileAccess
      allowFileAccessFromFileURLs
      setSupportMultipleWindows={false}
      setBuiltInZoomControls={a.kind === 'pdf'}
      setDisplayZoomControls={false}
      onError={(e) => {
        finish()
        console.warn('[assets] the viewer didn’t load', e.nativeEvent.description)
        onFailed(`This ${what} couldn’t open here (${e.nativeEvent.description || 'the viewer didn’t load'}). Open it in another app.`)
      }}
      onRenderProcessGone={(e) => {
        // Android ends a WebView's renderer that runs out of memory; the view goes blank without it.
        finish()
        console.warn('[assets] the viewer closed', e.nativeEvent.didCrash ? '(crashed)' : '(out of memory)')
        onFailed(`This ${what} was too much for this phone to show here. Open it in another app.`)
      }}
      onMessage={(e) => {
        let msg: { type?: string; step?: string; message?: string; [k: string]: unknown }
        try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
        if (msg.type === 'step') {
          const { type: _t, step, ...more } = msg
          last.current = Object.keys(more).length ? `${step} ${JSON.stringify(more)}` : String(step)
          console.log('[assets] viewer', a.kind, last.current)
          if (step === 'page' || (a.kind !== 'pdf' && step === 'ready')) finish()
          else quiet()
        } else if (msg.type === 'ready') {
          if (a.kind !== 'pdf') finish()
        } else if (msg.type === 'error') {
          console.warn('[assets] viewer error', a.kind, msg.message)
        } else if (msg.type === 'failed') {
          finish()
          console.warn('[assets] viewer failed', a.kind, msg.message)
          onFailed(String(msg.message))
        }
      }}
    />
  )
}

const VIEWER_QUIET_MS = 30000 // a PDF or book page silent this long, before it shows anything, is stuck

// Two fingers on the grid: apart zooms in (fewer, bigger tiles), together zooms out, a step each
// time their distance changes by PINCH_STEP. One finger is left to the list to scroll.
function usePinch (zoom: (step: number) => void) {
  const from = useRef(0)
  return useMemo(() => {
    const spread = (e: GestureResponderEvent) => {
      const [a, b] = e.nativeEvent.touches
      return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0
    }
    const two = (e: GestureResponderEvent) => e.nativeEvent.touches.length >= 2
    return {
      onStartShouldSetResponderCapture: two,
      onMoveShouldSetResponderCapture: two,
      onResponderGrant: (e: GestureResponderEvent) => { from.current = spread(e) },
      onResponderMove: (e: GestureResponderEvent) => {
        const d = spread(e)
        if (!d) return
        if (!from.current) { from.current = d; return }
        if (d / from.current >= PINCH_STEP) { zoom(1); from.current = d } else if (from.current / d >= PINCH_STEP) { zoom(-1); from.current = d }
      },
      onResponderTerminationRequest: () => false,
      onResponderRelease: () => { from.current = 0 },
      onResponderTerminate: () => { from.current = 0 }
    }
  }, [zoom])
}

function Card ({ a, why, onOpen }: { a: AssetRecord; why: string; onOpen?: () => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={s.card}>
      <Icon name={iconOf(a)} size={46} color='rgba(255,255,255,0.75)' />
      <Text style={s.cardName}>{a.name}</Text>
      <Text style={s.cardSub}>{describe(a)}. {why}</Text>
      {onOpen && (
        <Pressable style={[s.btn, s.btnPrimary]} onPress={onOpen} accessibilityRole='button'>
          <Text style={s.btnPrimaryText}>Open in another app</Text>
        </Pressable>
      )}
    </View>
  )
}

function kindColor (t: Theme, kind: string) {
  const dark = t.scheme === 'dark'
  const c: Record<string, [string, string]> = {
    image: ['#0e9f6e', '#3dd598'],
    video: ['#d9480f', '#ff8a4c'],
    audio: ['#9c36b5', '#d38cf0'],
    pdf: ['#d6336c', '#ff7aa2'],
    book: ['#a0612a', '#e3a66b'],
    markdown: ['#4263eb', '#8ea5ff'],
    text: ['#4263eb', '#8ea5ff'],
    document: ['#4263eb', '#8ea5ff'],
    data: ['#2b8a3e', '#69db7c'],
    code: ['#5f3dc4', '#b197fc'],
    html: ['#0b7285', '#3bc9db']
  }
  const pair = c[kind] || ['#6b6f80', '#a3a7b7']
  return dark ? pair[1] : pair[0]
}

const VIEWABILITY = { itemVisiblePercentThreshold: 1 }

// FlatList wants one onViewableItemsChanged for its life: keep the latest loader in a ref.
function useViewable (load: (items: AssetRecord[]) => void) {
  const ref = useRef(load)
  ref.current = load
  return useRef(({ viewableItems }: { viewableItems: { item: Row }[] }) => {
    const items: AssetRecord[] = []
    for (const v of viewableItems) {
      if (v.item.kind === 'assets') items.push(...v.item.assets)
      else if (v.item.kind === 'line') items.push(v.item.asset)
    }
    if (items.length) ref.current(items)
  }).current
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    page: { padding: sp.lg, paddingTop: sp.sm, paddingBottom: 48 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    errText: { color: t.danger, fontSize: 13, lineHeight: 19 },
    notice: { alignItems: 'center', padding: sp.xl, marginTop: sp.xl, gap: sp.sm },
    noticeTitle: { color: t.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: sp.sm },
    noticeBody: { color: t.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    btn: { borderRadius: radius.pill, paddingHorizontal: 20, minHeight: 40, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, marginTop: sp.md },
    btnText: { color: t.text, fontSize: 14, fontWeight: '600' },
    btnPrimary: { backgroundColor: t.accent, borderColor: t.accent },
    btnPrimaryText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    chips: { gap: 6, paddingVertical: sp.sm },
    chip: { borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 34, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, backgroundColor: t.surface },
    chipOn: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { color: t.text, fontSize: 13, fontWeight: '500' },
    chipTextOn: { color: t.onAccent },
    chipCount: { color: t.textMuted },
    hint: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    hintText: { color: t.textMuted, fontSize: 12 },
    month: { color: t.text, fontSize: 15, fontWeight: '700', marginTop: sp.md, marginBottom: sp.sm },
    monthCount: { color: t.textMuted, fontWeight: '400' },
    grow: { flex: 1 },
    row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
    line: { flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: 56, paddingVertical: 4 },
    lineThumb: { width: 48, height: 48, borderRadius: 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt },
    linePlay: { position: 'absolute', left: 3, bottom: 3, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
    lineText: { flex: 1, minWidth: 0 },
    lineName: { color: t.text, fontSize: 14, fontWeight: '500' },
    lineSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    tile: { borderRadius: 4, overflow: 'hidden', backgroundColor: t.surfaceAlt },
    docTile: { backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    docFace: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: t.surfaceAlt },
    ext: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
    extBig: { fontSize: 13 },
    docName: { color: t.text, fontSize: 11, paddingHorizontal: 6, paddingVertical: 5 },
    docNameBig: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
    thumb: { width: '100%', height: '100%' },
    play: { position: 'absolute', left: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    playText: { color: '#fff', fontSize: 10 },
    ai: { position: 'absolute', right: 4, top: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent },
    viewer: { flex: 1, backgroundColor: '#000' },
    viewerBar: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 4 },
    viewerMeta: { flex: 1, paddingHorizontal: 8 },
    viewerTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
    viewerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    full: { width: '100%', height: '100%' },
    fetching: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
    fetchingNote: { position: 'absolute', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.45)' },
    fetchingText: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
    player: { width: '100%', flex: 1, alignSelf: 'stretch', backgroundColor: '#000' },
    // On Android, WebView's `style` sizes the page inside a View of its own, which has only
    // flex: 1. In the centered stage that View shrank to no width at all, and the page laid out
    // 0 wide: the PDF, page or video drew, and nothing showed. `containerStyle` sizes that View.
    webBox: { flex: 1, alignSelf: 'stretch' },
    paper: { alignSelf: 'stretch', flex: 1, backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
    paperBody: { padding: sp.lg, paddingBottom: 40 },
    code: { color: t.text, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19 },
    card: { alignItems: 'center', gap: 10, maxWidth: 320, padding: sp.xl, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)' },
    cardName: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
    cardSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 19, textAlign: 'center' },
    side: { position: 'absolute', top: 0, bottom: 0, width: '30%' },
    sideLeft: { left: 0 },
    sideRight: { right: 0 },
    viewerOrigins: { alignItems: 'center', paddingBottom: sp.sm },
    caption: { color: '#fff', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.md, marginHorizontal: sp.lg, marginVertical: sp.md, paddingHorizontal: sp.md, minHeight: 44, fontSize: 15, textAlign: 'center' },
    captionText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, textAlign: 'center', margin: sp.lg },
    // A ScrollView grows by default: this row keeps its own height, so the picture keeps the rest.
    viewerTagsRow: { flexGrow: 0 },
    viewerTags: { gap: 6, paddingHorizontal: sp.lg, paddingBottom: sp.md, alignItems: 'center' },
    viewerFolder: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 4 },
    viewerFolderText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
    viewerTag: { borderRadius: radius.pill, paddingHorizontal: 10, minHeight: 28, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
    viewerTagText: { color: '#fff', fontSize: 12 },
    // Folders, tags and selection
    crumbs: { alignItems: 'center', gap: 2, paddingTop: sp.xs },
    crumbPart: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    crumb: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, minHeight: 32, borderRadius: radius.sm },
    crumbText: { color: t.textDim, fontSize: 13 },
    crumbHere: { color: t.text, fontWeight: '600' },
    tagChips: { gap: 6, paddingBottom: sp.sm },
    tagChip: { borderRadius: radius.pill, paddingHorizontal: 12, minHeight: 30, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    tagChipText: { color: t.textDim, fontSize: 12.5 },
    folders: { marginTop: sp.sm, marginBottom: 0 },
    folderLead: { width: 32, alignItems: 'center' },
    emptyHere: { marginTop: sp.xl },
    tileBody: { flex: 1 },
    tileBodyPicked: { transform: [{ scale: 0.86 }], borderRadius: 6, overflow: 'hidden' },
    pick: { position: 'absolute', left: 6, top: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
    pickOn: { backgroundColor: t.accent, borderColor: t.accent },
    pickLine: { position: 'relative', left: 0, top: 0, borderColor: t.textMuted },
    linePicked: { backgroundColor: t.surfaceAlt, borderRadius: radius.sm },
    sheet: { paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.sm },
    sheetTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
    sheetLabel: { color: t.textMuted, fontSize: 13 },
    sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: sp.sm },
    input: { color: t.text, backgroundColor: t.bg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: sp.md, minHeight: 46, fontSize: 15 },
    folderList: { maxHeight: 320, marginHorizontal: -sp.lg },
    folderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingRight: sp.lg },
    folderRowOn: { backgroundColor: t.accent },
    folderRowText: { color: t.text, fontSize: 15, flex: 1 },
    folderRowTextOn: { color: t.onAccent },
    folderNow: { color: t.textMuted, fontSize: 12 },
    newFolder: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    newFolderInput: { flex: 1 },
    tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
    tagPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 12, minHeight: 34, backgroundColor: t.surfaceAlt },
    tagPillOff: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    tagPillNew: { backgroundColor: t.accent },
    tagPillText: { color: t.text, fontSize: 13 },
    tagPillTextOff: { color: t.textMuted, textDecorationLine: 'line-through' },
    offer: { gap: 6 }
  })
}
