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
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import type { Backend, VaultMsg } from '../lib/useBackend'

const DEVICE_NAME_KEY = 'hb:deviceName'
const DEFAULT_DEVICE_NAME = 'My phone'

interface Props {
  visible: boolean
  onClose: () => void
  pair: Backend['pair']
  vaultStatus: Backend['vaultStatus']
  renameDevice: Backend['renameDevice']
  removeDevice: Backend['removeDevice']
  // Fired after this phone leaves the Vault (self-unlink succeeded), so the host can clean up the
  // spaces that were shared from other devices.
  onUnlinked?: () => void
}

// Devices screen — link this phone to your identity's Vault so it can read and edit all your
// spaces and drives. Mobile is a *candidate*: you enter an invite code generated on a trusted
// (desktop) device, then approve the request there. See nomad/docs/multi-device-protocol.md.
export default function Devices ({ visible, onClose, pair, vaultStatus, renameDevice, removeDevice, onUnlinked }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])

  const [status, setStatus] = useState<VaultMsg | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [confirmingSelf, setConfirmingSelf] = useState(false)
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

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>Devices</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

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
                <Text style={s.rowIcon}>▢</Text>
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
                      <Text style={s.rowMeta}>mobile</Text>
                    </View>
                    <TouchableOpacity onPress={startEditThis} hitSlop={8}>
                      <Text style={s.link}>Rename</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            {status?.hasVault ? (
              <>
                <Text style={s.sectionTitle}>Other devices</Text>
                {status.opening && (status.devices || []).filter((d) => d.key !== status.thisDeviceKey).length === 0 ? (
                  <Text style={s.empty}>Syncing… connecting to your other device.</Text>
                ) : (status.devices || []).filter((d) => d.key !== status.thisDeviceKey).length === 0 ? (
                  <Text style={s.empty}>No other devices yet.</Text>
                ) : (
                  <View style={s.list}>
                    {(status.devices || []).filter((d) => d.key !== status.thisDeviceKey).map((d) => {
                      const isSelf = false // self is rendered above as the dedicated "This device" row
                      const removing = removingKey === d.key
                      return (
                        <View key={d.key} style={s.row}>
                          <Text style={s.rowIcon}>{d.platform === 'mobile' ? '▢' : '▭'}</Text>
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
                                {isSelf
                                  ? 'Unlink this phone from your identity? It stops syncing and reverts to local-only spaces. Data already synced stays on the devices that have it.'
                                  : `Remove “${d.name}”? It loses write access from now on. It keeps anything it already synced — this can’t un-share that.`}
                              </Text>
                              <View style={s.confirmActions}>
                                <TouchableOpacity onPress={() => submitRemove(d.key, isSelf)} disabled={removing} hitSlop={8}>
                                  <Text style={[s.link, s.danger]}>{removing ? 'Removing…' : isSelf ? 'Unlink' : 'Remove'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setConfirmingKey(null)} disabled={removing} hitSlop={8}>
                                  <Text style={s.link}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : (
                            <>
                              <View style={s.rowBody}>
                                <View style={s.nameRow}>
                                  <Text style={s.rowName}>{d.name}</Text>
                                  {isSelf ? <Text style={s.thisTag}>This device</Text> : null}
                                </View>
                                <Text style={s.rowMeta}>{d.platform}</Text>
                              </View>
                              <TouchableOpacity onPress={() => { setEditingKey(d.key); setEditName(d.name) }} hitSlop={8}>
                                <Text style={s.link}>Rename</Text>
                              </TouchableOpacity>
                              {/* Self-unlink lives in the footer (works even when this row is gone). */}
                              {!isSelf ? (
                                <TouchableOpacity onPress={() => setConfirmingKey(d.key)} hitSlop={8}>
                                  <Text style={[s.link, s.danger]}>Remove</Text>
                                </TouchableOpacity>
                              ) : null}
                            </>
                          )}
                        </View>
                      )
                    })}
                  </View>
                )}

                <Text style={[s.sectionTitle, { marginTop: space.xl }]}>Shared spaces</Text>
                {(status.spaces || []).length === 0 ? (
                  <Text style={s.empty}>No spaces synced yet.</Text>
                ) : (
                  <View style={s.list}>
                    {(status.spaces || []).map((sp) => (
                      <View key={sp.rootDriveKey} style={s.row}>
                        <View style={[s.dot, { backgroundColor: sp.color || t.accent }]} />
                        <Text style={s.rowName}>{sp.name}</Text>
                      </View>
                    ))}
                  </View>
                )}

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

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border
    },
    title: { fontSize: 18, fontWeight: '600', color: t.text },
    close: { padding: space.xs },
    closeText: { fontSize: 18, color: t.textDim },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { padding: space.lg },
    lead: { fontSize: 15, color: t.text, lineHeight: 22, marginBottom: space.lg },
    sectionTitle: { fontSize: 13, fontWeight: '600', color: t.textDim, marginBottom: space.sm },
    hint: { fontSize: 13, color: t.textMuted, lineHeight: 19, marginBottom: space.md },
    error: { color: t.danger, fontSize: 13, marginBottom: space.md },
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
    list: { borderWidth: 1, borderColor: t.border, borderRadius: radius.md, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      padding: space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      backgroundColor: t.surface
    },
    rowIcon: { fontSize: 16, color: t.textDim, width: 20, textAlign: 'center' },
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
    link: { color: t.accent, fontSize: 14, fontWeight: '500', paddingHorizontal: space.xs },
    dot: { width: 12, height: 12, borderRadius: radius.pill },
    input: {
      backgroundColor: t.inputBg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      fontSize: 14,
      color: t.text,
      marginBottom: space.md
    },
    btn: {
      backgroundColor: t.accent,
      borderRadius: radius.md,
      paddingVertical: space.md,
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
