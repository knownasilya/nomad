import { useEffect, useState } from 'react'
import { Image, Text, View } from 'react-native'
import { isHyperUrl, siteKeyOf } from '../lib/hyperUrl'

interface Props {
  url: string
  title?: string
  uri?: string // a favicon remembered for this site (useFavicons)
  size: number
}

// Muted tile colors for sites with no icon; a site keeps its color (picked from its key).
const TILE_COLORS = ['#5b6ee1', '#2f9e6e', '#c0623b', '#8a5cc7', '#2b8fb3', '#b0457c', '#6d7a2f', '#c28a1e']

// A site's icon: the remembered favicon; for a web site not seen yet, its own /favicon.ico (a
// request only to that site); otherwise a letter tile.
export default function SiteIcon ({ url, title, uri, size }: Props) {
  const fallback = !uri && !isHyperUrl(url) ? webFavicon(url) : undefined
  const src = uri || fallback
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])

  if (src && !failed) {
    return (
      <Image
        source={{ uri: src }}
        style={{ width: size, height: size, borderRadius: size * 0.2 }}
        onError={() => setFailed(true)}
      />
    )
  }
  const key = siteKeyOf(url) || url
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size * 0.25,
      backgroundColor: TILE_COLORS[Math.abs(hash) % TILE_COLORS.length],
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <Text style={{ color: '#fff', fontSize: size * 0.5, fontWeight: '700' }}>{letterFor(url, title)}</Text>
    </View>
  )
}

function webFavicon (url: string): string | undefined {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url)
  return m ? `${m[1]}/favicon.ico` : undefined
}

function letterFor (url: string, title?: string): string {
  const name = title && !/^[a-z]+:\/\//i.test(title) && title !== 'Loading…' ? title : siteKeyOf(url).replace(/^hyper:|^www\./, '')
  const ch = (name.match(/[A-Za-z0-9À-￿]/) || ['?'])[0]
  return ch.toUpperCase()
}
