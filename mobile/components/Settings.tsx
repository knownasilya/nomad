import { useMemo } from 'react'
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ScreenHeader from './ScreenHeader'
import { ListSection, ListRow, SwitchRow } from './List'
import { useTheme, type Theme } from '../lib/theme'
import type { Backend } from '../lib/useBackend'
import { useDesktopUpdates } from '../lib/deviceUpdates'
import { useMessageNotifySetting } from '../lib/useMessageNotifications'
import { useCalendarRemindSetting } from '../lib/useCalendarReminders'
import { addSearchWidget, canAddSearchWidget } from '../lib/useSearchWidget'
import { checkForUpdate, currentVersion, installUpdate, setAutoInstall, setBetaUpdates, updatesSupported, useAutoInstall, useBetaUpdates, useUpdateState } from '../lib/updater'

interface Props {
  visible: boolean
  onClose: () => void
  onOpenDevices: () => void
  onOpenHosting: () => void
  onOpenLogs: () => void
  shareTabs: boolean
  onShareTabs: (on: boolean) => void
  apps: Backend['apps']
}

// The phone's browser settings, like desktop's nomad://settings: one list of the places to change
// how Nomad works on this phone, plus the logs for when something goes wrong.
export default function Settings ({ visible, onClose, onOpenDevices, onOpenHosting, onOpenLogs, shareTabs, onShareTabs, apps }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const update = useUpdateState()
  const auto = useAutoInstall()
  const beta = useBetaUpdates()
  const version = currentVersion()
  // The user's computers, so one on an older Nomad can be updated from here too.
  const computers = useDesktopUpdates(apps, visible)
  const [notifyMessages, setNotifyMessages] = useMessageNotifySetting()
  const [notifyCalendar, setNotifyCalendar] = useCalendarRemindSetting()
  // Android's launcher can add the home screen search widget for us (modules/nomad-search-widget).
  const canPinWidget = useMemo(() => canAddSearchWidget(), [])

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
          {canPinWidget ? (
            <ListSection title='Home screen'>
              <ListRow
                icon='search'
                title='Add the search widget'
                subtitle='A search bar on your home screen. It opens a new tab ready to type in, in the Space you pick.'
                subtitleLines={2}
                onPress={addSearchWidget}
              />
            </ListSection>
          ) : null}
          <ListSection title='Notifications'>
            <SwitchRow
              icon='comments'
              title='Messages'
              subtitle='A notification for each new message to your Personas. Message requests never notify.'
              value={notifyMessages}
              onValueChange={setNotifyMessages}
            />
            <SwitchRow
              icon='bell'
              title='Calendar reminders'
              subtitle='When an event you or someone in your shared Space set a reminder on is coming up.'
              value={notifyCalendar}
              onValueChange={setNotifyCalendar}
              divider
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
          {computers.desktops.length ? (
            <ListSection
              title='Your computers'
              footer={computers.error || 'Update installs the newest Nomad on that computer and restarts it. Its windows and tabs come back.'}
            >
              {computers.desktops.map((d, i) => (
                <ListRow
                  key={d.key}
                  icon='laptop'
                  title={d.name}
                  subtitle={d.message || (d.version ? `v${d.version}${d.behind ? ' · older than this phone' : ''}` : 'Version unknown')}
                  subtitleLines={2}
                  divider={i > 0}
                  right={d.busy
                    ? <ActivityIndicator size='small' color={t.accent} />
                    : d.behind
                      ? (
                        <Pressable onPress={() => computers.request(d.key)} hitSlop={10} accessibilityRole='button' accessibilityLabel={`Update ${d.name} and restart it`}>
                          <Text style={s.action}>Update</Text>
                        </Pressable>
                        )
                      : null}
                />
              ))}
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
    value: { color: t.textDim, fontSize: 13 },
    action: { color: t.accent, fontSize: 15, fontWeight: '600' }
  })
}
