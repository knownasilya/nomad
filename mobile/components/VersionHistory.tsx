import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Modal, View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet, ToastAndroid, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { shortKey } from '../lib/hyperUrl'
import { formatBytes } from '../lib/assetRules'
import { groupByDay, rowMeta, whenOf, restoreCounts, KIND_LABEL } from '../lib/versionHistory'
import type { AppsResult, AppName, DriveHistory, HistoryRow, FileVersion, RestoreSummary, HistoryDriveRef } from '../lib/useBackend'
import ScreenHeader from './ScreenHeader'
import ActionSheet from './ActionSheet'
import BottomSheet from './BottomSheet'
import IconButton from './IconButton'
import Icon, { type IconName } from './Icon'
import { ListSection, ListRow } from './List'

// The drive whose history is open.
export interface HistoryDrive extends HistoryDriveRef { url: string; name: string }

interface Props {
  visible: boolean
  drive: HistoryDrive | null
  path?: string // only this file's changes, e.g. from the file explorer
  apps: <T = unknown>(app: AppName, action: string, args?: Record<string, unknown>) => Promise<AppsResult<T>>
  onClose: () => void
  onOpen: (url: string) => void
}

const KIND_ICON: Record<HistoryRow['kind'], IconName> = { added: 'plus', changed: 'pen', deleted: 'trash' }

type Viewing = { row: HistoryRow; loading: boolean; file: FileVersion | null; error: string }

function toast (text: string) {
  if (Platform.OS === 'android') ToastAndroid.show(text, ToastAndroid.SHORT)
}

