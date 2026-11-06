import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, FlatList, Image, Pressable, ActivityIndicator, Alert, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, space as sp, type Theme } from '../lib/theme'
import type { Backend, AlbumPhotoRecord, PhotosList } from '../lib/useBackend'
import { pickAlbumPhotos, scaleAlbumPhoto } from '../lib/pickImages'
import ActionSheet from './ActionSheet'
import IconButton from './IconButton'
import Icon from './Icon'
import LinkPhone from './LinkPhone'
import ScreenHeader from './ScreenHeader'

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space?: string // the active Space's Root Drive key: the album is this Space's, when it is shared
  spaceName?: string
  onOpenDevices: () => void
  onOpenLibrary: () => void // My Library, where a Space is shared or a home set up
}

// The family album of a shared Space (ADR-0043): the photos everyone in it added, newest first by
// month, and Add photos from the camera or the gallery. A photo is scaled here (pickImages.ts
// scaleAlbumPhoto) before it goes in, the same sizes as desktop's nomad://photos. Tap one to see it
// big, with who added it; its adder, or the Space's owner, can remove it.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const COLUMNS = 3
const GAP = 3

type Row = { kind: 'month'; key: string; label: string; count: number } | { kind: 'photos'; key: string; photos: AlbumPhotoRecord[] }

function rowsOf (photos: AlbumPhotoRecord[]): Row[] {
  const months = new Map<string, AlbumPhotoRecord[]>()
  for (const p of photos) {
    const d = new Date(p.takenAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!months.has(key)) months.set(key, [])
    months.get(key)!.push(p)
  }
  const rows: Row[] = []
  for (const [key, list] of months) {
    const d = new Date(list[0].takenAt)
    rows.push({ kind: 'month', key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, count: list.length })
    for (let i = 0; i < list.length; i += COLUMNS) rows.push({ kind: 'photos', key: `${key}:${i}`, photos: list.slice(i, i + COLUMNS) })
  }
  return rows
}

const whenText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })

