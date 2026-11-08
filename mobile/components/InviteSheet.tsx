import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, TouchableOpacity, ScrollView, ActivityIndicator, Share, StyleSheet } from 'react-native'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import IconButton from './IconButton'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import type { Backend } from '../lib/useBackend'

// Inviting people to a shared Space from the phone (ADR-0040): make an invite link and send it with
// Android's share sheet, see who is waiting to join and approve or deny them, and revoke a link
// nobody has used yet. The backend is lib/invites.mjs (`invites` in RPC_APPS); a link made here
// can be approved on any of the user's Devices that manage the Space, and the other way round.

export interface InviteSpace { rootDriveKey: string; name: string }
interface Join { memberId: string; name: string; role: string; requestedAt?: string }
interface InviteRow { id: string; role: string; state: 'open' | 'used' | 'expired' | 'revoked'; createdAt?: string; expiresAt?: string; usedBy?: string | null; signed: boolean }
interface ListResult { canInvite: boolean; joins: Join[]; invites: InviteRow[] }
interface LinkResult { id: string; link: string; role: string; expiresAt: string; signed: boolean; spaceName?: string }

const DAYS = [1, 7, 14, 30]
const dayLabel = (d: number) => (d === 1 ? '1 day' : `${d} days`)
const roleLabel = (r: string) => (r === 'editor' ? 'Can edit' : 'Can view')
const dateOf = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

function stateText (r: InviteRow) {
  if (r.state === 'used') return r.usedBy ? `Used by ${r.usedBy}` : 'Used'
  if (r.state === 'expired') return 'Ran out'
  if (r.state === 'revoked') return 'Revoked'
  return r.expiresAt ? `Works until ${dateOf(r.expiresAt)}` : 'Works for one person'
}

interface Props {
  space: InviteSpace | null
  onClose: () => void
  backend: Pick<Backend, 'apps' | 'onVaultChange'>
}

