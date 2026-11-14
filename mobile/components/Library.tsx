import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, ToastAndroid } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { hyperKeyOf, shortKey, type DriveType } from '../lib/hyperUrl'
import type { SavedSite, SavedDrive } from '../lib/usePersistence'
import ScreenHeader from './ScreenHeader'
import Tabs from './Tabs'
import ActionSheet, { type SheetAction } from './ActionSheet'
import IconButton from './IconButton'
import Icon, { type IconName } from './Icon'
import SiteIcon from './SiteIcon'
import { ListSection, ListRow, ListEmpty } from './List'
import { DRIVE_TEMPLATES, templateIcon } from '../lib/driveTemplates'
import SearchField, { Marked } from './SearchField'
import { queryWords } from '../lib/search'
import type { DriveSearch } from '../lib/useBackend'

type Page = 'drives' | 'bookmarks' | 'history' | 'downloads'

const PAGES: { key: Page; label: string }[] = [
  { key: 'drives', label: 'Drives' },
  { key: 'bookmarks', label: 'Bookmarks' },
  { key: 'history', label: 'History' },
  { key: 'downloads', label: 'Downloads' }
]

interface Props {
  visible: boolean
  onClose: () => void
  drives: SavedDrive[]
  bookmarks: SavedSite[]
  history: SavedSite[]
  iconFor?: (url: string) => string | undefined
  onOpen: (url: string, type?: DriveType) => void
  // `template`: a built-in template's id (lib/driveTemplates.ts), 'blank' for none
  onCreateDrive: (title: string, type: DriveType, description: string, template: string) => void
  onEditDrive: (drive: SavedDrive) => void
  onRemoveDrive: (url: string) => void
  onRemoveBookmark: (url: string) => void
  onClearHistory: () => void
  initialPage?: Page
  // The user's always-on Peers and whether each keeps a drive online (ADR-0038, shared/peers.mjs
  // keepsDrive), and keeping it on one by itself. Left out on a phone not linked to a Vault.
  drivePeers?: (drive: SavedDrive) => Promise<DrivePeer[] | null>
  setPeerDrive?: (peerKey: string, drive: SavedDrive, on: boolean) => Promise<boolean>
  // Version history of a collaborative drive (components/VersionHistory.tsx), and search in the
  // text files of the drives listed here (backend/lib/drive-search.mjs).
  onDriveHistory?: (drive: SavedDrive) => void
  searchDrives?: (query: string, drives: SavedDrive[]) => Promise<DriveSearch | null>
}

export interface DrivePeer { key: string; name: string; online: boolean; summary: string; keeps: 'space' | 'drive' | false; space?: string | null }

// What a long-press (or a row's ⋮ button) acts on.
type Target = { kind: 'drive'; drive: SavedDrive } | { kind: 'bookmark' | 'history'; site: SavedSite }