// A drive's version history, as desktop's nomad://versions shows it: every change, newest first and
// grouped by day; a file as it was; and restoring a file, or the whole drive, to a point. A restore
// is one more change, so it shows here too and can be undone. Over RPC_APPS `drives`
// (backend/lib/drive-history.mjs). Only collaborative drives keep a history.
export default function VersionHistory ({ visible, drive, path: startPath, apps, onClose, onOpen }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [path, setPath] = useState(startPath || '')
  // Picked here (not opened with it): back shows every file again before it closes the screen.
  const [pathPicked, setPathPicked] = useState(false)
  const [info, setInfo] = useState<{ title: string; writable: boolean } | null>(null)
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [before, setBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [none, setNone] = useState(false)
  const [sheetRow, setSheetRow] = useState<HistoryRow | null>(null)
  const lastSheetRow = useRef<HistoryRow | null>(null)
  if (sheetRow) lastSheetRow.current = sheetRow
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const lastViewing = useRef<Viewing | null>(null)
  if (viewing) lastViewing.current = viewing
  const [busy, setBusy] = useState(false)

  const ref = drive ? { key: drive.key, type: drive.type, ns: drive.ns } : null
  const driveKey = drive?.key

  const load = useCallback(async (filter: string, more = false, from: number | null = null) => {
    if (!ref) return
    if (more) setLoadingMore(true)
    else setLoading(true)
    const res = await apps<DriveHistory | null>('drives', 'history', { drive: ref, path: filter || null, before: more ? from : null })
    if (!res.ok) setError(res.message || 'Couldn’t read the history')
    else if (!res.value) setNone(true)
    else {
      const v = res.value
      setError('')
      setNone(false)
      setInfo({ title: v.title, writable: v.writable })
      setRows((prev) => (more ? prev.concat(v.rows) : v.rows))
      setBefore(v.before)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [apps, driveKey, drive?.ns, drive?.type])

  // A new drive (or file) each time the screen opens.
  useEffect(() => {
    if (!visible || !drive) return
    setPath(startPath || '')
    setPathPicked(false)
    setRows([])
    setInfo(null)
    setBefore(null)
    setNone(false)
    setError('')
    load(startPath || '')
  }, [visible, driveKey, startPath])

  const filterTo = (p: string, picked: boolean) => {
    setPath(p)
    setPathPicked(picked)
    load(p)
  }

  const back = () => {
    if (viewing) return setViewing(null)
    if (path && pathPicked) return filterTo('', false)
    onClose()
  }

  const openViewer = async (row: HistoryRow) => {
    setViewing({ row, loading: true, file: null, error: '' })
    const res = await apps<FileVersion>('drives', 'fileAt', { drive: ref, path: row.path, version: row.restore })
    setViewing((v) => (v && v.row === row
      ? { row, loading: false, file: res.ok ? res.value || null : null, error: res.ok ? '' : res.message || 'Couldn’t read that version' }
      : v))
  }

  const restoreFile = async (row: HistoryRow) => {
    if (busy) return
    setBusy(true)
    const res = await apps<{ changed: boolean }>('drives', 'restoreFile', { drive: ref, path: row.path, version: row.restore })
    setBusy(false)
    if (!res.ok) return Alert.alert('Couldn’t restore it', res.message || '')
    setViewing(null)
    toast(res.value?.changed ? `Restored ${row.path}` : `${row.path} is already that version`)
    load(path)
  }

  // The whole drive, to just after this row's change: shows what would change, then asks.
  const restoreDrive = async (row: HistoryRow) => {
    if (busy) return
    const version = row.seq + 1
    setBusy(true)
    const res = await apps<RestoreSummary>('drives', 'restorePreview', { drive: ref, version })
    setBusy(false)
    if (!res.ok || !res.value) return Alert.alert('Couldn’t work out what would change', res.message || '')
    const sum = res.value
    if (!sum.total) return Alert.alert('Nothing to restore', 'The drive is already the way it was then.')
    const shown = sum.paths.slice(0, 8)
    const more = sum.total > shown.length ? `\nand ${sum.total - shown.length} more` : ''
    const when = row.at ? `, ${whenOf(row.at, row.approx)}` : ''
    Alert.alert(
      'Restore the whole drive?',
      `To just after ${row.path} was ${KIND_LABEL[row.kind].toLowerCase()}${when}.\n\n${restoreCounts(sum).join('\n')}\n\n${shown.join('\n')}${more}\n\nThis is saved as a new change, so you can undo it here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore drive',
          onPress: async () => {
            setBusy(true)
            const done = await apps<RestoreSummary>('drives', 'restoreDrive', { drive: ref, version })
            setBusy(false)
            if (!done.ok) return Alert.alert('Couldn’t restore the drive', done.message || '')
            const n = done.value?.total || 0
            toast(n ? `Restored the drive (${n} file${n === 1 ? '' : 's'})` : 'Nothing needed to change')
            load(path)
          }
        }
      ]
    )
  }

  if (!drive) return null
  const writable = !!info?.writable
  const driveName = info?.title || drive.name || shortKey(drive.key)
  const fileName = path ? path.split('/').pop() || path : ''
  const sr = sheetRow || lastSheetRow.current
  const vw = viewing || lastViewing.current

  let body
  if (loading) {
    body = <View style={s.center}><ActivityIndicator color={t.accent} /><Text style={s.muted}>Reading the history…</Text></View>
  } else if (error) {
    body = <Notice s={s} t={t} icon='exclamation-triangle' title='Couldn’t read the history' text={error} />
  } else if (none) {
    body = <Notice s={s} t={t} icon='history' title='This drive has no version history' text='Only collaborative drives keep a history Nomad can show. Drives made on this phone as a Hyperdrive, and older drives, don’t.' />
  } else {
    body = (
      <ScrollView contentContainerStyle={s.page}>
        {!writable ? (
          <View style={s.banner}>
            <Icon name='eye' size={14} color={t.textDim} />
            <Text style={s.bannerText}>You can look through this drive’s history. Only a device that can edit it can restore.</Text>
          </View>
        ) : null}
        {path ? (
          <View style={s.filter}>
            <Icon name='file-alt' size={14} color={t.textDim} />
            <Text style={s.filterText} numberOfLines={2}>Changes to <Text style={s.code}>{path}</Text></Text>
            <Pressable onPress={() => filterTo('', false)} style={s.chipBtn} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
              <Text style={s.chipBtnText}>Every file</Text>
            </Pressable>
          </View>
        ) : null}
        {!rows.length ? (
          <Notice s={s} t={t} icon='history' title='No changes yet' text={path ? 'This file has no changes to show.' : 'Files you add and edit show up here.'} />
        ) : groupByDay(rows).map((g) => (
          <ListSection key={g.day + g.rows[0].seq} title={g.day}>
            {g.rows.map((row, i) => (
              <ListRow
                key={row.seq}
                title={row.path}
                subtitle={rowMeta(row, formatBytes)}
                divider={i > 0}
                left={(
                  <View style={[s.kindIcon, row.kind === 'deleted' && s.kindDeleted, row.kind === 'added' && s.kindAdded]}>
                    <Icon name={KIND_ICON[row.kind]} size={12} color={row.kind === 'deleted' ? t.danger : row.kind === 'added' ? t.secure : t.trustText} />
                  </View>
                )}
                onPress={() => setSheetRow(row)}
                onLongPress={() => setSheetRow(row)}
                accessibilityLabel={`${row.path}, ${rowMeta(row, formatBytes)}`}
                right={(
                  <IconButton
                    icon='eye'
                    label={row.kind === 'deleted' ? 'See the file as it was before it was deleted' : 'See this version'}
                    size={16}
                    onPress={() => openViewer(row)}
                  />
                )}
              />
            ))}
          </ListSection>
        ))}
        {before != null ? (
          <Pressable style={s.moreBtn} onPress={() => load(path, true, before)} disabled={loadingMore} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
            {loadingMore ? <ActivityIndicator size='small' color={t.accent} /> : null}
            <Text style={s.moreText}>Show older changes</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    )
  }

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={back} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title={fileName || 'Version history'}
          subtitle={fileName ? `Version history · ${driveName}` : driveName}
          onBack={back}
          actions={[
            { icon: 'external-link-alt', label: 'Open drive', onPress: () => onOpen(drive.url), busy }
          ]}
        />
        {body}

        <ActionSheet
          visible={!!sheetRow}
          onClose={() => setSheetRow(null)}
          title={sr?.path || ''}
          subtitle={sr ? rowMeta(sr, formatBytes) : ''}
          groups={sr ? [[
            { label: sr.kind === 'deleted' ? 'See it before it was deleted' : 'See this version', icon: 'eye', onPress: () => openViewer(sr) },
            { label: sr.kind === 'deleted' ? 'Bring it back' : 'Restore this version', icon: 'undo', hidden: !writable, disabled: busy, onPress: () => restoreFile(sr) },
            { label: 'Only this file’s changes', icon: 'filter', hidden: !!path, onPress: () => filterTo(sr.path, true) }
          ], [
            { label: 'Restore the whole drive to here', icon: 'history', hidden: !writable, disabled: busy, onPress: () => restoreDrive(sr) }
          ]] : []}
        />

        <BottomSheet visible={!!viewing} onClose={() => setViewing(null)} style={s.sheet}>
          {vw ? (
            <>
              <View style={s.sheetHead}>
                <Text style={s.sheetTitle} numberOfLines={1}>{vw.row.path}</Text>
                <Text style={s.muted} numberOfLines={1}>
                  {vw.row.kind === 'deleted'
                    ? `Before it was deleted${vw.row.at ? `, ${whenOf(vw.row.at, vw.row.approx)}` : ''}`
                    : vw.row.at ? whenOf(vw.row.at, vw.row.approx) : ''}
                </Text>
              </View>
              <ScrollView style={s.fileBox} contentContainerStyle={s.fileInner}>
                {vw.loading ? <ActivityIndicator color={t.accent} />
                  : vw.error ? <Text style={s.error}>{vw.error}</Text>
                  : !vw.file?.exists ? <Text style={s.muted}>The file didn’t exist at this point.</Text>
                  : vw.file.text == null ? <Text style={s.muted}>{`This version (${formatBytes(vw.file.size)}) can’t be shown here: it isn’t text, or it’s too big. You can still restore it.`}</Text>
                  : <Text style={s.code} selectable>{vw.file.text || ' '}</Text>}
              </ScrollView>
              <View style={s.sheetActions}>
                <Pressable style={s.btnGhost} onPress={() => setViewing(null)} accessibilityRole='button'>
                  <Text style={s.btnGhostText}>Close</Text>
                </Pressable>
                {writable ? (
                  <Pressable style={[s.btn, (busy || vw.loading) && s.btnOff]} disabled={busy || vw.loading} onPress={() => restoreFile(vw.row)} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
                    <Icon name='undo' size={13} color={t.onAccent} />
                    <Text style={s.btnText}>{vw.row.kind === 'deleted' ? 'Bring it back' : 'Restore this version'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </BottomSheet>
      </SafeAreaView>
    </Modal>
  )
}

function Notice ({ s, t, icon, title, text }: { s: Styles; t: Theme; icon: IconName; title: string; text: string }) {
  return (
    <View style={s.notice}>
      <Icon name={icon} size={26} color={t.textMuted} />
      <Text style={s.noticeTitle}>{title}</Text>
      <Text style={s.noticeText}>{text}</Text>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    page: { padding: space.lg, paddingBottom: 48 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
    muted: { color: t.textMuted, fontSize: 13 },
    error: { color: t.danger, fontSize: 14 },
    banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: space.md, marginBottom: space.lg },
    bannerText: { flex: 1, color: t.textDim, fontSize: 13, lineHeight: 18 },
    filter: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: t.trustBg, borderRadius: radius.md, paddingLeft: space.md, paddingVertical: space.xs, paddingRight: space.xs, marginBottom: space.lg },
    filterText: { flex: 1, color: t.text, fontSize: 13 },
    chipBtn: { minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, overflow: 'hidden' },
    chipBtnText: { color: t.trustText, fontSize: 13, fontWeight: '600' },
    code: { color: t.text, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19 },
    kindIcon: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: t.trustBg, alignItems: 'center', justifyContent: 'center' },
    kindAdded: { backgroundColor: t.scheme === 'dark' ? 'rgba(47,158,68,0.18)' : 'rgba(47,158,68,0.12)' },
    kindDeleted: { backgroundColor: t.scheme === 'dark' ? 'rgba(209,26,26,0.2)' : 'rgba(209,26,26,0.1)' },
    moreBtn: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.xl, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, overflow: 'hidden' },
    moreText: { color: t.accent, fontSize: 14, fontWeight: '600' },
    notice: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, paddingTop: 48 },
    noticeTitle: { color: t.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
    noticeText: { color: t.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingBottom: space.md, maxHeight: '85%' },
    sheetHead: { paddingVertical: space.sm, gap: 2 },
    sheetTitle: { color: t.text, fontSize: 16, fontWeight: '600' },
    fileBox: { backgroundColor: t.bg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, marginVertical: space.sm, flexGrow: 0 },
    fileInner: { padding: space.md },
    sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, paddingTop: space.sm },
    btnGhost: { minHeight: 44, paddingHorizontal: space.lg, justifyContent: 'center' },
    btnGhostText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    btn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, backgroundColor: t.accent, borderRadius: radius.pill, paddingHorizontal: space.xl, overflow: 'hidden' },
    btnOff: { opacity: 0.5 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
