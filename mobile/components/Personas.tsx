import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, type Theme } from '../lib/theme'
import type { Backend, PersonasList, PersonaSession, PersonaSummary } from '../lib/useBackend'
import { ListSection, ListRow, ListEmpty } from './List'
import ActionSheet, { type SheetAction } from './ActionSheet'
import LinkPhone from './LinkPhone'
import ScreenHeader from './ScreenHeader'
import SiteIcon from './SiteIcon'
import NewPersona from './NewPersona'

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space: string | null // the active Space's Root Drive key
  spaceName: string
  onOpenDevices: () => void
}

// The phone's Personas (ADR-0031): who you are when a site asks you to log in. The user makes, edits
// and deletes them here as on a computer (NewPersona; every device writes every profile drive), picks
// this Space's Persona and the default, and sees and ends the logins sites hold, on every device at
// once. The records are in the Vault.
export default function Personas ({ visible, onClose, apps, onVaultChange, space, spaceName, onOpenDevices }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args) => appsRef.current(app, action, args)) as Backend['apps'], [])
  const [list, setList] = useState<PersonasList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<'space' | PersonaSummary | PersonaSession | null>(null)
  const [making, setMaking] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError('')
    const res = await call<PersonasList>('personas', 'list', { space })
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load your Personas'); return }
    setList(res.value)
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
    Alert.alert(`Delete “${p.label}”?`, `It goes from all your devices.${sites} Its profile drive stays.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => act('remove', { id: p.id }, 'Couldn’t delete it') }
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
    if ('path' in sheet) {
      return {
        title: sheet.site,
        subtitle: `As “${sheet.personaLabel}” in ${sheet.spaceName}`,
        groups: [[{ label: 'Log out', icon: 'sign-out-alt', destructive: true, onPress: () => logOut(sheet) }]]
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
        [{ label: 'Delete', icon: 'trash', destructive: true, onPress: () => { setSheet(null); remove(sheet) } }]
      ]
    }
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
                  divider={i > 0}
                  disabled={busy || !list.writable}
                  onPress={() => setSheet(x)}
                  onLongPress={() => logOut(x)}
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

function Avatar ({ p, s }: { p: PersonaSummary | null; s: Styles }) {
  return (
    <View style={s.avatar}>
      <Text style={s.avatarText}>{p ? p.label.slice(0, 1).toUpperCase() : '?'}</Text>
    </View>
  )
}

function describePerms (perms: string[]) {
  const names = perms.map((p) => p.split(':')[0])
  const sees = [names.includes('profile') && 'your profile', names.includes('email') && 'your email'].filter(Boolean)
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