// nomad's "My Library" hub, adapted to a mobile full-screen page: a segmented control over the
// user's drives, bookmarks, history, and downloads. Each row opens on tap; a long-press or its ⋮
// button opens its actions, so nothing is removed without asking.
export default function Library (props: Props) {
  const { visible, onClose, initialPage = 'drives' } = props
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [page, setPage] = useState<Page>(initialPage)
  const [target, setTarget] = useState<Target | null>(null)
  // Kept apart from `target` so the sheet keeps its rows while it slides away.
  const [sheetOpen, setSheetOpen] = useState(false)
  const openActions = (next: Target) => { setTarget(next); setSheetOpen(true) }
  // The Peers for the drive whose actions are open, so the sheet can keep it online on one.
  const [peers, setPeers] = useState<DrivePeer[] | null>(null)
  useEffect(() => {
    setPeers(null)
    if (!sheetOpen || target?.kind !== 'drive' || !props.drivePeers) return
    let live = true
    props.drivePeers(target.drive).then((list) => { if (live) setPeers(list) }).catch(() => {})
    return () => { live = false }
  }, [sheetOpen, target])

  // One row per Peer: kept with its Space (nothing to change here), kept on its own, or not kept.
  const peerActions = (): SheetAction[] => {
    if (target?.kind !== 'drive' || !peers?.length || !props.setPeerDrive) return []
    const d = target.drive
    return peers.map((p) => p.keeps === 'space'
      ? { label: `Kept online by ${p.name} with ${p.space || 'its Space'}`, icon: 'server', active: true, disabled: true, onPress: () => {} }
      : {
          label: p.keeps ? `Stop keeping it on ${p.name}` : `Keep online on ${p.name}`,
          icon: 'server',
          active: !!p.keeps,
          onPress: () => {
            props.setPeerDrive!(p.key, d, !p.keeps).then((ok) => {
              if (ok) ToastAndroid.show(p.keeps ? `${p.name} stops keeping ${d.name}` : `${p.name} will keep ${d.name} online`, ToastAndroid.SHORT)
            }).catch((err) => Alert.alert('Couldn’t change that', String(err?.message || err)))
          }
        })
  }

  const actions = (): SheetAction[] => {
    if (!target) return []
    if (target.kind === 'drive') {
      const d = target.drive
      return [
        { label: 'Open', icon: 'external-link-alt', onPress: () => props.onOpen(d.url, d.type) },
        { label: 'Edit files', icon: 'folder-open', hidden: !d.ns, onPress: () => props.onEditDrive(d) },
        { label: 'Version history', icon: 'history', hidden: d.type !== 'autobase' || !props.onDriveHistory, onPress: () => props.onDriveHistory!(d) },
        { label: 'Copy link', icon: 'link', onPress: () => { Clipboard.setStringAsync(d.url) } },
        {
          label: 'Remove from library',
          icon: 'trash-alt',
          destructive: true,
          onPress: () => Alert.alert('Remove this drive?', `${d.name} leaves your library on this phone.${d.ns ? ' The drive itself is kept, and you can open it again by its address.' : ''}`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => props.onRemoveDrive(d.url) }
          ])
        }
      ]
    }
    const site = target.site
    return [
      { label: 'Open', icon: 'external-link-alt', onPress: () => props.onOpen(site.url) },
      { label: 'Copy link', icon: 'link', onPress: () => { Clipboard.setStringAsync(site.url) } },
      { label: 'Remove bookmark', icon: 'trash-alt', destructive: true, hidden: target.kind !== 'bookmark', onPress: () => props.onRemoveBookmark(site.url) }
    ]
  }

  const clearHistory = () => Alert.alert('Clear history?', 'This removes every page from your history in this space.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: props.onClearHistory }
  ])

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader title='My Library' onBack={onClose} />

        <Tabs tabs={PAGES} value={page} onChange={setPage} />

        {page === 'drives' && <DrivesPage {...props} s={s} t={t} onMore={(drive) => openActions({ kind: 'drive', drive })} />}
        {page === 'bookmarks' && (
          <SitesPage
            s={s}
            items={props.bookmarks}
            iconFor={props.iconFor}
            empty='No bookmarks yet. Tap the star in the toolbar to bookmark a page.'
            onOpen={props.onOpen}
            onMore={(site) => openActions({ kind: 'bookmark', site })}
          />
        )}
        {page === 'history' && (
          <SitesPage
            s={s}
            items={props.history}
            iconFor={props.iconFor}
            empty='No history yet. Pages you visit appear here.'
            onOpen={props.onOpen}
            onMore={(site) => openActions({ kind: 'history', site })}
            action={props.history.length ? { label: 'Clear', onPress: clearHistory } : undefined}
          />
        )}
        {page === 'downloads' && (
          <View style={s.emptyPage}>
            <Icon name='download' size={28} color={t.textMuted} />
            <Text style={s.emptyText}>No downloads yet. Files you save will appear here.</Text>
          </View>
        )}

        <ActionSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={target ? (target.kind === 'drive' ? target.drive.name : target.site.title) : ''}
          subtitle={target ? (target.kind === 'drive' ? target.drive.url : target.site.url) : ''}
          groups={[actions(), peerActions()]}
        />
      </SafeAreaView>
    </Modal>
  )
}

