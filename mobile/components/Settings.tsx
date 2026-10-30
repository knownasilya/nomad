import { useMemo } from 'react'
import { Modal, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { radius, useTheme, type Theme } from '../lib/theme'
import { checkForUpdate, currentVersion, installUpdate, setAutoInstall, setBetaUpdates, updatesSupported, useAutoInstall, useBetaUpdates, useUpdateState } from '../lib/updater'

interface Props {
  visible: boolean
  onClose: () => void
  onOpenDevices: () => void
  onOpenHosting: () => void
  onOpenLogs: () => void
}

// The phone's browser settings, like desktop's nomad://settings: one list of the places to change
// how Nomad works on this phone, plus the logs for when something goes wrong.
export default function Settings ({ visible, onClose, onOpenDevices, onOpenHosting, onOpenLogs }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const update = useUpdateState()
  const auto = useAutoInstall()
  const beta = useBetaUpdates()
  const version = currentVersion()

  const rows: { title: string; sub: string; onPress: () => void }[][] = [
    [
      { title: 'Devices', sub: 'Your other devices, the spaces they share, and sync details', onPress: onOpenDevices },
      { title: 'Hosting', sub: 'How much data hosting drives may use each day', onPress: onOpenHosting }
    ],
    [
      { title: 'Logs', sub: 'What the app and its peer-to-peer backend have logged, including the last run', onPress: onOpenLogs }
    ]
  ]

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>Settings</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.page}>
          {rows.map((group, gi) => (
            <View key={gi} style={s.card}>
              {group.map((row, i) => (
                <TouchableOpacity key={row.title} style={[s.row, i > 0 && s.rowDivider]} onPress={row.onPress}>
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>{row.title}</Text>
                    <Text style={s.rowSub}>{row.sub}</Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {updatesSupported ? (
            <>
              <Text style={s.sectionTitle}>Updates</Text>
              <View style={s.card}>
                <View style={s.row}>
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>Install updates automatically</Text>
                    <Text style={s.rowSub}>
                      {update.kind === 'downloading' || update.kind === 'installing' ? `Updating to ${update.release.version}…`
                        : update.kind === 'failed' ? update.error
                          : 'New releases install when you open Nomad. Android asks you to confirm the first one.'}
                    </Text>
                  </View>
                  <Switch
                    value={auto}
                    onValueChange={setAutoInstall}
                    trackColor={{ false: t.border, true: t.accent }}
                    thumbColor={t.surface}
                  />
                </View>
                <View style={[s.row, s.rowDivider]}>
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>Beta releases</Text>
                    <Text style={s.rowSub}>Get test builds before they are released to everyone. They can have bugs.</Text>
                  </View>
                  <Switch
                    value={beta}
                    onValueChange={setBetaUpdates}
                    trackColor={{ false: t.border, true: t.accent }}
                    thumbColor={t.surface}
                  />
                </View>
                {update.kind === 'available' ? (
                  <TouchableOpacity style={[s.row, s.rowDivider]} onPress={() => installUpdate(update.release)}>
                    <Text style={[s.rowTitle, s.flex, s.link]}>Update to {update.release.version}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[s.row, s.rowDivider]} onPress={() => checkForUpdate({ force: true })}>
                    <Text style={[s.rowTitle, s.flex, s.link]}>Check for updates</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          ) : null}
          <Text style={s.sectionTitle}>About</Text>
          <View style={s.card}>
            {version ? (
              <View style={[s.row, s.rowDividerBelow]}>
                <Text style={[s.rowTitle, s.flex]}>Version</Text>
                <Text style={s.value}>{version}</Text>
              </View>
            ) : null}
            <View style={s.row}>
              <Text style={[s.rowTitle, s.flex]}>Platform</Text>
              <Text style={s.value}>{Platform.OS} {String(Platform.Version)}</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
    title: { color: t.text, fontSize: 20, fontWeight: '700' },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: t.textDim, fontSize: 18 },
    page: { padding: 16 },
    sectionTitle: { color: t.textDim, fontSize: 13, fontWeight: '600', marginBottom: 8 },
    card: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden', marginBottom: 18 },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 14, gap: 12 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    rowDividerBelow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    rowText: { flex: 1, paddingVertical: 10 },
    rowTitle: { color: t.text, fontSize: 14, fontWeight: '500' },
    rowSub: { color: t.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 },
    chevron: { color: t.textMuted, fontSize: 22 },
    flex: { flex: 1 },
    value: { color: t.textDim, fontSize: 13 },
    link: { color: t.accent }
  })
}
