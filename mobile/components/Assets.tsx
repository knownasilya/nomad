import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, FlatList, Image, Pressable, ScrollView, ActivityIndicator, Alert, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { File } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTheme, radius, space as sp, type Theme } from '../lib/theme'
import type { Backend, AssetRecord, AssetsList } from '../lib/useBackend'
import { pickMedia, pickFiles, prepare, cacheFile, type PickedFile } from '../lib/assetFiles'
import * as as from '../lib/assetRules'
import ActionSheet from './ActionSheet'
import IconButton from './IconButton'
import Icon, { type IconName } from './Icon'
import LinkPhone from './LinkPhone'
import Markdown from './Markdown'
import ScreenHeader from './ScreenHeader'

interface Props {
  visible: boolean
  onClose: () => void
  openAssetId?: string // a file to open, e.g. from a link in an AI answer
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space?: string // the active Space's Root Drive key: its Assets
  spaceName?: string
  onOpenDevices: () => void
  onOpenLibrary: () => void // My Library, where a Space is shared or a home set up
}

// A Space's Assets (ADR-0044): every file it keeps, newest first by month, filtered by kind, and
// Add from the gallery, the camera or the file picker. A photo is scaled here (lib/assetFiles.ts),
// the same sizes as desktop's nomad://assets; any other file is kept as it is. Tap one to see it:
// pictures, video and audio play here, Markdown and text show as text, and anything else opens in
// another app. In a shared Space a file shows who added it, and its adder, or the Space's owner,
// can remove it; in any other Space they are the user's own.

const COLUMNS = 3
const GAP = 3
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type Row = { kind: 'month'; key: string; label: string; count: number } | { kind: 'assets'; key: string; assets: AssetRecord[] }

function rowsOf (assets: AssetRecord[]): Row[] {
  const months = new Map<string, AssetRecord[]>()
  for (const a of assets) {
    const d = new Date(a.takenAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months.has(key)) months.set(key, [])
    months.get(key)!.push(a)
  }
  const rows: Row[] = []
  for (const [key, list] of months) {
    const d = new Date(list[0].takenAt)
    rows.push({ kind: 'month', key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, count: list.length })
    for (let i = 0; i < list.length; i += COLUMNS) rows.push({ kind: 'assets', key: `${key}:${i}`, assets: list.slice(i, i + COLUMNS) })
  }
  return rows
}

const whenText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
const describe = (a: AssetRecord) => [as.KIND_LABELS[a.kind] || 'File', as.formatBytes(a.bytes), a.duration ? as.formatDuration(a.duration) : ''].filter(Boolean).join(' · ')
const iconOf = (a: AssetRecord) => (as.KIND_ICONS[a.kind] || 'file') as IconName
// A picture with no thumbnail (the AI saved a GIF) shows itself in the grid up to this size.
const SMALL_PICTURE = 3 * 1024 * 1024
const hasPicture = (a: AssetRecord) => !!a.thumb || (a.kind === 'image' && a.bytes <= SMALL_PICTURE && a.mime !== 'image/svg+xml')

