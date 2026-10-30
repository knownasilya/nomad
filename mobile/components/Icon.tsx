import FontAwesome5 from '@expo/vector-icons/FontAwesome5'
import type { ComponentProps } from 'react'
import type { StyleProp, TextStyle } from 'react-native'
import { useTheme } from '../lib/theme'

export type IconName = ComponentProps<typeof FontAwesome5>['name']

interface Props {
  name: IconName
  size?: number
  color?: string
  // Font Awesome's outlined style (e.g. the empty star for "not bookmarked"). Solid otherwise.
  regular?: boolean
  style?: StyleProp<TextStyle>
}

// An icon from Font Awesome 5, the set desktop's shell uses (app/assets/css/fa-all.min.css), so a
// button looks the same on both: fa-star for bookmarks, fa-pen-nib for Draft preview, fa-robot for
// the AI. Use this instead of a text glyph (☰ ✕ ⌂): those come from whatever font the phone falls
// back to, so they change size and shape from phone to phone.
export default function Icon ({ name, size = 20, color, regular, style }: Props) {
  const t = useTheme()
  return <FontAwesome5 name={name} size={size} color={color ?? t.textDim} solid={!regular} style={style} />
}