export default function InviteSheet ({ space: sp, onClose, backend }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [data, setData] = useState<ListResult | null>(null)
  const [role, setRole] = useState<'viewer' | 'editor'>('editor')
  const [days, setDays] = useState(14)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<LinkResult | null>(null)
  const key = sp?.rootDriveKey || null

  const load = useCallback(async () => {
    if (!key) return
    const res = await backend.apps<ListResult>('invites', 'list', { rootDriveKey: key })
    if (res.ok && res.value) setData(res.value)
    else if (!res.ok) setError(res.message || 'Couldn’t read this Space’s invites')
  }, [backend, key])

  useEffect(() => {
    setData(null)
    setMade(null)
    setError('')
    if (!key) return
    load()
    // Asks to join are held in memory by the backend, not in the Vault, so look again while open.
    const timer = setInterval(load, 4000)
    const stop = backend.onVaultChange(load)
    return () => { clearInterval(timer); stop() }
  }, [key, load, backend])

  const share = async (link: LinkResult) => {
    const name = link.spaceName || sp?.name || 'a Space'
    await Share.share({ message: `Join ${name} on Nomad: ${link.link}` }).catch(() => {})
  }

  const make = async () => {
    if (!key) return
    setBusy(true)
    setError('')
    const res = await backend.apps<LinkResult>('invites', 'link', { rootDriveKey: key, role, days })
    setBusy(false)
    if (!res.ok || !res.value) return setError(res.message || 'Couldn’t make an invite link')
    setMade(res.value)
    load()
    share(res.value)
  }

  const act = async (action: 'approve' | 'deny' | 'revoke', args: Record<string, unknown>) => {
    if (!key) return
    setError('')
    const res = await backend.apps('invites', action, { rootDriveKey: key, ...args })
    if (!res.ok) setError(res.message || 'That didn’t work')
    load()
  }

  const shown = (data?.invites || []).filter((r) => r.state === 'open' || r.state === 'used')

  return (
    <BottomSheet visible={!!sp} onClose={onClose} style={s.sheet}>
      <Text style={s.title} numberOfLines={1}>Invite people to {sp?.name}</Text>
      <ScrollView style={s.scroll} keyboardShouldPersistTaps='handled'>
        {!data ? (
          <ActivityIndicator color={t.accent} style={s.loading} />
        ) : !data.canInvite ? (
          <Text style={s.note}>Only an owner of this Space can invite people. Ask one of them for an invite link.</Text>
        ) : (
          <>
            {data.joins.length ? (
              <View style={s.group}>
                <Text style={s.label}>Waiting to join</Text>
                {data.joins.map((j) => (
                  <View key={j.memberId} style={s.row}>
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>{j.name || 'Someone'}</Text>
                      <Text style={s.rowSub}>{roleLabel(j.role)}</Text>
                    </View>
                    <TouchableOpacity style={s.btnGhost} onPress={() => act('deny', { memberId: j.memberId })} accessibilityRole='button'>
                      <Text style={s.btnGhostText}>Deny</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.btnSmall} onPress={() => act('approve', { memberId: j.memberId })} accessibilityRole='button'>
                      <Text style={s.btnText}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={s.group}>
              <Text style={s.label}>They can</Text>
              <View style={s.chips}>
                {(['editor', 'viewer'] as const).map((r) => (
                  <Pressable key={r} style={[s.chip, role === r && s.chipOn]} onPress={() => setRole(r)} accessibilityRole='button' accessibilityState={{ selected: role === r }}>
                    <Text style={[s.chipText, role === r && s.chipTextOn]}>{r === 'editor' ? 'Edit' : 'View'}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.label}>The link works for</Text>
              <View style={s.chips}>
                {DAYS.map((d) => (
                  <Pressable key={d} style={[s.chip, days === d && s.chipOn]} onPress={() => setDays(d)} accessibilityRole='button' accessibilityState={{ selected: days === d }}>
                    <Text style={[s.chipText, days === d && s.chipTextOn]}>{dayLabel(d)}</Text>
                  </Pressable>
                ))}
              </View>
              <TouchableOpacity style={[s.btn, busy && s.btnDisabled]} onPress={make} disabled={busy} accessibilityRole='button'>
                {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={s.btnText}>Make an invite link</Text>}
              </TouchableOpacity>
              <Text style={s.note}>
                Send it any way you like. It works once, for one person, and you approve them before they get in.
              </Text>
              {made ? (
                <Pressable style={s.made} onPress={() => share(made)} accessibilityRole='button' accessibilityLabel='Share the invite link again'>
                  <Icon name='share-alt' size={13} color={t.accent} />
                  <Text style={s.madeText} numberOfLines={1}>{made.signed ? 'Share the link again' : 'Share the link again (not signed: set up a Persona to sign invites)'}</Text>
                </Pressable>
              ) : null}
            </View>

            {shown.length ? (
              <View style={s.group}>
                <Text style={s.label}>Invite links</Text>
                {shown.map((r) => (
                  <View key={r.id} style={s.row}>
                    <View style={s.rowText}>
                      <Text style={s.rowTitle}>{roleLabel(r.role)}</Text>
                      <Text style={s.rowSub}>{stateText(r)}</Text>
                    </View>
                    {r.state === 'open'
                      ? <IconButton icon='times' label='Revoke this link' size={15} onPress={() => act('revoke', { id: r.id })} />
                      : null}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: { backgroundColor: t.surface, paddingHorizontal: space.lg, paddingBottom: space.lg, maxHeight: '85%' },
    title: { fontSize: 16, fontWeight: '600', color: t.text, marginBottom: space.sm },
    scroll: { flexGrow: 0 },
    loading: { marginVertical: space.xl },
    group: { marginTop: space.md, gap: space.sm },
    label: { color: t.textDim, fontSize: 13, fontWeight: '600', marginTop: space.xs },
    note: { color: t.textMuted, fontSize: 13 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, justifyContent: 'center' },
    chipOn: { borderColor: t.accent, backgroundColor: t.trustBg },
    chipText: { color: t.textDim, fontSize: 14 },
    chipTextOn: { color: t.accent, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    rowText: { flex: 1 },
    rowTitle: { color: t.text, fontSize: 15 },
    rowSub: { color: t.textMuted, fontSize: 13 },
    btn: { backgroundColor: t.accent, borderRadius: radius.pill, minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: space.sm },
    btnSmall: { backgroundColor: t.accent, borderRadius: radius.pill, minHeight: 36, justifyContent: 'center', paddingHorizontal: space.md },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' },
    btnGhost: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space.sm },
    btnGhostText: { color: t.textDim, fontSize: 15, fontWeight: '500' },
    made: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
    madeText: { color: t.accent, fontSize: 14, fontWeight: '600', flex: 1 },
    error: { color: t.danger, fontSize: 13, marginTop: space.md }
  })
}