export default function Assets ({ visible, onClose, openAssetId, apps, onVaultChange, space, spaceName, onOpenDevices, onOpenLibrary }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const { width } = useWindowDimensions()
  const tile = Math.floor((width - sp.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS)
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args = {}) => appsRef.current(app, action, { space, ...args })) as Backend['apps'], [space])
  const [list, setList] = useState<AssetsList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const asked = useRef(new Set<string>())
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const place = spaceName || 'this Space'

  const refresh = useCallback(async () => {
    const res = await call<AssetsList>('assets', 'list')
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load the files'); return }
    setError('')
    setList(res.value)
  }, [call])

  useEffect(() => { if (visible) refresh() }, [visible, refresh])
  useEffect(() => { if (visible) return onVaultChange(refresh) }, [visible, onVaultChange, refresh])
  // A Space switch starts over.
  useEffect(() => { setThumbs({}); asked.current.clear(); setOpen(null); setFilter('all') }, [space])
  useEffect(() => { if (visible && openAssetId) setOpen(openAssetId) }, [visible, openAssetId])

  // Thumbnails load as their rows show. One not replicated yet is asked for again on the next change.
  const loadThumbs = useCallback((items: AssetRecord[]) => {
    for (const a of items) {
      if (!hasPicture(a) || asked.current.has(a.id)) continue
      asked.current.add(a.id)
      call<string | null>('assets', 'read', { id: a.id, thumb: !!a.thumb }).then((res) => {
        if (res.ok && res.value) setThumbs((m) => ({ ...m, [a.id]: `data:${a.thumb ? 'image/jpeg' : a.mime};base64,` + res.value }))
        else setTimeout(() => asked.current.delete(a.id), 5000)
      })
    }
  }, [call])

  const onViewable = useViewable(loadThumbs)
  const all = list?.assets || []
  const shown = useMemo(() => as.filterAssets(all, { filter }), [all, filter])
  const rows = useMemo(() => rowsOf(shown), [shown])
  const current = open ? all.find((a) => a.id === open) || null : null
  const counts = useMemo(() => new Map(as.FILTERS.map((f) => [f.id, as.filterAssets(all, { filter: f.id }).length])), [all])

  const step = (n: number) => {
    const i = shown.findIndex((a) => a.id === open)
    if (i >= 0 && shown.length > 1) setOpen(shown[(i + n + shown.length) % shown.length].id)
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
    for (let i = 0; i < picked.length; i++) {
      try {
        const asset = await prepare(picked[i])
        const res = await call('assets', 'add', { asset })
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

  const canAdd = !!list?.canAdd
  const count = all.length

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={() => (open ? setOpen(null) : onClose())} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Assets'
          subtitle={adding ? `Adding ${Math.min(adding.done + 1, adding.total)} of ${adding.total}…` : list ? `${place} · ${count} file${count === 1 ? '' : 's'}` : undefined}
          onBack={onClose}
          actions={canAdd ? [{ icon: 'plus', label: 'Add files', onPress: () => setAddMenu(true), busy: !!adding }] : undefined}
        />

        {noVault ? (
          <LinkPhone what='Assets' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !list ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : !count ? (
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
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={s.page}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={VIEWABILITY}
            ListHeaderComponent={
              <>
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
                {!list.shared && (
                  <View style={s.hint}>
                    <Icon name='lock' size={13} color={t.textMuted} />
                    <Text style={s.hintText}>Only you see these, on your own devices.</Text>
                  </View>
                )}
              </>
            }
            ListEmptyComponent={<Text style={s.noticeBody}>No files of this kind.</Text>}
            renderItem={({ item }) => item.kind === 'month' ? (
              <Text style={s.month} accessibilityRole='header'>{item.label} <Text style={s.monthCount}>{item.count}</Text></Text>
            ) : (
              <View style={s.row}>
                {item.assets.map((a) => (
                  <Pressable
                    key={a.id}
                    style={[s.tile, { width: tile, height: tile }, !hasPicture(a) && s.docTile]}
                    onPress={() => setOpen(a.id)}
                    accessibilityRole='button'
                    accessibilityLabel={`${a.name}, ${as.KIND_LABELS[a.kind] || 'File'}, ${whenText(a.takenAt)}${a.by ? `, added by ${a.by}` : ''}${a.source === 'ai' ? ', saved by your AI' : ''}`}
                  >
                    {hasPicture(a) ? (
                      thumbs[a.id] ? <Image source={{ uri: thumbs[a.id] }} style={s.thumb} /> : null
                    ) : (
                      <>
                        <View style={s.docFace}>
                          <Icon name={iconOf(a)} size={28} color={kindColor(t, a.kind)} />
                          <Text style={[s.ext, { color: kindColor(t, a.kind) }]}>{as.extOf(a.name).toUpperCase() || as.KIND_LABELS[a.kind]}</Text>
                        </View>
                        <Text style={s.docName} numberOfLines={1}>{a.name}</Text>
                      </>
                    )}
                    {a.kind === 'video' && (
                      <View style={s.play}><Icon name='play' size={9} color='#fff' /><Text style={s.playText}>{a.duration ? as.formatDuration(a.duration) : ''}</Text></View>
                    )}
                    {a.source === 'ai' && <View style={s.ai}><Icon name='magic' size={9} color='#fff' /></View>}
                  </Pressable>
                ))}
              </View>
            )}
          />
        )}

        <ActionSheet
          visible={addMenu}
          onClose={() => setAddMenu(false)}
          title={`Add to ${place}’s Assets`}
          groups={[[
            { label: 'Photos and videos', icon: 'images', onPress: () => add('library') },
            { label: 'Take a photo', icon: 'camera', onPress: () => add('camera') },
            { label: 'Files', icon: 'folder-open', onPress: () => add('files') }
          ]]}
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
        />
      </SafeAreaView>
    </Modal>
  )
}

// One file, big: a picture, a player, the text, or a card that opens it in another app.
function Viewer ({ asset, many, canEdit, thumb, call, onClose, onStep, onRemove, onSaved }: {
  asset: AssetRecord | null
  many: boolean
  canEdit: boolean
  thumb?: string
  call: Backend['apps']
  onClose: () => void
  onStep: (n: number) => void
  onRemove: (a: AssetRecord) => void
  onSaved: () => void
}) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [file, setFile] = useState<{ id: string; uri: string; data: string } | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState('')
  const [caption, setCaption] = useState('')
  const id = asset?.id

  useEffect(() => {
    setFile(null); setText(null); setFailed('')
    setCaption(asset?.caption || '')
    if (!asset) return
    let gone = false
    call<string | null>('assets', 'read', { id: asset.id }).then(async (res) => {
      if (gone) return
      if (!res.ok || !res.value) { setFailed(res.message || 'This file hasn’t reached this phone yet. Try again in a moment.'); return }
      try {
        const uri = cacheFile(asset.id, asset.name, res.value)
        setFile({ id: asset.id, uri, data: res.value })
        if (as.isTextKind(asset.kind)) {
          const body = await new File(uri).text()
          if (!gone) setText(body.length > as.MAX_TEXT_PREVIEW ? body.slice(0, as.MAX_TEXT_PREVIEW) : body)
        }
      } catch (err) {
        if (!gone) setFailed((err as Error)?.message || String(err))
      }
    })
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
    if (failed) body = <Card a={a} why={failed} />
    else if (!ready) body = thumb ? <Image source={{ uri: thumb }} style={s.full} resizeMode='contain' /> : <ActivityIndicator color='#fff' />
    else if (a.kind === 'image') body = <Image source={{ uri: `data:${a.mime};base64,${file!.data}` }} style={s.full} resizeMode='contain' />
    else if (a.kind === 'video' || a.kind === 'audio') body = <Player a={a} uri={file!.uri} />
    else if (as.isTextKind(a.kind)) {
      body = text == null
        ? <ActivityIndicator color='#fff' />
        : (
          <ScrollView style={s.paper} contentContainerStyle={s.paperBody}>
            {a.kind === 'markdown'
              ? <Markdown text={text} color={t.text} />
              : <Text style={s.code} selectable>{text}</Text>}
          </ScrollView>
          )
    } else body = <Card a={a} why={a.kind === 'pdf' ? 'Open it in a PDF app on this phone.' : 'There’s no preview for this kind of file here. Open it in another app.'} onOpen={share} />
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
            <IconButton icon='share-alt' label='Share or open in another app' onPress={share} disabled={!ready} color='#fff' ripple='rgba(255,255,255,0.2)' />
            {a.canDelete && <IconButton icon='trash' label='Remove from Assets' onPress={() => onRemove(a)} color='#fff' ripple='rgba(255,255,255,0.2)' />}
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
        </SafeAreaView>
      )}
    </Modal>
  )
}

