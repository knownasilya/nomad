import { useMemo, useState } from 'react'
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import { type DriveType } from '../lib/hyperUrl'
import type { SavedSite, SavedDrive } from '../lib/usePersistence'

type Page = 'drives' | 'bookmarks' | 'history' | 'downloads'

const PAGES: { key: Page; label: string }[] = [
  { key: 'drives', label: 'Hyperdrives' },
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
  onOpen: (url: string, type?: DriveType) => void
  onCreateDrive: (title: string, type: DriveType, description: string) => void
  onEditDrive: (drive: SavedDrive) => void
  onRemoveDrive: (url: string) => void
  onRemoveBookmark: (url: string) => void
  onClearHistory: () => void
}

// nomad's "My Library" hub, adapted to a mobile full-screen overlay: a paged
// view over the user's drives, bookmarks, history, and downloads.
export default function Library (props: Props) {
  const { visible, onClose } = props
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [page, setPage] = useState<Page>('drives')

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>My Library</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={s.tabs}>
          {PAGES.map((p) => (
            <TouchableOpacity key={p.key} style={[s.tab, page === p.key && s.tabActive]} onPress={() => setPage(p.key)}>
              <Text style={[s.tabText, page === p.key && s.tabTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {page === 'drives' && <DrivesPage {...props} s={s} t={t} />}
        {page === 'bookmarks' && <ListPage s={s} t={t} items={props.bookmarks} empty='No bookmarks yet.' onOpen={props.onOpen} onRemove={props.onRemoveBookmark} />}
        {page === 'history' && <ListPage s={s} t={t} items={props.history} empty='No history yet.' onOpen={props.onOpen} action={props.history.length ? { label: 'Clear', onPress: props.onClearHistory } : undefined} />}
        {page === 'downloads' && <Empty s={s} text='No downloads yet. Files you save will appear here.' />}
      </SafeAreaView>
    </Modal>
  )
}

function DrivesPage ({ drives, onOpen, onCreateDrive, onEditDrive, onRemoveDrive, s, t }: Props & { s: Styles; t: Theme }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [type, setType] = useState<DriveType>('hyperdrive')

  const submit = () => {
    onCreateDrive(name.trim() || 'Untitled drive', type, desc.trim())
    setName('')
    setDesc('')
  }

  return (
    <ScrollView contentContainerStyle={s.page}>
      {/* A drive is created (and assigned a hyper:// URL), not added by URL. */}
      <View style={s.addCard}>
        <Text style={s.addLabel}>New drive</Text>
        <TextInput
          style={s.addInput}
          value={name}
          onChangeText={setName}
          placeholder='Drive name'
          placeholderTextColor={t.textMuted}
          autoCorrect={false}
        />
        <TextInput
          style={[s.addInput, s.addInputSpaced]}
          value={desc}
          onChangeText={setDesc}
          placeholder='Description (optional)'
          placeholderTextColor={t.textMuted}
          autoCorrect={false}
        />
        <View style={s.addRow}>
          <View style={s.typePick}>
            <TypeOption label='Hyperdrive' active={type === 'hyperdrive'} onPress={() => setType('hyperdrive')} s={s} />
            <TypeOption label='Collaborative' active={type === 'autobase'} onPress={() => setType('autobase')} s={s} />
          </View>
          <TouchableOpacity style={s.addBtn} onPress={submit}>
            <Text style={s.addBtnText}>Create</Text>
          </TouchableOpacity>
        </View>
      </View>

      {drives.length === 0 ? (
        <Text style={s.empty}>No drives yet. Create one above, or open a hyper:// address.</Text>
      ) : (
        <View style={s.card}>
          {drives.map((d, i) => (
            <TouchableOpacity
              key={d.url}
              style={[s.row, i > 0 && s.rowDivider]}
              activeOpacity={0.7}
              onPress={() => onOpen(d.url, d.type)}
              onLongPress={() => onRemoveDrive(d.url)}
            >
              <View style={[s.dot, { backgroundColor: t.secure }]} />
              <View style={s.rowText}>
                <Text numberOfLines={1} style={s.rowTitle}>{d.name}{d.ns ? '  ·  yours' : ''}</Text>
                <Text numberOfLines={1} style={s.rowSub}>{d.url}</Text>
              </View>
              {d.ns && (
                <TouchableOpacity style={s.editBtn} onPress={() => onEditDrive(d)} hitSlop={8}>
                  <Text style={s.editBtnText}>Files</Text>
                </TouchableOpacity>
              )}
              <View style={s.badge}><Text style={s.badgeText}>{d.type === 'autobase' ? 'AB' : 'HD'}</Text></View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

function ListPage ({ items, empty, onOpen, onRemove, action, s, t }: { items: SavedSite[]; empty: string; onOpen: (url: string) => void; onRemove?: (url: string) => void; action?: { label: string; onPress: () => void }; s: Styles; t: Theme }) {
  return (
    <ScrollView contentContainerStyle={s.page}>
      {action && (
        <TouchableOpacity style={s.actionRow} onPress={action.onPress}>
          <Text style={s.actionText}>{action.label}</Text>
        </TouchableOpacity>
      )}
      {items.length === 0 ? (
        <Text style={s.empty}>{empty}</Text>
      ) : (
        <View style={s.card}>
          {items.map((it, i) => (
            <TouchableOpacity
              key={it.url + it.ts}
              style={[s.row, i > 0 && s.rowDivider]}
              activeOpacity={0.7}
              onPress={() => onOpen(it.url)}
              onLongPress={() => onRemove?.(it.url)}
            >
              <View style={[s.dot, { backgroundColor: it.url.startsWith('hyper://') ? t.secure : t.textMuted }]} />
              <View style={s.rowText}>
                <Text numberOfLines={1} style={s.rowTitle}>{it.title}</Text>
                <Text numberOfLines={1} style={s.rowSub}>{it.url}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

function TypeOption ({ label, active, onPress, s }: { label: string; active: boolean; onPress: () => void; s: Styles }) {
  return (
    <TouchableOpacity style={[s.typeOpt, active && s.typeOptActive]} onPress={onPress}>
      <Text style={[s.typeOptText, active && s.typeOptTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

function Empty ({ text, s }: { text: string; s: Styles }) {
  return (
    <View style={s.page}><Text style={s.empty}>{text}</Text></View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
    title: { color: t.text, fontSize: 20, fontWeight: '700' },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: t.textDim, fontSize: 18 },
    tabs: { flexDirection: 'row', paddingHorizontal: 10, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, paddingBottom: 8 },
    tab: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.md },
    tabActive: { backgroundColor: t.trustBg },
    tabText: { color: t.textDim, fontSize: 13, fontWeight: '500' },
    tabTextActive: { color: t.trustText, fontWeight: '700' },
    page: { padding: 16 },
    addCard: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: 12, marginBottom: 18 },
    addLabel: { color: t.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
    addInput: { height: 42, color: t.text, fontSize: 14, backgroundColor: t.inputBg, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: 10 },
    addInputSpaced: { marginTop: 8 },
    addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10 },
    typePick: { flexDirection: 'row', gap: 6, flex: 1 },
    typeOpt: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    typeOptActive: { backgroundColor: t.trustBg, borderColor: t.trustText },
    typeOptText: { color: t.textDim, fontSize: 12, fontWeight: '500' },
    typeOptTextActive: { color: t.trustText, fontWeight: '700' },
    addBtn: { backgroundColor: t.accent, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 9 },
    addBtnOff: { opacity: 0.4 },
    addBtnText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    card: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 14, gap: 12 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    rowText: { flex: 1, paddingVertical: 10 },
    rowTitle: { color: t.text, fontSize: 14, fontWeight: '500' },
    rowSub: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    editBtn: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5 },
    editBtnText: { color: t.accent, fontSize: 12, fontWeight: '600' },
    badge: { backgroundColor: t.trustBg, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
    badgeText: { color: t.trustText, fontSize: 11, fontWeight: '700' },
    actionRow: { alignSelf: 'flex-end', marginBottom: 8 },
    actionText: { color: t.accent, fontSize: 13, fontWeight: '500' },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 19 }
  })
}
