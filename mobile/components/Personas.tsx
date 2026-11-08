import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, ScrollView, ActivityIndicator, Alert, Share, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, type Theme } from '../lib/theme'
import type { Backend, GivenVouch, HeldVouch, InboxPersona, InboxSummary, PersonasList, PersonaSession, PersonaSummary, VouchesSummary } from '../lib/useBackend'
import { ListSection, ListRow, ListEmpty } from './List'
import ActionSheet, { type SheetAction } from './ActionSheet'
import LinkPhone from './LinkPhone'
import ScreenHeader from './ScreenHeader'
import SiteIcon from './SiteIcon'
import NewPersona from './NewPersona'
import IconButton from './IconButton'

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space: string | null // the active Space's Root Drive key
  spaceName: string
  onOpenDevices: () => void
  onOpenSite: (url: string) => void // opens a site in the current tab; back comes here again
}

// The phone's Personas (ADR-0031): who you are when a site asks you to log in. The user makes, edits
// and deletes them here as on a computer (NewPersona; every device writes every profile drive), picks
// this Space's Persona and the default, and sees and ends the logins sites hold, on every device at
// once. The records are in the Vault. Each Persona's sheet also has its Messages settings
// (ADR-0036): who can write to it, its message link, and a new inbox address. Vouches (ADR-0045)
// wait here too: accept or decline one, pick who sees it, and renew or withdraw the ones you gave.
export default function Personas ({ visible, onClose, apps, onVaultChange, space, spaceName, onOpenDevices, onOpenSite }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args) => appsRef.current(app, action, args)) as Backend['apps'], [])
  const [list, setList] = useState<PersonasList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<'space' | PersonaSummary | PersonaSession | { modeFor: PersonaSummary } | { held: HeldVouch } | { given: GivenVouch } | null>(null)
  const [inbox, setInbox] = useState<InboxPersona[]>([])
  const [vouches, setVouches] = useState<VouchesSummary | null>(null)
  const [making, setMaking] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError('')
    const res = await call<PersonasList>('personas', 'list', { space })
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load your Personas'); return }
    setList(res.value)
    // Messages settings per Persona; Personas still work without them.
    const ib = await call<InboxSummary>('messages', 'summary', {})
    setInbox(ib.ok && ib.value ? ib.value.personas : [])
    const vs = await call<VouchesSummary>('vouches', 'list', {})
    setVouches(vs.ok && vs.value ? vs.value : null)
  }, [call, space])

  useEffect(() => { if (visible) refresh() }, [visible, refresh])
  useEffect(() => (visible ? onVaultChange(() => { refresh() }) : undefined), [visible, onVaultChange, refresh])

  const act = async (action: string, args: Record<string, unknown>, failed: string) => {
    setBusy(true)
    const res = await call('personas', action, { space, ...args })
    setBusy(false)
    if (!res.ok) { Alert.alert(failed, res.message || 'Unknown error'); return false }
    await refresh()
    return true
  }

  const logOut = (x: PersonaSession) => {
    Alert.alert(`Log out of ${x.site}?`, 'You’re logged out on all your devices. The site can ask you to log in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => act('endSession', { path: x.path }, 'Couldn’t log out') }
    ])
  }

  const remove = (p: PersonaSummary) => {
    const sites = p.sessions ? ` It’s logged in on ${p.sessions} site${p.sessions === 1 ? '' : 's'}; they’re logged out.` : ''
    const msgs = inboxOf(p)?.enabled ? ' Its messages are deleted too.' : ''
    Alert.alert(`Delete “${p.label}”?`, `It goes from all your devices.${sites}${msgs} Its profile drive stays.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => act('remove', { id: p.id }, 'Couldn’t delete it') }
    ])
  }

  const inboxOf = (p: PersonaSummary) => inbox.find((m) => m.personaId === p.id) || null

  const messagesAct = async (action: string, args: Record<string, unknown>, failed: string) => {
    setBusy(true)
    const res = await call('messages', action, args)
    setBusy(false)
    if (!res.ok) { Alert.alert(failed, res.message || 'Unknown error'); return null }
    await refresh()
    return res
  }

  const shareLink = async (p: PersonaSummary) => {
    const res = await call<string | null>('messages', 'link', { personaId: p.id })
    if (!res.ok || !res.value) { Alert.alert('No message link yet', res.message || 'Choose who can message this Persona first.'); return }
    Share.share({ message: res.value }).catch(() => {})
  }

  const rotate = (p: PersonaSummary) => {
    Alert.alert('Change the inbox address?', 'Your contacts keep writing to you. Message links you gave out stop working in two weeks, and strangers can’t use an old one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change it', onPress: () => messagesAct('rotate', { personaId: p.id }, 'Couldn’t change it') }
    ])
  }

  const vouchAct = async (action: string, r: HeldVouch | GivenVouch, args: Record<string, unknown>, failed: string) => {
    setBusy(true)
    const res = await call('vouches', action, { personaId: r.personaId, id: r.id, ...args })
    setBusy(false)
    if (!res.ok) { Alert.alert(failed, res.message || 'Unknown error'); return false }
    await refresh()
    return true
  }

  const hostName = (r: HeldVouch) => r.host.title || shortKey(r.vouch.host)
  const guestName = (r: GivenVouch) => r.guest.title || shortKey(r.vouch.guest)

  const declineVouch = (r: HeldVouch) => {
    const name = hostName(r)
    const accepted = r.state === 'accepted'
    Alert.alert(accepted ? `Remove the vouch from ${name}?` : `Decline the vouch from ${name}?`, accepted ? `It comes off your profile and sites stop seeing it. ${name} isn’t told.` : `It’s deleted from all your devices. ${name} isn’t told.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: accepted ? 'Remove' : 'Decline', style: 'destructive', onPress: () => vouchAct('decline', r, {}, 'Couldn’t remove it') }
    ])
  }

  const showVouch = (r: HeldVouch, shown: HeldVouch['shown']) => {
    if (shown !== 'profile') { vouchAct('setShown', r, { shown }, 'Couldn’t change it'); return }
    Alert.alert('Show it on your profile?', 'Anyone with your profile drive’s address can see it and who gave it. Like anything published, copies may stay after you take it off.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Show it', onPress: () => vouchAct('setShown', r, { shown }, 'Couldn’t change it') }
    ])
  }

  const withdrawVouch = (r: GivenVouch) => {
    const name = guestName(r)
    Alert.alert(`Withdraw your vouch for ${name}?`, `It stops counting everywhere it’s shown. Nothing is sent to ${name}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => vouchAct('withdraw', r, {}, 'Couldn’t withdraw it') }
    ])
  }

  const byId = (id: string | null) => list?.personas.find((p) => p.id === id) || null
  const current = list ? byId(list.resolvedId) : null
  const def = list ? byId(list.defaultId) : null

  const sheetProps = (): { title: string; subtitle?: string; groups: SheetAction[][] } | null => {
    if (!list || !sheet) return null
    if (sheet === 'space') {
      return {
        title: `Persona for ${spaceName}`,
        subtitle: 'Sites in this space see you as this Persona.',
        groups: [[
          { label: `Use the default${def ? ` (${def.label})` : ''}`, icon: 'user', active: !list.spacePersonaId, onPress: () => act('setSpace', { id: null }, 'Couldn’t change it') },
          ...list.personas.map((p): SheetAction => ({ label: p.label, icon: 'id-badge', active: list.spacePersonaId === p.id, onPress: () => act('setSpace', { id: p.id }, 'Couldn’t change it') }))
        ]]
      }
    }
    if ('modeFor' in sheet) {
      const p = sheet.modeFor
      const m = inboxOf(p)
      const set = (mode: string) => messagesAct('setMode', { personaId: p.id, mode }, 'Couldn’t change it')
      return {
        title: `Who can message ${p.label}`,
        subtitle: 'People you write to can always answer.',
        groups: [[
          { label: 'Only people I write to', icon: 'user-lock', active: !m || m.mode === 'off', onPress: () => set('off') },
          { label: 'People I give a link to', icon: 'link', active: m?.mode === 'link', onPress: () => set('link') },
          { label: 'Anyone, as requests', icon: 'globe', active: m?.mode === 'anyone', onPress: () => set('anyone') }
        ]]
      }
    }
    if ('held' in sheet) {
      const r = sheet.held
      const name = hostName(r)
      if (r.state === 'new') {
        return {
          title: `${name} vouched for you`,
          subtitle: `${r.vouch.note ? `“${r.vouch.note}” · ` : ''}${shortKey(r.vouch.host)}. Accepting keeps it; only you see it until you choose where it shows.`,
          groups: [
            [{ label: 'Accept', icon: 'check', onPress: () => vouchAct('accept', r, {}, 'Couldn’t accept it') }],
            [{ label: 'Decline', icon: 'times', destructive: true, onPress: () => declineVouch(r) }]
          ]
        }
      }
      return {
        title: `${name} vouched for you`,
        subtitle: 'Who sees it',
        groups: [
          [
            { label: 'Only me', icon: 'lock', active: r.shown === 'me', onPress: () => showVouch(r, 'me') },
            { label: 'Sites I log into, when I pick it', icon: 'sign-in-alt', active: r.shown === 'sites', onPress: () => showVouch(r, 'sites') },
            { label: 'On my profile', icon: 'globe', active: r.shown === 'profile', onPress: () => showVouch(r, 'profile') }
          ],
          [{ label: 'Remove', icon: 'trash', destructive: true, onPress: () => declineVouch(r) }]
        ]
      }
    }
    if ('given' in sheet) {
      const r = sheet.given
      const done = !!r.withdrawnAt || r.expired
      return {
        title: `You vouched for ${guestName(r)}`,
        subtitle: `${r.vouch.note ? `“${r.vouch.note}” · ` : ''}${givenStatus(r)}`,
        groups: [[
          { label: 'Renew for a year', icon: 'redo-alt', hidden: !r.renewDue || done, onPress: () => vouchAct('renew', r, {}, 'Couldn’t renew it') },
          { label: 'Withdraw', icon: 'undo-alt', destructive: true, hidden: done, onPress: () => withdrawVouch(r) },
          { label: 'Remove from this list', icon: 'times', hidden: !done, onPress: () => vouchAct('forget', r, {}, 'Couldn’t remove it') }
        ]]
      }
    }
    if ('path' in sheet) {
      return {
        title: sheet.site,
        subtitle: `As “${sheet.personaLabel}” in ${sheet.spaceName}`,
        groups: [
          [{ label: 'Open site', icon: 'external-link-alt', onPress: () => { setSheet(null); onOpenSite(`${sheet.origin}/`) } }],
          [{ label: 'Log out', icon: 'sign-out-alt', destructive: true, disabled: busy || !list.writable, onPress: () => logOut(sheet) }]
        ]
      }
    }
    return {
      title: sheet.label,
      subtitle: sheet.email ? `${sheet.email} · ${sheet.profileUrl}` : sheet.profileUrl,
      groups: [
        [
          { label: 'Edit', icon: 'pen', onPress: () => { setSheet(null); setEditId(sheet.id) } },
          { label: sheet.isDefault ? 'Your default Persona' : 'Make default', icon: 'star', active: sheet.isDefault, disabled: sheet.isDefault, onPress: () => act('setDefault', { id: sheet.id }, 'Couldn’t change it') }
        ],
        messagesActions(sheet),
        [{ label: 'Delete', icon: 'trash', destructive: true, onPress: () => { setSheet(null); remove(sheet) } }]
      ]
    }
  }
  // The Messages group of a Persona's sheet; empty when it can't have an Inbox here.
  function messagesActions (p: PersonaSummary): SheetAction[] {
    const m = inboxOf(p)
    if (!m || !m.usable) return []
    return [
      { label: `Who can message: ${MODE_LABELS[m.enabled ? m.mode : 'off']}`, icon: 'comments', onPress: () => setTimeout(() => setSheet({ modeFor: p }), 250) },
      { label: 'Share message link', icon: 'share-alt', hidden: !m.enabled || m.mode === 'off', onPress: () => shareLink(p) },
      { label: 'Change inbox address', icon: 'sync-alt', hidden: !m.enabled, onPress: () => rotate(p) }
    ]
  }
  const sp = sheetProps()

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Personas'
          onBack={onClose}
          actions={list ? [
            { icon: 'plus', label: 'New Persona', onPress: () => setMaking(true), disabled: !list.writable },
            { icon: 'redo-alt', label: 'Refresh', onPress: refresh, busy }
          ] : undefined}
        />
        {noVault ? (
          <LinkPhone what='Personas' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !list ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : (
          <ScrollView contentContainerStyle={s.page}>
            {!list.writable && (
              <Text style={s.hint}>This phone can’t save changes to your Vault yet. Keep your other device online until it syncs.</Text>
            )}
            {list.personas.length === 0 ? (
              <ListSection footer='A Persona is who you are when a site asks you to log in: a name, a picture and a few words in a profile drive of your own.'>
                <ListEmpty text='No Personas yet.' />
                <ListRow title='Make a Persona' icon='plus' accent divider disabled={!list.writable} onPress={() => setMaking(true)} />
              </ListSection>
            ) : (
              <>
                <ListSection title='This space' footer='A site never learns anything about you until you say yes when it asks.'>
                  <ListRow
                    title={current ? current.label : 'None'}
                    subtitle={`In ${spaceName}${current && !list.spacePersonaId ? ', your default' : ''}`}
                    left={<Avatar p={current} s={s} />}
                    chevron
                    disabled={busy || !list.writable || !list.spaceKnown}
                    onPress={() => setSheet('space')}
                  />
                </ListSection>
                <ListSection title='Your Personas' footer='Change a Persona on any of your devices: its name, picture and words, and the label and email only you see.'>
                  {list.personas.map((p, i) => (
                    <ListRow
                      key={p.id}
                      title={p.label}
                      subtitle={`${p.isDefault ? 'Default · ' : ''}${p.sessions ? `Logged in on ${p.sessions} site${p.sessions === 1 ? '' : 's'}` : 'Not logged in anywhere'}`}
                      left={<Avatar p={p} s={s} />}
                      divider={i > 0}
                      disabled={!list.writable}
                      onPress={() => setSheet(p)}
                    />
                  ))}
                  <ListRow title='New Persona' icon='plus' accent divider disabled={!list.writable} onPress={() => setMaking(true)} />
                </ListSection>
              </>
            )}
            {vouches && (vouches.held.length > 0 || vouches.given.length > 0 || vouches.foreign.length > 0) && (
              <ListSection title='Vouches' footer='A vouch says someone has had this person over at home. It isn’t proof an account is a real person, and it’s never a score. Each lasts a year. Give one from a computer, in site info on their profile.'>
                {vouches.foreign.map((f, i) => (
                  <ListRow
                    key={`foreign-${f.hash}`}
                    title={`Someone added a vouch to “${f.label}”`}
                    subtitle='None of your devices wrote it, so someone else may be able to change that profile drive.'
                    subtitleLines={3}
                    icon='exclamation-triangle'
                    divider={i > 0}
                  />
                ))}
                {vouches.held.map((r, i) => (
                  <ListRow
                    key={`held-${r.personaId}-${r.id}`}
                    title={`${hostName(r)} vouched for you`}
                    subtitle={heldStatus(r)}
                    subtitleLines={3}
                    left={<Initial name={hostName(r)} s={s} />}
                    divider={i > 0 || vouches.foreign.length > 0}
                    disabled={busy || !list.writable}
                    onPress={() => setSheet({ held: r })}
                  />
                ))}
                {vouches.given.map((r, i) => (
                  <ListRow
                    key={`given-${r.personaId}-${r.id}`}
                    title={`You vouched for ${guestName(r)}`}
                    subtitle={`${r.vouch.note ? `“${r.vouch.note}” · ` : ''}${givenStatus(r)}`}
                    subtitleLines={2}
                    left={<Initial name={guestName(r)} s={s} />}
                    divider={i > 0 || vouches.held.length > 0 || vouches.foreign.length > 0}
                    disabled={busy || !list.writable}
                    onPress={() => setSheet({ given: r })}
                  />
                ))}
              </ListSection>
            )}
            <ListSection title='Sites you’re logged in to'>
              {list.sessions.length === 0 ? (
                <ListEmpty text='None yet. When a site asks you to log in and you say yes, it shows here.' />
              ) : list.sessions.map((x, i) => (
                <ListRow
                  key={x.path}
                  title={x.site}
                  subtitle={`As “${x.personaLabel}” in ${x.spaceName} · ${describePerms(x.perms)} · ${x.expired ? 'expired' : `since ${new Date(x.createdAt).toLocaleDateString()}`}`}
                  subtitleLines={2}
                  left={<View style={s.lead}><SiteIcon url={`${x.origin}/`} title={x.site} size={20} /></View>}
                  right={<IconButton icon='ellipsis-v' label={`More for ${x.site}`} size={16} onPress={() => setSheet(x)} />}
                  divider={i > 0}
                  accessibilityLabel={`Open ${x.site}`}
                  onPress={() => onOpenSite(`${x.origin}/`)}
                  onLongPress={() => setSheet(x)}
                />
              ))}
            </ListSection>
          </ScrollView>
        )}
        <NewPersona
          visible={making}
          onClose={() => setMaking(false)}
          apps={call}
          onMade={(made) => { setMaking(false); refresh(); Alert.alert('Persona made', `“${made}” is ready. Keep this phone online for a bit so your computer gets its profile drive.`) }}
        />
        <NewPersona
          visible={!!editId}
          editId={editId}
          onClose={() => setEditId(null)}
          apps={call}
          onMade={() => { setEditId(null); refresh() }}
        />
        <ActionSheet
          visible={!!sp}
          onClose={() => setSheet(null)}
          title={sp?.title}
          subtitle={sp?.subtitle}
          groups={sp?.groups || []}
        />
      </SafeAreaView>
    </Modal>
  )
}

const MODE_LABELS: Record<string, string> = { off: 'only people I write to', link: 'people with my link', anyone: 'anyone, as requests' }

function Avatar ({ p, s }: { p: PersonaSummary | null; s: Styles }) {
  return (
    <View style={s.avatar}>
      <Text style={s.avatarText}>{p ? p.label.slice(0, 1).toUpperCase() : '?'}</Text>
    </View>
  )
}

function Initial ({ name, s }: { name: string; s: Styles }) {
  return (
    <View style={s.avatar}>
      <Text style={s.avatarText}>{name.slice(0, 1).toUpperCase() || '?'}</Text>
    </View>
  )
}

function shortKey (url: string) {
  const m = /^hyper:\/\/([0-9a-f]{64})/i.exec(url || '')
  return m ? `hyper://${m[1].slice(0, 6)}…${m[1].slice(-4)}/` : url
}

const SHOWN_LABELS: Record<HeldVouch['shown'], string> = { me: 'Only you see it', sites: 'Sites you pick it for', profile: 'On your profile' }
const CHECK_LABELS: Record<string, string> = { withdrawn: 'No longer valid: they withdrew it', expired: 'Expired', unreachable: 'Couldn’t check just now', invalid: 'Not a valid vouch' }

function heldStatus (r: HeldVouch) {
  const parts = [r.state === 'new' ? 'New: tap to accept or decline' : SHOWN_LABELS[r.shown]]
  if (r.check && CHECK_LABELS[r.check]) parts.push(CHECK_LABELS[r.check])
  else parts.push(`until ${new Date(r.vouch.expiresAt).toLocaleDateString()}`)
  return `${r.vouch.note ? `“${r.vouch.note}” · ` : ''}${parts.join(' · ')}`
}

function givenStatus (r: GivenVouch) {
  if (r.withdrawnAt) return `Withdrawn ${new Date(r.withdrawnAt).toLocaleDateString()}`
  if (r.expired) return `Expired ${new Date(r.vouch.expiresAt).toLocaleDateString()}`
  return `${r.renewDue ? 'Renew it soon · ' : ''}until ${new Date(r.vouch.expiresAt).toLocaleDateString()}`
}

function describePerms (perms: string[]) {
  const names = perms.map((p) => p.split(':')[0])
  const sees = [names.includes('profile') && 'your profile', names.includes('email') && 'your email', names.includes('vouches') && 'who vouched for you'].filter(Boolean)
  if (!sees.length) return 'knows only a random ID'
  return `sees ${sees.join(' and ')}${names.includes('modifyDrive') ? ', and can change your profile' : ''}`
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    page: { padding: 16, paddingBottom: 32 },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
    errText: { color: t.danger, fontSize: 14, textAlign: 'center', marginTop: 30 },
    lead: { width: 28, alignItems: 'center' },
    avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: t.onAccent, fontSize: 13, fontWeight: '700' }
  })
}