// Video and audio play in a WebView from the file in this phone's cache.
function Player ({ a, uri }: { a: AssetRecord; uri: string }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const name = uri.split('/').pop() || ''
  const html = useMemo(() => {
    const src = encodeURI(name).replace(/"/g, '%22')
    const media = a.kind === 'video'
      ? `<video src="${src}" controls playsinline preload="metadata"></video>`
      : `<div class="icon">♪</div><audio src="${src}" controls preload="metadata"></audio>`
    return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;color:#fff;font-family:sans-serif}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}video{max-width:100%;max-height:100%}audio{width:90%}.icon{font-size:56px;opacity:.7}</style>${media}`
  }, [a.kind, name])
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
      style={s.player}
      source={{ uri: page }}
      originWhitelist={['file://*']}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows={false}
    />
  )
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
    markdown: ['#4263eb', '#8ea5ff'],
    text: ['#4263eb', '#8ea5ff'],
    document: ['#4263eb', '#8ea5ff'],
    data: ['#2b8a3e', '#69db7c'],
    code: ['#5f3dc4', '#b197fc']
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
    for (const v of viewableItems) if (v.item.kind === 'assets') items.push(...v.item.assets)
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
    row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
    tile: { borderRadius: 4, overflow: 'hidden', backgroundColor: t.surfaceAlt },
    docTile: { backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    docFace: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: t.surfaceAlt },
    ext: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
    docName: { color: t.text, fontSize: 11, paddingHorizontal: 6, paddingVertical: 5 },
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
    player: { width: '100%', flex: 1, backgroundColor: '#000' },
    paper: { alignSelf: 'stretch', flex: 1, backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
    paperBody: { padding: sp.lg, paddingBottom: 40 },
    code: { color: t.text, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19 },
    card: { alignItems: 'center', gap: 10, maxWidth: 320, padding: sp.xl, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)' },
    cardName: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
    cardSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 19, textAlign: 'center' },
    side: { position: 'absolute', top: 0, bottom: 0, width: '30%' },
    sideLeft: { left: 0 },
    sideRight: { right: 0 },
    caption: { color: '#fff', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.md, marginHorizontal: sp.lg, marginVertical: sp.md, paddingHorizontal: sp.md, minHeight: 44, fontSize: 15, textAlign: 'center' },
    captionText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, textAlign: 'center', margin: sp.lg }
  })
}
