import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { useTheme, radius, space, touch, type Theme } from '../lib/theme'
import type { AiPromptText } from '../lib/aiPrompts'
import type { AiPromptAnswer } from '../lib/useBackend'

export interface AiPrompt extends AiPromptText {
  // The label of the box that makes the yes last longer, as desktop's prompt shows it (the
  // Provider sends it): "Allow api.example.com for 3 months…", or "Don't ask again on …" for a
  // permission desktop keeps for the site. None: the yes is for this answer only.
  similar?: string | null
}

interface Props {
  prompt: AiPrompt | null
  onAnswer: (answer: AiPromptAnswer) => void
}

// The phone's prompt for a relayed AI permission (ADR-0013 §6), drawn like desktop's: what the AI
// wants, the request it would send, the box that makes the yes last longer when the Provider offers
// one, then Deny and Allow. Allow with the box ticked answers 'similar', and the Provider keeps the
// yes where desktop keeps it (send-grants.js for a site the AI sends to, sitedata for the rest).
// Closing the sheet any other way (back, a tap outside, dragging it down) denies.
export default function AiPromptSheet ({ prompt, onAnswer }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const { height } = useWindowDimensions()
  const [keep, setKeep] = useState(false)
  // The sheet slides away after an answer, still showing the prompt it answered.
  const shown = useRef<AiPrompt | null>(null)
  if (prompt) shown.current = prompt
  const p = prompt || shown.current
  useEffect(() => { setKeep(false) }, [prompt])

  return (
    <BottomSheet visible={!!prompt} onClose={() => onAnswer(false)} style={s.sheet}>
      {p ? (
        <>
          <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerStyle={s.body}>
            <View style={s.head}>
              <View style={s.iconWrap}>
                <Icon name={p.icon} size={16} color={t.accent} />
              </View>
              <Text style={s.title} accessibilityRole='header'>{p.title}</Text>
            </View>
            <Text style={s.message}>{p.message}</Text>
            {p.request.length ? (
              <View style={s.request}>
                {p.request.map((line, i) => (
                  <View key={i} style={s.requestLine}>
                    {line.warn
                      ? (i === 0 || !p.request[i - 1].warn)
                          ? <Icon name='exclamation-triangle' size={12} color={t.warn} style={s.warnIcon} />
                          : <View style={s.warnIcon} />
                      : null}
                    <Text style={[s.requestText, i === 0 && s.requestFirst, line.warn && s.warnText]} selectable>{line.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
          {p.similar ? (
            <Pressable
              style={s.check}
              onPress={() => setKeep((k) => !k)}
              accessibilityRole='checkbox'
              accessibilityState={{ checked: keep }}
              android_ripple={{ color: t.ripple }}
            >
              <Icon name={keep ? 'check-square' : 'square'} regular={!keep} size={20} color={keep ? t.accent : t.textMuted} />
              <Text style={s.checkText}>{p.similar}</Text>
            </Pressable>
          ) : null}
          <View style={s.actions}>
            <Pressable style={[s.btn, s.btnGhost]} onPress={() => onAnswer(false)} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
              <Text style={s.btnGhostText}>Deny</Text>
            </Pressable>
            <Pressable style={[s.btn, s.btnPrimary]} onPress={() => onAnswer(keep && p.similar ? 'similar' : true)} android_ripple={{ color: t.ripple }} accessibilityRole='button'>
              <Text style={s.btnText}>Allow</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </BottomSheet>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    sheet: { backgroundColor: t.surface, paddingHorizontal: space.xl, paddingBottom: space.lg },
    body: { gap: space.md, paddingBottom: space.sm },
    head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    iconWrap: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: t.trustBg, alignItems: 'center', justifyContent: 'center' },
    title: { flex: 1, fontSize: 17, fontWeight: '600', color: t.text },
    message: { fontSize: 14, lineHeight: 20, color: t.textDim },
    request: { backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: radius.md, padding: space.md, gap: space.xs },
    requestLine: { flexDirection: 'row', alignItems: 'flex-start' },
    requestText: { flex: 1, fontSize: 13, lineHeight: 18, color: t.textDim, fontFamily: 'monospace' },
    requestFirst: { color: t.text },
    warnIcon: { width: 16, marginTop: 3 },
    warnText: { color: t.warn },
    check: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch, paddingVertical: space.sm, borderRadius: radius.md, marginTop: space.xs },
    checkText: { flex: 1, color: t.text, fontSize: 14, lineHeight: 19 },
    actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    btn: { flex: 1, minHeight: touch, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    btnGhost: { backgroundColor: t.surfaceAlt },
    btnGhostText: { color: t.text, fontSize: 15, fontWeight: '600' },
    btnPrimary: { backgroundColor: t.accent },
    btnText: { color: t.onAccent, fontSize: 15, fontWeight: '600' }
  })
}