function DrivesPage ({ drives, onOpen, onCreateDrive, onEditDrive, onMore, searchDrives, s, t }: Props & { onMore: (d: SavedDrive) => void; s: Styles; t: Theme }) {
  const [creating, setCreating] = useState(false)
  const search = useDriveSearch(drives, searchDrives)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [type, setType] = useState<DriveType>('hyperdrive')
  const [template, setTemplate] = useState('blank')
  const tpl = DRIVE_TEMPLATES.find((x) => x.id === template)

  // A template brings its own default for taking writers (a Blog or a Forum is for several people),
  // as desktop's Create Drive does.
  const pickTemplate = (id: string) => {
    setTemplate(id)
    setType(DRIVE_TEMPLATES.find((x) => x.id === id)?.collaborative ? 'autobase' : 'hyperdrive')
  }

  const submit = () => {
    onCreateDrive(name.trim() || (tpl ? `My ${tpl.title.toLowerCase()}` : 'Untitled drive'), type, desc.trim(), template)
    setName('')
    setDesc('')
    setTemplate('blank')
    setType('hyperdrive')
    setCreating(false)
  }

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps='handled'>
      {searchDrives && drives.length ? (
        <SearchField value={search.query} onChangeText={search.setQuery} placeholder='Search in your drives' style={s.search} />
      ) : null}
      {search.query.trim() ? <DriveResults search={search} drives={drives} onOpen={onOpen} s={s} t={t} /> : (
        <>
          {/* A drive is created (and assigned a hyper:// URL), not added by URL. The form opens in
              place, at the top of the page, so the keyboard never covers it. */}
          <ListSection>
            {creating ? (
              <View style={s.form}>
                <Text style={s.formTitle}>New drive</Text>
                <View style={s.templates} accessibilityRole='radiogroup' accessibilityLabel='Start with'>
                  <TemplateOption title='Blank' sub='Any files you like' icon='file' active={template === 'blank'} onPress={() => pickTemplate('blank')} s={s} t={t} />
                  {DRIVE_TEMPLATES.map((x) => (
                    <TemplateOption key={x.id} title={x.title} sub={x.description} icon={templateIcon(x)} active={template === x.id} onPress={() => pickTemplate(x.id)} s={s} t={t} />
                  ))}
                </View>
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  placeholder={tpl ? `Name (My ${tpl.title.toLowerCase()})` : 'Drive name'}
                  placeholderTextColor={t.textMuted}
                  autoCorrect={false}
                  autoFocus
                />
                <TextInput
                  style={s.input}
                  value={desc}
                  onChangeText={setDesc}
                  placeholder='Description (optional)'
                  placeholderTextColor={t.textMuted}
                  autoCorrect={false}
                />
                <View style={s.typePick}>
                  <TypeOption label='Hyperdrive' sub='Only you write' icon='hdd' active={type === 'hyperdrive'} onPress={() => setType('hyperdrive')} s={s} t={t} />
                  <TypeOption label='Collaborative' sub='Invite writers' icon='users' active={type === 'autobase'} onPress={() => setType('autobase')} s={s} t={t} />
                </View>
                <View style={s.formActions}>
                  <Pressable style={s.btnGhost} onPress={() => setCreating(false)} accessibilityRole='button'>
                    <Text style={s.btnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={s.btn} onPress={submit} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
                    <Text style={s.btnText}>Create</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <ListRow title='New drive' icon='plus' iconColor={t.accent} accent onPress={() => setCreating(true)} />
            )}
          </ListSection>

          <ListSection title={drives.length ? 'Your drives' : undefined}>
            {drives.length === 0 ? (
              <ListEmpty text='No drives yet. Create one above, or open a hyper:// address.' />
            ) : drives.map((d, i) => (
              <ListRow
                key={d.url}
                title={d.name}
                subtitle={`${d.ns ? 'Yours · ' : ''}${d.type === 'autobase' ? 'Collaborative' : 'Hyperdrive'} · ${shortKey(hyperKeyOf(d.url))}`}
                divider={i > 0}
                left={(
                  <View style={s.driveIcon}>
                    <Icon name={d.type === 'autobase' ? 'users' : 'hdd'} size={15} color={t.trustText} />
                  </View>
                )}
                onPress={() => onOpen(d.url, d.type)}
                onLongPress={() => onMore(d)}
                right={(
                  <>
                    {d.ns ? <IconButton icon='folder-open' label={`Edit files in ${d.name}`} size={16} onPress={() => onEditDrive(d)} /> : null}
                    <IconButton icon='ellipsis-v' label={`More for ${d.name}`} size={16} onPress={() => onMore(d)} style={s.more} />
                  </>
                )}
              />
            ))}
          </ListSection>
        </>
      )}
    </ScrollView>
  )
}

