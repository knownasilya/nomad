import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { useTheme, radius, space, touch, type Theme } from '../lib/theme'
import type { AppsResult } from '../lib/useBackend'
import { groupChats, chatMeta, type AiChatRow, type AiChatList } from '../lib/aiChats'
import { queryWords } from '../lib/search'
import SearchField, { Marked } from './SearchField'
import Icon from './Icon'
import IconButton from './IconButton'
import ActionSheet from './ActionSheet'
import BottomSheet from './BottomSheet'

type Apps = <T = unknown>(app: 'aiChats', action: string, args?: Record<string, unknown>) => Promise<AppsResult<T>>

interface Props {
  apps: Apps
  space?: string
  ns?: string | null
  // The chat open in the panel, marked in the list.
  currentId: string | null
  onOpen: (id: string) => void
  onDeleted: (id: string) => void
  onRenamed: (id: string, title: string, named: boolean) => void
  // Why this phone couldn't save the last chat, if it couldn't.
  saveError?: string | null
  // The empty panel shows only the newest few, with a link to the rest.
  limit?: number
  onSeeAll?: () => void
}

// The AI's past chats in this Space: the same list as desktop's AI Sidebar and nomad://ai/chats,
// kept in the Space's Root Drive (shared/ai-chats.mjs). Search, open one to carry on, rename or
// delete it (long-press, or the ⋮ button).
export default function AiChats ({ apps, space, ns, currentId, onOpen, onDeleted, onRenamed, saveError, limit, onSeeAll }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [query, setQuery] = useState('')
  const [chats, setChats] = useState<AiChatRow[] | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<AiChatRow | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ row: AiChatRow; value: string } | null>(null)
  const seq = useRef(0)
  // backend.apps is a new function on every parent render: called through a ref, so the list
  // doesn't reload each time the panel renders.
  const appsRef = useRef(apps)
  appsRef.current = apps
  const compact = !!limit

  const load = useCallback(async (q: string) => {
    if (!space) { setChats([]); return }
    const mine = ++seq.current
    const res = await appsRef.current<AiChatList>('aiChats', 'list', { space, ns: ns || null, query: q })
    if (mine !== seq.current) return
    if (res.ok && res.value) { setChats(res.value.chats); setError('') } else { setChats([]); setError(res.message || 'Couldn’t load your chats') }
  }, [space, ns])

  // Typing waits a moment before it searches.
  useEffect(() => {
    const timer = setTimeout(() => { load(query) }, query ? 200 : 0)
    return () => clearTimeout(timer)
  }, [query, load])

  const words = useMemo(() => queryWords(query), [query])
  const searching = words.length > 0

  const openMenu = (row: AiChatRow) => { setMenu(row); setMenuOpen(true) }

  const rename = async () => {
    if (!renaming) return
    const { row, value } = renaming
    setRenaming(null)
    const res = await apps<string>('aiChats', 'rename', { space, ns: ns || null, id: row.id, name: value })
    if (!res.ok) return Alert.alert('Couldn’t rename the chat', res.message || 'Unknown error')
    const named = !!value.trim()
    setChats((prev) => prev && prev.map((c) => (c.id === row.id ? { ...c, title: res.value || '', named } : c)))
    onRenamed(row.id, res.value || '', named)
  }

  const remove = (row: AiChatRow) => {
    Alert.alert('Delete this chat?', 'It is removed from your other devices in this Space too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const res = await apps('aiChats', 'delete', { space, ns: ns || null, id: row.id })
          if (!res.ok) return Alert.alert('Couldn’t delete the chat', res.message || 'Unknown error')
          setChats((prev) => prev && prev.filter((c) => c.id !== row.id))
          onDeleted(row.id)
        }
      }
    ])
  }

  const renderRow = (c: AiChatRow, divider: boolean) => {
    const current = c.id === currentId
    const title = c.title || 'New chat'
    const detail = searching && c.snippet ? c.snippet : c.preview
    return (
      <Pressable
        key={c.id}
        style={({ pressed }) => [s.row, divider && s.divider, pressed && s.pressed]}
        android_ripple={{ color: t.ripple }}
        onPress={() => onOpen(c.id)}
        onLongPress={compact ? undefined : () => openMenu(c)}
        accessibilityRole='button'
        accessibilityLabel={`${title}. ${chatMeta(c)}${current ? '. Open now' : ''}`}
        accessibilityHint={compact ? 'Opens the chat' : 'Opens the chat. Long-press to rename or delete it.'}
      >
        <View style={[s.rowIcon, current && s.rowIconCurrent]}>
          <Icon name={c.job ? 'robot' : 'comment-alt'} size={13} color={current ? t.onAccent : t.trustText} />
        </View>
        <View style={s.rowText}>
          <View style={s.rowHead}>
            <Text style={s.rowTitle} numberOfLines={1}><Marked text={title} words={words} /></Text>
            {current ? <Text style={s.badge}>Open now</Text> : c.job ? <Text style={s.badge}>Job</Text> : null}
          </View>
          <Text style={s.rowMeta} numberOfLines={1}>{chatMeta(c)}</Text>
          {detail ? <Text style={s.rowPreview} numberOfLines={2}><Marked text={detail} words={words} /></Text> : null}
        </View>
        {!compact && <IconButton icon='ellipsis-v' label='More for this chat' size={16} color={t.textMuted} onPress={() => openMenu(c)} style={s.more} />}
      </Pressable>
    )
  }

  if (compact) {
    // The empty panel's "Recent chats": the newest few, or nothing at all.
    const rows = (chats || []).slice(0, limit)
    if (!rows.length) return null
    return (
      <View style={s.recent}>
        <View style={s.recentHead}>
          <Text style={s.groupHead} accessibilityRole='header'>Recent chats</Text>
          {onSeeAll && (chats || []).length > rows.length ? (
            <Pressable onPress={onSeeAll} hitSlop={12} accessibilityRole='button'>
              <Text style={s.seeAll}>See all</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={s.card}>{rows.map((c, i) => renderRow(c, i > 0))}</View>
      </View>
    )
  }

  return (
    <View style={s.flex}>
      <SearchField value={query} onChangeText={setQuery} placeholder='Search chats' style={s.search} />
      <ScrollView style={s.flex} contentContainerStyle={s.listPad} keyboardShouldPersistTaps='handled' keyboardDismissMode='on-drag'>
        {saveError ? (
          <View style={s.note}>
            <Icon name='exclamation-circle' size={13} color={t.warn} style={s.noteIcon} />
            <Text style={s.noteText}>This phone couldn’t save its last chat here. {saveError}</Text>
          </View>
        ) : null}
        {chats === null ? (
          <ActivityIndicator style={s.loading} color={t.accent} />
        ) : !space ? (
          <Notice icon='comments' title='No Space open' text='Your chats are kept in each Space. Open one to see its chats.' s={s} t={t} />
        ) : error ? (
          <Notice icon='exclamation-triangle' title='Couldn’t load your chats' text={error} s={s} t={t} />
        ) : chats.length === 0 ? (
          searching
            ? <Notice icon='search' title={`No chats match “${query.trim()}”`} text='Search looks at each chat’s name and every message in it.' s={s} t={t} />
            : <Notice icon='comments' title='No chats yet' text='Chats you have with the AI here or in the sidebar on your computer show up in this list.' s={s} t={t} />
        ) : (
          <>
            <Text style={s.count}>{chats.length} {chats.length === 1 ? 'chat' : 'chats'}{searching ? ' found' : ''}</Text>
            {groupChats(chats).map((g) => (
              <View key={g.title} style={s.group}>
                <Text style={s.groupHead} accessibilityRole='header'>{g.title}</Text>
                <View style={s.card}>{g.rows.map((c, i) => renderRow(c, i > 0))}</View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={menu?.title || 'New chat'}
        subtitle={menu ? chatMeta(menu) : undefined}
        groups={[
          [
            { label: 'Open', icon: 'comment-alt', regular: true, onPress: () => { if (menu) onOpen(menu.id) } },
            { label: 'Rename', icon: 'pen', onPress: () => { if (menu) setRenaming({ row: menu, value: menu.named ? menu.title : '' }) } }
          ],
          [{ label: 'Delete', icon: 'trash-alt', regular: true, destructive: true, onPress: () => { if (menu) remove(menu) } }]
        ]}
      />

      <BottomSheet visible={!!renaming} onClose={() => setRenaming(null)} style={s.sheet}>
        <Text style={s.sheetTitle}>Rename chat</Text>
        <TextInput
          style={s.sheetInput}
          value={renaming?.value ?? ''}
          onChangeText={(value) => setRenaming((r) => (r ? { ...r, value } : r))}
          placeholder={renaming?.row.named ? 'Name' : renaming?.row.title || 'Name'}
          placeholderTextColor={t.textMuted}
          maxLength={80}
          autoFocus
          returnKeyType='done'
          onSubmitEditing={rename}
          accessibilityLabel='Chat name'
        />
        <Text style={s.sheetHint}>Leave it empty to name the chat after its first message.</Text>
        <View style={s.sheetBtns}>
          <Pressable style={s.sheetBtn} onPress={() => setRenaming(null)} accessibilityRole='button'>
            <Text style={s.sheetCancel}>Cancel</Text>
          </Pressable>
          <Pressable style={[s.sheetBtn, s.sheetPrimary]} onPress={rename} accessibilityRole='button'>
            <Text style={s.sheetPrimaryText}>Save</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  )
}

function Notice ({ icon, title, text, s, t }: { icon: 'comments' | 'search' | 'exclamation-triangle'; title: string; text: string; s: Styles; t: Theme }) {
  return (
    <View style={s.notice}>
      <View style={s.noticeIcon}><Icon name={icon} size={20} color={t.trustText} /></View>
      <Text style={s.noticeTitle}>{title}</Text>
      <Text style={s.noticeText}>{text}</Text>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    search: { marginHorizontal: space.lg, marginBottom: space.sm },
    listPad: { paddingHorizontal: space.lg, paddingBottom: space.xl },
    loading: { marginTop: 40 },
    count: { color: t.textMuted, fontSize: 12, marginTop: space.xs, marginBottom: space.xs },
    group: { marginTop: space.md },
    groupHead: { color: t.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginLeft: 4 },
    card: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 64, paddingLeft: space.md, paddingVertical: 10, gap: space.md },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    pressed: { backgroundColor: t.surfaceAlt },
    rowIcon: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: t.trustBg, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    rowIconCurrent: { backgroundColor: t.accent },
    rowText: { flex: 1, paddingRight: space.md },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: { flexShrink: 1, color: t.text, fontSize: 15, fontWeight: '600' },
    badge: { color: t.trustText, backgroundColor: t.trustBg, fontSize: 11, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, overflow: 'hidden' },
    rowMeta: { color: t.textMuted, fontSize: 12, marginTop: 2 },
    rowPreview: { color: t.textDim, fontSize: 13, lineHeight: 18, marginTop: 3 },
    more: { width: 40, height: touch, marginLeft: -space.md },
    recent: { alignSelf: 'stretch', marginTop: space.lg },
    recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    seeAll: { color: t.accent, fontSize: 13, fontWeight: '600', marginBottom: 6 },
    note: { flexDirection: 'row', gap: 8, paddingVertical: 10, paddingHorizontal: 12, marginTop: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: t.warn },
    noteIcon: { marginTop: 2 },
    noteText: { flex: 1, color: t.text, fontSize: 13, lineHeight: 18 },
    notice: { alignItems: 'center', gap: 8, paddingTop: 48, paddingHorizontal: space.lg },
    noticeIcon: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: t.trustBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    noticeTitle: { color: t.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
    noticeText: { color: t.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.sm },
    sheetTitle: { color: t.text, fontSize: 17, fontWeight: '600' },
    sheetInput: { minHeight: touch, color: t.text, fontSize: 15, backgroundColor: t.inputBg, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14 },
    sheetHint: { color: t.textMuted, fontSize: 12 },
    sheetBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
    sheetBtn: { minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: 'center' },
    sheetCancel: { color: t.accent, fontSize: 14, fontWeight: '600' },
    sheetPrimary: { backgroundColor: t.accent },
    sheetPrimaryText: { color: t.onAccent, fontSize: 14, fontWeight: '700' }
  })
}
