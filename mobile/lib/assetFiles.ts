import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { File, Directory, Paths } from 'expo-file-system'
import * as as from './assetRules'

// Files for a Space's Assets (ADR-0044, shared/assets.mjs). A photo from the camera or the gallery
// is scaled to MAX_SIDE on its long side, as desktop's nomad://assets does, with a THUMB_SIDE
// thumbnail, both JPEG. A video from the gallery, and any file from the file picker, is kept as it
// is (a picture gets a thumbnail). Everything goes to the backend as base64, at most MAX_BYTES.

// What `assets`/`add` takes (backend/lib/assets.mjs add).
export interface AssetUpload {
  data: string
  name: string
  mime: string
  thumb?: string
  width?: number
  height?: number
  duration?: number
  takenAt?: string
}

// Picked, not read yet (prepare does that one at a time, so the screen can show progress).
export interface PickedFile {
  uri: string
  name: string
  mime: string
  size: number
  kind: string
  width?: number
  height?: number
  duration?: number // seconds
  takenAt?: string | null
  photo?: boolean // from the camera or the gallery: scaled
}

// Photos and videos from the gallery, or one photo from the camera. An empty array means the person
// cancelled.
export async function pickMedia (source: 'camera' | 'library'): Promise<PickedFile[]> {
  let result: ImagePicker.ImagePickerResult
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new Error('Camera access is off for Nomad. Turn it on in system settings.')
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: true })
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: as.MAX_BATCH, exif: true })
  }
  if (result.canceled) return []
  return result.assets.slice(0, as.MAX_BATCH).map((a) => {
    const video = a.type === 'video'
    const name = a.fileName || `${video ? 'Video' : 'Photo'} ${new Date().toISOString().slice(0, 10)}.${video ? 'mp4' : 'jpg'}`
    const mime = as.mimeOf(name, a.mimeType || (video ? 'video/mp4' : 'image/jpeg'))
    return {
      uri: a.uri,
      name,
      mime,
      size: a.fileSize || 0,
      kind: as.kindOf(mime, name),
      width: a.width,
      height: a.height,
      duration: a.duration ? a.duration / 1000 : undefined,
      takenAt: exifTime(a.exif),
      photo: !video
    }
  })
}

// Any files, from the system's file picker. An empty array means the person cancelled.
export async function pickFiles (): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
  if (result.canceled) return []
  return result.assets.slice(0, as.MAX_BATCH).map((a) => {
    const mime = as.mimeOf(a.name, a.mimeType || '')
    return { uri: a.uri, name: a.name, mime, size: a.size || 0, kind: as.kindOf(mime, a.name), takenAt: null }
  })
}

const tooBig = (p: PickedFile, bytes: number) =>
  new Error(`${p.name} is too big (${as.formatBytes(bytes)}, at most ${as.formatBytes(as.MAX_BYTES)})`)

// Read one picked file for the backend: a photo scaled, a picture's thumbnail made.
export async function prepare (p: PickedFile): Promise<AssetUpload> {
  const out: AssetUpload = { data: '', name: p.name, mime: p.mime }
  if (p.takenAt) out.takenAt = p.takenAt
  if (p.kind === 'image' && p.mime !== 'image/svg+xml') {
    const source = await ImageManipulator.manipulate(p.uri).renderAsync()
    const fit = (side: number) => (source.width >= source.height ? { width: Math.min(side, source.width) } : { height: Math.min(side, source.height) })
    out.width = source.width
    out.height = source.height
    if (p.photo) {
      const big = await ImageManipulator.manipulate(source).resize(fit(as.MAX_SIDE)).renderAsync()
      const saved = await big.saveAsync({ format: SaveFormat.JPEG, compress: as.QUALITY, base64: true })
      if (!saved.base64) throw new Error('Could not read the photo')
      out.data = saved.base64
      out.width = saved.width
      out.height = saved.height
      out.mime = 'image/jpeg'
      out.name = out.name.replace(/\.(heic|heif|png|webp)$/i, '.jpg')
      if (!out.takenAt) out.takenAt = new Date().toISOString()
    }
    const small = await ImageManipulator.manipulate(source).resize(fit(as.THUMB_SIDE)).renderAsync()
    const thumb = await small.saveAsync({ format: SaveFormat.JPEG, compress: as.THUMB_QUALITY, base64: true })
    if (thumb.base64) out.thumb = thumb.base64
  } else if (p.kind === 'video') {
    if (p.width && p.height) Object.assign(out, { width: p.width, height: p.height })
    if (p.duration) out.duration = p.duration
  }
  if (!out.data) {
    const file = new File(p.uri)
    const size = p.size || file.size || 0
    if (size > as.MAX_BYTES) throw tooBig(p, size)
    out.data = await file.base64()
  }
  const bytes = Math.floor((out.data.length * 3) / 4)
  if (bytes > as.MAX_BYTES) throw tooBig(p, bytes)
  return out
}

// A file of the Asset (base64) in this phone's cache, for a player or another app to open. The
// cache is the app's own, so nothing else sees it until the user shares it.
export function cacheFile (id: string, name: string, base64: string): string {
  const dir = new Directory(Paths.cache, 'assets', id)
  if (!dir.exists) dir.create({ intermediates: true })
  const file = new File(dir, as.cleanName(name).replace(/[^\w.\- ]+/g, '_'))
  if (!file.exists) {
    file.create()
    file.write(base64, { encoding: 'base64' })
  }
  return file.uri
}

function exifTime (exif: Record<string, unknown> | null | undefined): string | null {
  const raw = exif && (exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime)
  return as.exifTime(String(raw || ''))
}
