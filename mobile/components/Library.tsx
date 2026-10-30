import { useMemo, useState } from 'react'
import { Alert, Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { hyperKeyOf, shortKey, type DriveType } from '../lib/hyperUrl'
import type { SavedSite, SavedDrive } from '../lib/usePersistence'
import ScreenHeader from './ScreenHeader'
import Tabs from './Tabs'
import ActionSheet, { type SheetAction } from './ActionSheet'
import IconButton from './IconButton'
import Icon from './Icon'
import SiteIcon from './SiteIcon'
import { ListSection, ListRow, ListEmpty } from './List'

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
  onCreateDrive: (title: string, type: DriveType, description: string) => void
  onEditDrive: (drive: SavedDrive) => void
  onRemoveDrive: (url: string) => void
  onRemoveBookmark: (url: string) => void
  onClearHistory: () => void
  initialPage?: Page
}

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

  const actions = (): SheetAction[] => {
    if (!target) return []
    if (target.kind === 'drive') {
      const d = target.drive
      return [
        { label: 'Open', icon: 'external-link-alt', onPress: () => props.onOpen(d.url, d.type) },
        { label: 'Edit files', icon: 'folder-open', hidden: !d.ns, onPress: () => props.onEditDrive(d) },
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
          groups={[actions()]}
        />
      </SafeAreaView>
    </Modal>
  )
}

function DrivesPage ({ drives, onOpen, onCreateDrive, onEditDrive, onMore, s, t }: Props & { onMore: (d: SavedDrive) => void; s: Styles; t: Theme }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [type, setType] = useState<DriveType>('hyperdrive')

  const submit = () => {
    onCreateDrive(name.trim() || 'Untitled drive', type, desc.trim())
    setName('')
    setDesc('')
    setCreating(false)
  }

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps='handled'>
      {/* A drive is created (and assigned a hyper:// URL), not added by URL. The form opens in
          place, at the top of the page, so the keyboard never covers it. */}
      <ListSection>
        {creating ? (
          <View style={s.form}>
            <Text style={s.formTitle}>New drive</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder='Drive name'
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
    </ScrollView>
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
    emptyText: { color: t.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 }
  })
}