interface SearchState { query: string; setQuery: (q: string) => void; busy: boolean; result: DriveSearch | null; error: string; words: string[] }

// Search as you type, a moment after the last key, and only the newest answer counts.
function useDriveSearch (drives: SavedDrive[], searchDrives?: Props['searchDrives']): SearchState {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DriveSearch | null>(null)
  const [error, setError] = useState('')
  const seq = useRef(0)
  useEffect(() => {
    const q = query.trim()
    const n = ++seq.current
    if (!q || !searchDrives) {
      setBusy(false)
      setResult(null)
      setError('')
      return
    }
    setBusy(true)
    const timer = setTimeout(() => {
      searchDrives(q, drives)
        .then((r) => { if (n === seq.current) { setResult(r); setError(r ? '' : 'Couldn’t search your drives') } })
        .catch((err) => { if (n === seq.current) setError(String(err?.message || err)) })
        .finally(() => { if (n === seq.current) setBusy(false) })
    }, 350)
    return () => clearTimeout(timer)
  }, [query, drives, searchDrives])
  return { query, setQuery, busy, result, error, words: useMemo(() => queryWords(query), [query]) }
}

function DriveResults ({ search, drives, onOpen, s, t }: { search: SearchState; drives: SavedDrive[]; onOpen: Props['onOpen']; s: Styles; t: Theme }) {
  const { busy, result, error, words } = search
  const typeOf = (key: string) => drives.find((d) => hyperKeyOf(d.url) === key.toLowerCase())?.type
  if (error) return <ListSection><ListEmpty text={error} /></ListSection>
  if (!result) return <View style={s.searching}><ActivityIndicator color={t.accent} /><Text style={s.emptyText}>Looking in your drives…</Text></View>
  const n = result.results.length
  const head = busy ? 'Looking…' : n ? `${n === 50 ? 'First 50' : n} ${n === 1 ? 'file' : 'files'} in ${result.searched} ${result.searched === 1 ? 'drive' : 'drives'}` : undefined
  return (
    <ListSection
      title={head}
      footer={result.partial ? 'Some files weren’t on this phone and no device that has them was online, so they weren’t searched. They’re tried again next time.' : undefined}
    >
      {!n ? <ListEmpty text={busy ? 'Looking in your drives…' : 'No file in your drives has every word.'} /> : result.results.map((r, i) => (
        <Pressable
          key={r.url}
          style={[s.result, i > 0 && s.resultDivider]}
          onPress={() => onOpen(r.url, typeOf(r.driveKey))}
          android_ripple={{ color: t.ripple }}
          accessibilityRole='button'
          accessibilityLabel={`${r.title}, in ${r.driveTitle}, ${r.path}`}
        >
          <Icon name='file-alt' size={15} color={t.textDim} style={s.resultIcon} />
          <View style={s.flex}>
            <Text style={s.resultTitle} numberOfLines={1}><Marked text={r.title} words={words} /></Text>
            <Text style={s.resultMeta} numberOfLines={1}>{r.driveTitle} · {r.path}</Text>
            {r.snippet ? <Text style={s.resultSnippet} numberOfLines={2}><Marked text={r.snippet} words={words} /></Text> : null}
          </View>
        </Pressable>
      ))}
    </ListSection>
  )
}

