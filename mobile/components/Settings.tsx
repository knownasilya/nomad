import { useMemo } from 'react'
import { Modal, Platform, ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ScreenHeader from './ScreenHeader'
import { ListSection, ListRow, SwitchRow } from './List'
import { useTheme, type Theme } from '../lib/theme'
import { checkForUpdate, currentVersion, installUpdate, setAutoInstall, setBetaUpdates, updatesSupported, useAutoInstall, useBetaUpdates, useUpdateState } from '../lib/updater'

interface Props {
  visible: boolean
  onClose: () => void
  onOpenDevices: () => void
  onOpenHosting: () => void
  onOpenLogs: () => void
  shareTabs: boolean
  onShareTabs: (on: boolean) => void
}

// The phone's browser settings, like desktop's nomad://settings: one list of the places to change
// how Nomad works on this phone, plus the logs for when something goes wrong.
export default function Settings ({ visible, onClose, onOpenDevices, onOpenHosting, onOpenLogs, shareTabs, onShareTabs }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const update = useUpdateState()
  const auto = useAutoInstall()
  const beta = useBetaUpdates()
  const version = currentVersion()

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader title='Settings' onBack={onClose} />
        <ScrollView contentContainerStyle={s.page}>
          <ListSection>
            <ListRow icon='laptop' title='Devices' subtitle='Your other devices, the spaces they share, and sync details' subtitleLines={2} chevron onPress={onOpenDevices} />
            <ListRow icon='server' title='Hosting' subtitle='How much data hosting drives may use each day' subtitleLines={2} chevron divider onPress={onOpenHosting} />
          </ListSection>
          <ListSection title='Open tabs'>
            <SwitchRow
              icon='clone'
              title="Share this phone's open tabs"
              subtitle='Your other devices list them by space. Turning this off removes them there.'
              value={shareTabs}
              onValueChange={onShareTabs}
            />
          </ListSection>
          {updatesSupported ? (
            <ListSection title='Updates'>
              <SwitchRow
                icon='download'
                title='Install updates automatically'
                subtitle={update.kind === 'downloading' || update.kind === 'installing' ? `Updating to ${update.release.version}…`
                  : update.kind === 'failed' ? update.error
                    : 'New releases install when you open Nomad. Android asks you to confirm the first one.'}
                value={auto}
                onValueChange={setAutoInstall}
              />
              <SwitchRow
                icon='flask'
                title='Beta releases'
                subtitle='Get test builds before they are released to everyone. They can have bugs.'
                value={beta}
                onValueChange={setBetaUpdates}
                divider
              />
              {update.kind === 'available' ? (
                <ListRow icon='arrow-circle-up' iconColor={t.accent} title={`Update to ${update.release.version}`} accent divider onPress={() => installUpdate(update.release)} />
              ) : (
                <ListRow icon='sync-alt' iconColor={t.accent} title='Check for updates' accent divider onPress={() => checkForUpdate({ force: true })} />
              )}
            </ListSection>
          ) : null}
          <ListSection title='Troubleshooting'>
            <ListRow icon='terminal' title='Logs' subtitle='What the app and its peer-to-peer backend have logged, including the last run' subtitleLines={2} chevron onPress={onOpenLogs} />
          </ListSection>
          <ListSection title='About'>
            {version ? <ListRow icon='info-circle' title='Version' right={<Text style={s.value}>{version}</Text>} /> : null}
            <ListRow icon='mobile-alt' title='Platform' divider={!!version} right={<Text style={s.value}>{Platform.OS} {String(Platform.Version)}</Text>} />
          </ListSection>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    page: { padding: 16 },
    value: { color: t.textDim, fontSize: 13 }
  })
}
