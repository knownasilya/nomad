import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ScreenHeader from './ScreenHeader'
import Icon from './Icon'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import type { Backend, DeviceSpace, DriveSync, VaultDevice, VaultMsg } from '../lib/useBackend'
import type { Space } from '../lib/useSpaces'
import { currentVersion } from '../lib/updater'
import { useDesktopUpdates } from '../lib/deviceUpdates'

const DEVICE_NAME_KEY = 'hb:deviceName'
const DEFAULT_DEVICE_NAME = 'My phone'

interface Props {
  visible: boolean
  onClose: () => void
  pair: Backend['pair']
  vaultStatus: Backend['vaultStatus']
  renameDevice: Backend['renameDevice']
  removeDevice: Backend['removeDevice']
  // For asking a computer to update and restart (lib/deviceUpdates.ts).
  apps: Backend['apps']
  // This phone's Spaces, so the sync status can line them up with the Vault's.
  spaces?: Space[]
  // Fired after this phone leaves the Vault (self-unlink succeeded), so the host can clean up the
  // spaces that were shared from other devices.
  onUnlinked?: () => void
}

// Devices screen — link this phone to your identity's Vault so it can read and edit all your
// spaces and drives. Mobile is a *candidate*: you enter an invite code generated on a trusted
// (desktop) device, then approve the request there. See nomad/docs/multi-device-protocol.md.
export default function Devices ({ visible, onClose, pair, vaultStatus: vaultStatusFor, renameDevice, removeDevice, apps, spaces = [], onUnlinked }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])

  // Every status read sends this phone's Spaces, so the backend reports their sync state and keeps
  // this phone's own Device record listing them (what the user's other Devices show for it).
  const ownSpacesRef = useRef<DeviceSpace[]>([])
  ownSpacesRef.current = spaces
    .filter((sp) => sp.rootDriveKey)
    .map((sp) => ({ rootDriveKey: sp.rootDriveKey as string, name: sp.name }))
  const vaultStatus = () => vaultStatusFor(ownSpacesRef.current.map((sp) => sp.rootDriveKey), ownSpacesRef.current)

  const [status, setStatus] = useState<VaultMsg | null>(null)
  const updates = useDesktopUpdates(apps, visible && !!status?.hasVault)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [confirmingSelf, setConfirmingSelf] = useState(false)
  // Sync details are for debugging a Space that won't sync, so they start collapsed.
  const [showSyncDetails, setShowSyncDetails] = useState(false)
  // Stable handle for the "unlink this phone" action — works even when this device's own row is
  // absent (e.g. it was removed on another device), in which case thisDeviceKey may be missing.
  const selfKey = status?.thisDeviceKey || '__self__'

  // This phone's own name — a built-in "This device" entry (like nomad's), renameable and always
  // present even when this device has no Vault record yet. Stored locally; used as the name sent at
  // pairing, and synced into the Vault record when this device is a writable member.
  const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME)
  const [editingThis, setEditingThis] = useState(false)
  const [thisDraft, setThisDraft] = useState('')

  useEffect(() => {
    AsyncStorage.getItem(DEVICE_NAME_KEY).then((v) => { if (v) setDeviceName(v) }).catch(() => {})
  }, [])

  // Prefer the Vault record's name (synced across devices) when this device has one, else the local
  // name. The own record is matched by thisDeviceKey.
  const ownRecord = (status?.devices || []).find((d) => d.key && d.key === status?.thisDeviceKey)
  const thisName = ownRecord?.name || deviceName

  const startEditThis = () => { setThisDraft(thisName); setEditingThis(true) }

  const saveThisName = async () => {
    const name = thisDraft.trim()
    setEditingThis(false)
    if (!name || name === thisName) return
    setDeviceName(name)
    AsyncStorage.setItem(DEVICE_NAME_KEY, name).catch(() => {})
    // Sync into the Vault record too, if this device is registered there (best-effort — no-ops /
    // stays local when the Vault is read-only on this device).
    if (status?.hasVault && status.thisDeviceKey) {
      try {
        const res = await renameDevice(status.thisDeviceKey, name)
        if (res.hasVault) setStatus(res)
      } catch {}
    }
  }

  const refresh = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const res = await vaultStatus()
      setStatus(res)
      if (!res.hasVault && res.message) setError(res.message)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Invalidates in-flight pair()/refresh() results: bumped on cancel and on close so a late
  // backend reply can't flip the UI back into a spinner after the user moved on.
  const submitToken = useRef(0)

  // While the screen is open, poll so it stays live: the linked device + shared spaces replicate a
  // beat after pairing (the Vault opens in the background), and remote renames/removals show up
  // without reopening. The initial load happens in the effect below.
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const id = setInterval(() => {
      vaultStatus().then((res) => { if (!cancelled) setStatus(res) }).catch(() => {})
    }, 3000)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(() => {
    if (visible) {
      refresh()
    } else {
      // Reset transient state on close so reopening never shows a stale spinner.
      submitToken.current++
      setBusy(false)
      setLoading(false)
      setError('')
      setEditingKey(null)
      setConfirmingKey(null)
      setRemovingKey(null)
      setConfirmingSelf(false)
      setEditingThis(false)
    }
  }, [visible])

  const cancelPairing = () => {
    submitToken.current++
    setBusy(false)
  }

  const submitRename = async (key: string) => {
    const name = editName.trim()
    setEditingKey(null)
    if (!name) return
    try {
      const res = await renameDevice(key, name)
      if (res.hasVault) setStatus(res)
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  // Remove a device. For this phone (self) it leaves the Vault entirely — the backend forgets the
  // local Vault key and vaultStatus comes back unpaired, so the UI returns to the pairing screen.
  const submitRemove = async (key: string, self: boolean) => {
    setRemovingKey(key)
    setError('')
    try {
      const res = await removeDevice(key, self)
      // A non-self remove that comes back still paired but carries a message failed (e.g. the Vault
      // isn't writable here yet) — show why instead of silently leaving the row in place.
      if (!self && res.hasVault && res.message) {
        setError(res.message)
        return
      }
      setStatus(res)
      // Self-unlink left the Vault: hand off to the host (spaces cleanup) and close this screen so
      // the prompt shows over the browser rather than dropping the user on the pairing form.
      if (self && !res.hasVault) {
        onUnlinked?.()
        onClose()
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setRemovingKey(null)
      setConfirmingKey(null)
    }
  }

  const onSubmit = async () => {
    if (!code.trim()) return
    const token = ++submitToken.current
    setBusy(true)
    setError('')
    try {
      const res = await pair(code.trim(), deviceName)
      if (token !== submitToken.current) return // cancelled or window closed
      if (!res.ok) {
        setError(res.message || 'Pairing failed')
      } else {
        // Show the paired state right away; the Vault may still be replicating, so populate
        // devices/spaces in the background rather than blocking on a full-screen reload.
        setCode('')
        setStatus({ reqId: '', hasVault: true, opening: true, devices: [], spaces: [] })
        refresh({ silent: true })
      }
    } catch (e: any) {
      if (token === submitToken.current) setError(e?.message || String(e))
    } finally {
      if (token === submitToken.current) setBusy(false)
    }
  }

  const otherDevices = (status?.devices || []).filter((d) => d.key !== status?.thisDeviceKey)
  // Each Device writes the version it runs on its own record; flag the ones not on this phone's.
  const myVersion = currentVersion()
  const mismatch = (d: VaultDevice) => !!myVersion && !!d.version && d.version !== myVersion
  const mismatched = otherDevices.filter(mismatch)
  const connectedKeys = new Set(status?.connectedDevices || [])
  const phoneKeys = new Set(spaces.map((sp) => sp.rootDriveKey).filter(Boolean) as string[])
  const vaultKeys = new Set((status?.spaces || []).filter((vs) => !vs.movedTo).map((vs) => vs.rootDriveKey))
  // A Device record carries Space names only; borrow the color from this phone or the Vault index.
  const spaceColors = new Map<string, string>()
  for (const vs of status?.spaces || []) if (vs.color) spaceColors.set(vs.rootDriveKey, vs.color)
  for (const sp of spaces) if (sp.rootDriveKey) spaceColors.set(sp.rootDriveKey, sp.color)

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader title='Devices' onBack={onClose} />

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.body}>
            {/* This device — a built-in, always-present entry pinned to the top (mirrors nomad). Renameable only. */}
            <Text style={s.sectionTitle}>This device</Text>
            <View style={[s.list, { marginBottom: space.xl }]}>
              <View style={s.row}>
                <Icon name='mobile-alt' size={18} color={t.textDim} style={s.rowIcon} />
                {editingThis ? (
                  <>
                    <TextInput
                      style={[s.input, s.rowInput]}
                      value={thisDraft}
                      onChangeText={setThisDraft}
                      autoFocus
                      autoCapitalize='none'
                      onSubmitEditing={saveThisName}
                    />
                    <TouchableOpacity onPress={saveThisName} hitSlop={8}>
                      <Text style={s.link}>Save</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <View style={s.rowBody}>
                      <View style={s.nameRow}>
                        <Text style={s.rowName}>{thisName}</Text>
                        <Text style={s.thisTag}>This device</Text>
                      </View>
                      <Text style={s.rowMeta}>mobile{myVersion ? ` · v${myVersion}` : ''}</Text>
                      <SpaceChips
                        list={spaces.map((sp) => ({
                          key: sp.rootDriveKey || sp.id,
                          name: sp.name,
                          color: sp.color,
                          // Paired, but this Space isn't in the Vault, so no other Device gets it.
                          warn: status?.hasVault && !status.opening && sp.rootDriveKey && !vaultKeys.has(sp.rootDriveKey)
                            ? 'Not shared'
                            : ''
                        }))}
                        s={s}
                      />
                    </View>
                    <TouchableOpacity onPress={startEditThis} hitSlop={8}>
                      <Text style={s.link}>Rename</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {error || updates.error ? <Text style={s.error}>{error || updates.error}</Text> : null}

            {status?.hasVault ? (
              <>
                <Text style={s.sectionTitle}>Other devices</Text>
                {mismatched.length ? (
                  <Text style={s.versionWarn}>
                    {`${mismatched.map((d) => d.name).join(', ')} ${mismatched.length === 1 ? 'runs' : 'run'} a different version of Nomad than this phone (v${myVersion}). Update your devices to the same version so they sync the same way.`}
                  </Text>
                ) : null}
                {status.opening && otherDevices.length === 0 ? (
                  <Text style={s.empty}>Syncing… connecting to your other device.</Text>
                ) : otherDevices.length === 0 ? (
                  <Text style={s.empty}>No other devices yet.</Text>
                ) : (
                  <View style={s.list}>
                    {otherDevices.map((d) => {
                      const removing = removingKey === d.key
                      const connected = connectedKeys.has(d.key)
                      return (
                        <View key={d.key} style={s.row}>
                          <Icon name={d.platform === 'mobile' ? 'mobile-alt' : 'laptop'} size={16} color={t.textDim} style={s.rowIcon} />
                          {editingKey === d.key ? (
                            <>
                              <TextInput
                                style={[s.input, s.rowInput]}
                                value={editName}
                                onChangeText={setEditName}
                                autoFocus
                                autoCapitalize='none'
                                onSubmitEditing={() => submitRename(d.key)}
                              />
                              <TouchableOpacity onPress={() => submitRename(d.key)} hitSlop={8}>
                                <Text style={s.link}>Save</Text>
                              </TouchableOpacity>
                            </>
                          ) : confirmingKey === d.key ? (
                            <View style={s.confirmBody}>
                              <Text style={s.confirmText}>
                                {`Remove “${d.name}”? It loses write access from now on. It keeps anything it already synced — this can’t un-share that.`}
                              </Text>
                              <View style={s.confirmActions}>
                                <TouchableOpacity onPress={() => submitRemove(d.key, false)} disabled={removing} hitSlop={8}>
                                  <Text style={[s.link, s.danger]}>{removing ? 'Removing…' : 'Remove'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setConfirmingKey(null)} disabled={removing} hitSlop={8}>
                                  <Text style={s.link}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : (
                            <View style={s.rowBody}>
                              <View style={s.rowTop}>
                                <View style={s.rowBody}>
                                  <Text style={s.rowName}>{d.name}</Text>
                                  <View style={s.statusRow}>
                                    <View style={[s.dot, { backgroundColor: connected ? t.secure : t.textMuted }]} />
                                    <Text style={[s.rowMeta, s.statusText, connected && { color: t.secure }]}>
                                      {connected ? 'Connected' : 'Not connected'} · {d.platform}
                                    </Text>
                                  </View>
                                  <View style={s.tagRow}>
                                    {d.version
                                      ? <Text style={[s.tag, mismatch(d) && s.tagWarn]}>v{d.version}{mismatch(d) ? ' · different version' : ''}</Text>
                                      : <Text style={s.tag}>Version unknown</Text>}
                                  </View>
                                  <DesktopUpdate update={updates.desktops.find((u) => u.key === d.key)} onUpdate={updates.request} s={s} t={t} />
                                </View>
                                <TouchableOpacity onPress={() => { setEditingKey(d.key); setEditName(d.name) }} hitSlop={8}>
                                  <Text style={s.link}>Rename</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setConfirmingKey(d.key)} hitSlop={8}>
                                  <Text style={[s.link, s.danger]}>Remove</Text>
                                </TouchableOpacity>
                              </View>
                              <DeviceSpaces device={d} phoneKeys={phoneKeys} colors={spaceColors} s={s} />
                            </View>
                          )}
                        </View>
                      )
                    })}
                  </View>
                )}

                {/* Debugging detail for a Space that won't sync: collapsed until asked for. */}
                <TouchableOpacity
                  style={s.detailsToggle}
                  onPress={() => setShowSyncDetails((v) => !v)}
                  hitSlop={8}
                  accessibilityRole='button'
                  accessibilityState={{ expanded: showSyncDetails }}
                >
                  <Icon name={showSyncDetails ? 'chevron-down' : 'chevron-right'} size={11} color={t.textDim} style={s.detailsChevron} />
                  <Text style={s.detailsTitle}>Sync details</Text>
                  <Text style={s.detailsSummary}>{syncSummary(status)}</Text>
                </TouchableOpacity>
                {showSyncDetails ? <SyncStatusList status={status} spaces={spaces} s={s} t={t} /> : null}

                {/* Always-available escape hatch: leave the Vault on this phone. Works even if this
                    device's own row is gone (e.g. it was removed on another device while the app was
                    closed), which is otherwise a dead end. */}
                <View style={s.leaveSection}>
                  {confirmingSelf ? (
                    <View style={s.leaveConfirm}>
                      <Text style={s.confirmText}>
                        Unlink this phone from your identity? It stops syncing and reverts to
                        local-only spaces. Data already synced stays on the devices that have it.
                      </Text>
                      <View style={s.confirmActions}>
                        <TouchableOpacity onPress={() => submitRemove(selfKey, true)} disabled={removingKey === selfKey} hitSlop={8}>
                          <Text style={[s.link, s.danger]}>{removingKey === selfKey ? 'Unlinking…' : 'Unlink'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setConfirmingSelf(false)} disabled={removingKey === selfKey} hitSlop={8}>
                          <Text style={s.link}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.leaveBtn} onPress={() => setConfirmingSelf(true)}>
                      <Text style={[s.link, s.danger]}>Unlink this phone</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              <>
                <Text style={s.lead}>
                  Link this phone to your identity so it can read and edit all your spaces and
                  drives.
                </Text>
                <Text style={s.sectionTitle}>Enter an invite code</Text>
                <Text style={s.hint}>
                  On a device that's already set up (e.g. Nomad on your computer), open Settings →
                  Devices → Add a device, then enter the code here. You'll approve this phone on
                  that device.
                </Text>
                <TextInput
                  style={s.input}
                  placeholder='Paste invite code'
                  placeholderTextColor={t.textMuted}
                  autoCapitalize='none'
                  autoCorrect={false}
                  value={code}
                  onChangeText={setCode}
                  editable={!busy}
                />
                {busy ? (
                  <View>
                    <View style={s.waitingRow}>
                      <ActivityIndicator color={t.accent} />
                      <Text style={s.waitingText}>Waiting for approval on your other device…</Text>
                    </View>
                    <TouchableOpacity style={s.btnSecondary} onPress={cancelPairing}>
                      <Text style={s.btnSecondaryText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[s.btn, !code.trim() && s.btnDisabled]}
                    disabled={!code.trim()}
                    onPress={onSubmit}
                  >
                    <Text style={s.btnText}>Link this device</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

type Styles = ReturnType<typeof makeStyles>

// Under a computer that runs an older Nomad than this phone: ask it to update and restart, then
// follow how it goes (the computer writes its progress to the Vault).
function DesktopUpdate ({ update, onUpdate, s, t }: { update?: ReturnType<typeof useDesktopUpdates>['desktops'][number]; onUpdate: (key: string) => Promise<boolean>; s: Styles; t: Theme }) {
  if (!update || (!update.behind && !update.message)) return null
  return (
    <View style={s.updateRow}>
      {update.busy ? <ActivityIndicator size='small' color={t.accent} /> : null}
      {update.message ? <Text style={[s.rowMeta, s.updateText]}>{update.message}</Text> : null}
      {update.behind && !update.busy ? (
        <TouchableOpacity onPress={() => onUpdate(update.key)} hitSlop={8} accessibilityRole='button'>
          <Text style={s.link}>Update and restart</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

interface Chip { key: string; name: string; color?: string; warn?: string }

// A wrap of Space chips: a color dot, the name, and a warning when the Space is out of step.
function SpaceChips ({ list, s }: { list: Chip[]; s: Styles }) {
  if (!list.length) return <Text style={s.spacesNote}>No spaces</Text>
  return (
    <View style={s.chipRow}>
      {list.map((chip) => (
        <View key={chip.key} style={[s.chip, chip.warn ? s.chipWarn : null]}>
          <View style={[s.chipDot, { backgroundColor: chip.color || '#6c6cff' }]} />
          <Text style={s.chipText} numberOfLines={1}>{chip.name}</Text>
          {chip.warn ? <Text style={s.chipWarnText}>{chip.warn}</Text> : null}
        </View>
      ))}
    </View>
  )
}

// The Spaces another Device has, as it last recorded them in the Vault. One that isn't on this phone
// is flagged: that is the Space to look for in Sync details.
function DeviceSpaces ({ device, phoneKeys, colors, s }: { device: VaultDevice; phoneKeys: Set<string>; colors: Map<string, string>; s: Styles }) {
  if (!Array.isArray(device.spaces)) {
    return <Text style={s.spacesNote}>Update Nomad on this device to see its spaces.</Text>
  }
  return (
    <SpaceChips
      list={device.spaces.map((sp) => ({
        key: sp.rootDriveKey,
        name: sp.name || 'Space',
        color: colors.get(sp.rootDriveKey),
        warn: phoneKeys.has(sp.rootDriveKey) ? '' : 'Not on this phone'
      }))}
      s={s}
    />
  )
}

// One line for the collapsed Sync details header: the worst thing it would show.
function syncSummary (status: VaultMsg): string {
  const sync = status.sync
  if (!sync) return 'Checking…'
  const all = [sync.vault, ...sync.spaces]
  const failed = all.filter((st) => st.error).length
  if (failed) return `${failed} with an error`
  if (sync.connections === 0) return 'No peers connected'
  const behind = all.filter((st) => st.loaded && (st.remoteLength || 0) > (st.length || 0)).length
  if (behind) return `Syncing ${behind}`
  const noPeers = all.filter((st) => st.loaded && !st.peers).length
  if (noPeers) return `${noPeers} without peers`
  return 'All synced'
}

// Connection and replication state of the Vault and each Space. A Space that is on only one side
// (this phone vs the Vault index), or under a different key, is the usual reason a Space looks empty.
function SyncStatusList ({ status, spaces, s, t }: { status: VaultMsg; spaces: Space[]; s: Styles; t: Theme }) {
  const sync = status.sync
  if (!sync) return <Text style={s.empty}>Checking sync status…</Text>
  const vaultSpaces = status.spaces || []
  const rows = sync.spaces.map((st) => {
    const mine = spaces.find((sp) => sp.rootDriveKey === st.key)
    const inVault = vaultSpaces.find((vs) => vs.rootDriveKey === st.key)
    return { st, name: mine?.name || inVault?.name || 'Space', mine: !!mine, inVault: !!inVault, movedTo: inVault?.movedTo }
  })
  return (
    <>
      <View style={s.list}>
        <View style={s.row}>
          <View style={s.rowBody}>
            <Text style={s.rowName}>Network</Text>
            <View style={s.tagRow}>
              {sync.connections === 0
                ? <Text style={[s.tag, s.tagWarn]}>No peers connected</Text>
                : <Text style={s.tag}>{sync.connections} peer connection{sync.connections === 1 ? '' : 's'}</Text>}
            </View>
          </View>
        </View>
        <SyncRow name='Vault' st={sync.vault} tags={[]} s={s} t={t} />
        {rows.map(({ st, name, mine, inVault, movedTo }) => (
          <SyncRow
            key={st.key}
            name={name}
            st={st}
            s={s}
            t={t}
            tags={[
              !mine ? 'Not on this phone' : '',
              !inVault ? 'Not shared in Vault' : '',
              movedTo ? `Moved to ${movedTo.slice(0, 8)}…` : ''
            ].filter(Boolean)}
          />
        ))}
      </View>
      <Text style={[s.hint, { marginTop: space.sm }]}>
        Each of your devices should list the same spaces, with the same key. Synced means this phone
        has everything its connected peers have.
      </Text>
    </>
  )
}

function SyncRow ({ name, st, tags, s, t }: { name: string; st: DriveSync; tags: string[]; s: Styles; t: Theme }) {
  let state: { label: string; warn?: boolean; ok?: boolean }
  if (!st.loaded) state = { label: 'Not opened yet' }
  else if (!st.peers) state = { label: 'No peers', warn: true }
  else if ((st.remoteLength || 0) > (st.length || 0)) state = { label: `Syncing ${st.length}/${st.remoteLength}`, warn: true }
  else state = { label: `Synced · ${st.peers} peer${st.peers === 1 ? '' : 's'}`, ok: true }
  return (
    <View style={s.row}>
      <View style={s.rowBody}>
        <View style={s.nameRow}>
          <Text style={s.rowName}>{name}</Text>
          <Text style={s.keyText}>{(st.key || '').slice(0, 8)}…</Text>
        </View>
        <View style={s.tagRow}>
          <Text style={[s.tag, state.warn && s.tagWarn, state.ok && { color: t.secure }]}>{state.label}</Text>
          {st.loaded ? <Text style={s.tag}>{st.writable ? 'Writable' : 'Read-only'}</Text> : null}
          {typeof st.driveCount === 'number'
            ? <Text style={s.tag}>{st.driveCount} drive{st.driveCount === 1 ? '' : 's'}</Text>
            : null}
          {tags.map((tag) => <Text key={tag} style={[s.tag, s.tagWarn]}>{tag}</Text>)}
        </View>
        {st.error
          ? (
            <Text style={s.syncError} selectable>
              Error{st.errorAt ? ` at ${new Date(st.errorAt).toLocaleTimeString()}` : ''}: {st.error}
            </Text>
            )
          : null}
      </View>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { padding: space.lg },
    lead: { fontSize: 15, color: t.text, lineHeight: 22, marginBottom: space.lg },
    sectionTitle: { fontSize: 13, fontWeight: '600', color: t.textDim, marginBottom: space.sm },
    hint: { fontSize: 13, color: t.textMuted, lineHeight: 19, marginBottom: space.md },
    error: { color: t.danger, fontSize: 13, marginBottom: space.md },
    syncError: { color: t.danger, fontSize: 12, lineHeight: 17, marginTop: space.xs },
    empty: {
      color: t.textMuted,
      fontSize: 14,
      padding: space.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: t.border,
      borderRadius: radius.md,
      textAlign: 'center'
    },
    list: { backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: radius.lg, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      backgroundColor: t.surface
    },
    rowIcon: { width: 22, textAlign: 'center' },
    rowBody: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
    rowName: { fontSize: 15, color: t.text },
    thisTag: { fontSize: 11, fontWeight: '600', color: t.trustText, backgroundColor: t.trustBg, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
    rowMeta: { fontSize: 12, color: t.textMuted, marginTop: 2 },
    rowInput: { flex: 1, marginBottom: 0, paddingVertical: space.xs },
    confirmBody: { flex: 1, gap: space.sm },
    confirmText: { fontSize: 13, color: t.textDim, lineHeight: 18 },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.md },
    danger: { color: t.danger },
    leaveSection: { marginTop: space.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, paddingTop: space.lg },
    leaveBtn: { alignSelf: 'flex-start', paddingVertical: space.xs },
    leaveConfirm: { gap: space.sm },
    // Text buttons in a row: padded out to a comfortable touch target.
    link: { color: t.accent, fontSize: 14, fontWeight: '600', paddingHorizontal: space.xs, paddingVertical: space.sm },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    statusText: { marginTop: 0 },
    spacesNote: { fontSize: 12, color: t.textMuted, marginTop: space.sm },
    updateRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
    updateText: { flex: 1 },
    versionWarn: { fontSize: 13, lineHeight: 18, color: t.warn, marginBottom: space.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: '100%',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
      borderRadius: radius.pill,
      paddingHorizontal: space.sm,
      paddingVertical: 3
    },
    chipWarn: { borderColor: t.warn },
    chipDot: { width: 8, height: 8, borderRadius: radius.pill },
    chipText: { fontSize: 12, color: t.text, flexShrink: 1 },
    chipWarnText: { fontSize: 11, color: t.warn },
    detailsToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl, marginBottom: space.sm, paddingVertical: space.xs },
    detailsChevron: { width: 12, textAlign: 'center' },
    detailsTitle: { fontSize: 13, fontWeight: '600', color: t.textDim },
    detailsSummary: { flex: 1, textAlign: 'right', fontSize: 12, color: t.textMuted },
    keyText: { fontSize: 11, color: t.textMuted, fontFamily: 'monospace' },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
    tag: { fontSize: 11, color: t.textDim, backgroundColor: t.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
    tagWarn: { color: t.warn },
    input: {
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      minHeight: 44,
      fontSize: 14,
      color: t.text,
      marginBottom: space.md
    },
    btn: {
      backgroundColor: t.accent,
      borderRadius: radius.pill,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center'
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' },
    waitingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
    waitingText: { flex: 1, color: t.textDim, fontSize: 14 },
    btnSecondary: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingVertical: space.md,
      alignItems: 'center'
    },
    btnSecondaryText: { color: t.text, fontSize: 15, fontWeight: '500' }
  })
}