export default function Photos ({ visible, onClose, apps, onVaultChange, space, spaceName, onOpenDevices, onOpenLibrary }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const { width } = useWindowDimensions()
  const tile = Math.floor((width - sp.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS)
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args = {}) => appsRef.current(app, action, { space, ...args })) as Backend['apps'], [space])
  const [list, setList] = useState<PhotosList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const asked = useRef(new Set<string>())
  const [open, setOpen] = useState<string | null>(null)
  const [big, setBig] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const [caption, setCaption] = useState('')
  const place = spaceName || 'this Space'

  const refresh = useCallback(async () => {
    const res = await call<PhotosList>('photos', 'list')
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load the photos'); return }
    setError('')
    setList(res.value)
  }, [call])

  useEffect(() => { if (visible) refresh() }, [visible, refresh])
  useEffect(() => { if (visible) return onVaultChange(refresh) }, [visible, onVaultChange, refresh])
  // A Space switch starts over.
  useEffect(() => { setThumbs({}); setBig({}); asked.current.clear(); setOpen(null) }, [space])

  // Thumbnails load as their rows show. One not replicated yet is asked for again on the next change.
  const loadThumbs = useCallback((ids: string[]) => {
    for (const id of ids) {
      if (asked.current.has(id)) continue
      asked.current.add(id)
      call<string | null>('photos', 'read', { id, thumb: true }).then((res) => {
        if (res.ok && res.value) setThumbs((m) => ({ ...m, [id]: 'data:image/jpeg;base64,' + res.value }))
        else setTimeout(() => asked.current.delete(id), 5000)
      })
    }
  }, [call])

  const onViewable = useViewable(loadThumbs)
  const photos = list?.photos || []
  const rows = useMemo(() => rowsOf(photos), [photos])
  const current = open ? photos.find((p) => p.id === open) || null : null

  const openPhoto = (p: AlbumPhotoRecord) => {
    setOpen(p.id)
    setCaption(p.caption || '')
    if (!big[p.id]) {
      call<string | null>('photos', 'read', { id: p.id }).then((res) => {
        if (res.ok && res.value) setBig((m) => ({ ...m, [p.id]: 'data:image/jpeg;base64,' + res.value }))
      })
    }
  }
  const step = (n: number) => {
    const i = photos.findIndex((p) => p.id === open)
    if (i >= 0 && photos.length > 1) openPhoto(photos[(i + n + photos.length) % photos.length])
  }

  const add = async (source: 'camera' | 'library') => {
    let picked
    try {
      picked = await pickAlbumPhotos(source)
    } catch (err) {
      Alert.alert('Couldn’t add photos', (err as Error)?.message || String(err))
      return
    }
    if (!picked.length) return
    setAdding({ done: 0, total: picked.length })
    let failed = 0
    let last = ''
    for (let i = 0; i < picked.length; i++) {
      try {
        const photo = await scaleAlbumPhoto(picked[i])
        const res = await call('photos', 'add', { photo })
        if (!res.ok) throw new Error(res.message || 'Unknown error')
      } catch (err) {
        failed++
        last = (err as Error)?.message || String(err)
      }
      setAdding({ done: i + 1, total: picked.length })
    }
    setAdding(null)
    refresh()
    if (failed) Alert.alert(failed === picked.length ? 'Couldn’t add the photos' : `${failed} of ${picked.length} weren’t added`, last)
  }

  const saveCaption = async () => {
    if (!current || (current.caption || '') === caption.trim()) return
    const res = await call('photos', 'caption', { id: current.id, caption: caption.trim() })
    if (!res.ok) Alert.alert('Couldn’t save the caption', res.message || 'Unknown error')
    refresh()
  }

  const remove = (p: AlbumPhotoRecord) => {
    Alert.alert('Remove this photo?', `It goes from ${place}’s album, for everyone in it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const res = await call('photos', 'delete', { id: p.id })
          if (!res.ok) { Alert.alert('Couldn’t remove it', res.message || 'Unknown error'); return }
          setOpen(null)
          refresh()
        }
      }
    ])
  }

  const canAdd = !!list?.shared && !!list.canAdd

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={() => (open ? setOpen(null) : onClose())} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Photos'
          subtitle={adding ? `Adding ${Math.min(adding.done + 1, adding.total)} of ${adding.total}…` : list?.shared ? `${place} · ${photos.length} photo${photos.length === 1 ? '' : 's'}` : undefined}
          onBack={onClose}
          actions={canAdd ? [{ icon: 'plus', label: 'Add photos', onPress: () => setAddMenu(true), busy: !!adding }] : undefined}
        />

        {noVault ? (
          <LinkPhone what='Photos' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !list ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : !list.shared ? (
          <View style={s.notice}>
            <Icon name='images' size={32} color={t.textMuted} />
            <Text style={s.noticeTitle}>An album for the people you live with</Text>
            <Text style={s.noticeBody}>Photos here are shared with everyone in a shared Space, and they add theirs from their phones. Share {place}, or set up a home, in My Library → Sharing on your computer.</Text>
            <Pressable style={s.btn} onPress={onOpenLibrary} accessibilityRole='button'><Text style={s.btnText}>Open My Library</Text></Pressable>
          </View>
        ) : !photos.length ? (
          <View style={s.notice}>
            <Icon name='images' size={32} color={t.textMuted} />
            <Text style={s.noticeTitle}>No photos yet</Text>
            <Text style={s.noticeBody}>{canAdd ? `Add photos from your camera or gallery. Everyone in ${place} sees them.` : `When someone in ${place} adds photos, they show here.`}</Text>
            {canAdd && <Pressable style={[s.btn, s.btnPrimary]} onPress={() => setAddMenu(true)} accessibilityRole='button'><Text style={s.btnPrimaryText}>Add photos</Text></Pressable>}
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={s.page}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={VIEWABILITY}
            renderItem={({ item }) => item.kind === 'month' ? (
              <Text style={s.month} accessibilityRole='header'>{item.label} <Text style={s.monthCount}>{item.count}</Text></Text>
            ) : (
              <View style={s.row}>
                {item.photos.map((p) => (
                  <Pressable
                    key={p.id}
                    style={[s.tile, { width: tile, height: tile }]}
                    onPress={() => openPhoto(p)}
                    accessibilityRole='imagebutton'
                    accessibilityLabel={`${p.caption || 'Photo'}, ${whenText(p.takenAt)}${p.by ? `, added by ${p.by}` : ''}`}
                  >
                    {thumbs[p.id] ? <Image source={{ uri: thumbs[p.id] }} style={s.thumb} /> : null}
                  </Pressable>
                ))}
              </View>
            )}
          />
        )}

        <ActionSheet
          visible={addMenu}
          onClose={() => setAddMenu(false)}
          title={`Add to ${place}’s album`}
          groups={[[
            { label: 'Choose from your gallery', icon: 'images', onPress: () => add('library') },
            { label: 'Take a photo', icon: 'camera', onPress: () => add('camera') }
          ]]}
        />

        {/* One photo, big */}
        <Modal visible={!!current} animationType='fade' onRequestClose={() => setOpen(null)} presentationStyle='fullScreen'>
          {current && (
            <SafeAreaView style={s.viewer} edges={['top', 'bottom']}>
              <View style={s.viewerBar}>
                <IconButton icon='arrow-left' label='Back' onPress={() => setOpen(null)} color='#fff' ripple='rgba(255,255,255,0.2)' />
                <View style={s.viewerMeta}>
                  <Text style={s.viewerTitle} numberOfLines={1}>{whenText(current.takenAt)}</Text>
                  {!!current.by && <Text style={s.viewerSub} numberOfLines={1}>Added by {current.by}</Text>}
                </View>
                {current.canDelete && <IconButton icon='trash' label='Remove from the album' onPress={() => remove(current)} color='#fff' ripple='rgba(255,255,255,0.2)' />}
              </View>
              <View style={s.stage}>
                {big[current.id] || thumbs[current.id]
                  ? <Image source={{ uri: big[current.id] || thumbs[current.id] }} style={s.full} resizeMode='contain' />
                  : <ActivityIndicator color='#fff' />}
                {photos.length > 1 && (
                  <>
                    <Pressable style={[s.side, s.sideLeft]} onPress={() => step(-1)} accessibilityRole='button' accessibilityLabel='Previous photo' />
                    <Pressable style={[s.side, s.sideRight]} onPress={() => step(1)} accessibilityRole='button' accessibilityLabel='Next photo' />
                  </>
                )}
              </View>
              {list?.canAdd ? (
                <TextInput
                  style={s.caption}
                  value={caption}
                  onChangeText={setCaption}
                  onEndEditing={saveCaption}
                  onSubmitEditing={saveCaption}
                  placeholder='Add a caption'
                  placeholderTextColor='rgba(255,255,255,0.45)'
                  maxLength={500}
                  returnKeyType='done'
                />
              ) : current.caption ? <Text style={s.captionText}>{current.caption}</Text> : null}
            </SafeAreaView>
          )}
        </Modal>
      </SafeAreaView>
    </Modal>
  )
}

const VIEWABILITY = { itemVisiblePercentThreshold: 1 }

// FlatList wants one onViewableItemsChanged for its life: keep the latest loader in a ref.
function useViewable (load: (ids: string[]) => void) {
  const ref = useRef(load)
  ref.current = load
  return useRef(({ viewableItems }: { viewableItems: { item: Row }[] }) => {
    const ids: string[] = []
    for (const v of viewableItems) if (v.item.kind === 'photos') for (const p of v.item.photos) ids.push(p.id)
    if (ids.length) ref.current(ids)
  }).current
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    page: { padding: sp.lg, paddingBottom: 48 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    errText: { color: t.danger, fontSize: 13, lineHeight: 19 },
    notice: { alignItems: 'center', padding: sp.xl, marginTop: sp.xl, gap: sp.sm },
    noticeTitle: { color: t.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: sp.sm },
    noticeBody: { color: t.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    btn: { borderRadius: radius.pill, paddingHorizontal: 20, minHeight: 40, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, marginTop: sp.md },
    btnText: { color: t.text, fontSize: 14, fontWeight: '600' },
    btnPrimary: { backgroundColor: t.accent, borderColor: t.accent },
    btnPrimaryText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    month: { color: t.text, fontSize: 15, fontWeight: '700', marginTop: sp.md, marginBottom: sp.sm },
    monthCount: { color: t.textMuted, fontWeight: '400' },
    row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
    tile: { borderRadius: 4, overflow: 'hidden', backgroundColor: t.surfaceAlt },
    thumb: { width: '100%', height: '100%' },
    viewer: { flex: 1, backgroundColor: '#000' },
    viewerBar: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 4 },
    viewerMeta: { flex: 1, paddingHorizontal: 8 },
    viewerTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
    viewerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    full: { width: '100%', height: '100%' },
    side: { position: 'absolute', top: 0, bottom: 0, width: '30%' },
    sideLeft: { left: 0 },
    sideRight: { right: 0 },
    caption: { color: '#fff', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.md, marginHorizontal: sp.lg, marginVertical: sp.md, paddingHorizontal: sp.md, minHeight: 44, fontSize: 15, textAlign: 'center' },
    captionText: { color: 'rgba(255,255,255,0.9)', fontSize: 15, textAlign: 'center', margin: sp.lg }
  })
}