function SitesPage ({ items, empty, iconFor, onOpen, onMore, action, s }: {
  items: SavedSite[]
  empty: string
  iconFor?: (url: string) => string | undefined
  onOpen: (url: string) => void
  onMore: (site: SavedSite) => void
  action?: { label: string; onPress: () => void }
  s: Styles
}) {
  return (
    <ScrollView contentContainerStyle={s.page}>
      {items.length === 0 ? (
        <View style={s.emptyPage}><Text style={s.emptyText}>{empty}</Text></View>
      ) : (
        <ListSection title={`${items.length} ${items.length === 1 ? 'page' : 'pages'}`} action={action}>
          {items.map((it, i) => (
            <ListRow
              key={it.url + it.ts}
              title={it.title}
              subtitle={it.url}
              divider={i > 0}
              left={<SiteIcon url={it.url} title={it.title} uri={iconFor?.(it.url)} size={24} />}
              onPress={() => onOpen(it.url)}
              onLongPress={() => onMore(it)}
              right={<IconButton icon='ellipsis-v' label={`More for ${it.title}`} size={16} onPress={() => onMore(it)} style={s.more} />}
            />
          ))}
        </ListSection>
      )}
    </ScrollView>
  )
}

function TemplateOption ({ title, sub, icon, active, onPress, s, t }: { title: string; sub: string; icon: IconName; active: boolean; onPress: () => void; s: Styles; t: Theme }) {
  return (
    <Pressable
      style={[s.tplOpt, active && s.typeOptActive]}
      onPress={onPress}
      android_ripple={{ color: t.ripple }}
      accessibilityRole='radio'
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${title}: ${sub}`}
    >
      <Icon name={icon} size={15} color={active ? t.trustText : t.textMuted} style={s.tplIcon} />
      <View style={s.flex}>
        <Text style={[s.typeOptText, active && s.typeOptTextActive]} numberOfLines={1}>{title}</Text>
        <Text style={s.typeOptSub} numberOfLines={2}>{sub}</Text>
      </View>
    </Pressable>
  )
}

function TypeOption ({ label, sub, icon, active, onPress, s, t }: { label: string; sub: string; icon: 'hdd' | 'users'; active: boolean; onPress: () => void; s: Styles; t: Theme }) {
  return (
    <Pressable
      style={[s.typeOpt, active && s.typeOptActive]}
      onPress={onPress}
      accessibilityRole='radio'
      accessibilityState={{ checked: active }}
    >
      <Icon name={icon} size={15} color={active ? t.trustText : t.textMuted} />
      <View style={s.flex}>
        <Text style={[s.typeOptText, active && s.typeOptTextActive]}>{label}</Text>
        <Text style={s.typeOptSub}>{sub}</Text>
      </View>
    </Pressable>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    page: { padding: space.lg },
    form: { padding: space.lg, gap: space.md },
    formTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
    input: { height: 48, color: t.text, fontSize: 15, backgroundColor: t.bg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: space.md },
    typePick: { flexDirection: 'row', gap: space.sm },
    templates: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    tplOpt: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, minHeight: 56, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, overflow: 'hidden' },
    tplIcon: { marginTop: 2, width: 18, textAlign: 'center' },
    typeOpt: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: t.border },
    typeOptActive: { backgroundColor: t.trustBg, borderColor: t.trustText },
    typeOptText: { color: t.text, fontSize: 14, fontWeight: '600' },
    typeOptTextActive: { color: t.trustText },
    typeOptSub: { color: t.textMuted, fontSize: 11, marginTop: 1 },
    formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
    btnGhost: { minHeight: 40, paddingHorizontal: space.lg, justifyContent: 'center' },
    btnGhostText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    btn: { minHeight: 40, backgroundColor: t.accent, borderRadius: radius.pill, paddingHorizontal: space.xl, justifyContent: 'center', overflow: 'hidden' },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' },
    driveIcon: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: t.trustBg, alignItems: 'center', justifyContent: 'center' },
    more: { width: 36, marginRight: -space.sm },
    emptyPage: { alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingTop: 48 },
    emptyText: { color: t.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    search: { marginBottom: space.lg },
    searching: { alignItems: 'center', gap: space.md, paddingTop: 32 },
    result: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
    resultDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    resultIcon: { marginTop: 2, width: 18, textAlign: 'center' },
    resultTitle: { color: t.text, fontSize: 15, fontWeight: '500' },
    resultMeta: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    resultSnippet: { color: t.textDim, fontSize: 13, lineHeight: 18, marginTop: 4 }
  })
}
