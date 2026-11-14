import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { File, Directory, Paths } from 'expo-file-system'
import * as as from './assetRules'

// Files for a Space's Assets (ADR-0044, shared/assets.mjs). A photo from the camera or the gallery
// is scaled to MAX_SIDE on its long side, as desktop's nomad://assets does, with a THUMB_SIDE
// thumbnail, both JPEG. A video from the gallery, and any file from the file picker, is kept as it
// is (a picture gets a thumbnail, a video one of a frame a moment in). A PDF's or a book's comes from
// the viewer page when it is first opened (Assets.tsx DocView). A file goes to the backend as its path in the app's cache, which
// the backend reads itself, a piece at a time: a movie never crosses as one message. At most
// MAX_BYTES.

// What `assets`/`add` takes (backend/lib/assets.mjs add).
export interface AssetUpload {
  path: string // a file: URI in the app's cache
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

// A picked file as a file: URI in the app's own cache, where the backend can read it. The pickers
// copy there already; anything else (a content:// URI) is copied first.
function inCache (uri: string, name: string): string {
  if (uri.startsWith(Paths.cache.uri)) return uri
  const dir = new Directory(Paths.cache, 'asset-uploads')
  if (!dir.exists) dir.create({ intermediates: true })
  const dest = new File(dir, `${Date.now().toString(36)}-${safeName(name)}`)
  new File(uri).copy(dest)
  return dest.uri
}

const safeName = (name: string) => as.cleanName(name).replace(/[^\w.\- ]+/g, '_')

// Get one picked file ready for the backend: a photo scaled, a picture's or a video's thumbnail made.
export async function prepare (p: PickedFile): Promise<AssetUpload> {
  const out: AssetUpload = { path: '', name: p.name, mime: p.mime }
  if (p.takenAt) out.takenAt = p.takenAt
  if (p.kind === 'image' && p.mime !== 'image/svg+xml') {
    const source = await ImageManipulator.manipulate(p.uri).renderAsync()
    const fit = (side: number) => (source.width >= source.height ? { width: Math.min(side, source.width) } : { height: Math.min(side, source.height) })
    out.width = source.width
    out.height = source.height
    if (p.photo) {
      const big = await ImageManipulator.manipulate(source).resize(fit(as.MAX_SIDE)).renderAsync()
      const saved = await big.saveAsync({ format: SaveFormat.JPEG, compress: as.QUALITY })
      out.path = saved.uri
      out.width = saved.width
      out.height = saved.height
      out.mime = 'image/jpeg'
      out.name = out.name.replace(/\.(heic|heif|png|webp)$/i, '.jpg')
      if (!out.takenAt) out.takenAt = new Date().toISOString()
    }
    const thumb = await smallJpeg(source)
    if (thumb) out.thumb = thumb
  } else if (p.kind === 'video') {
    if (p.width && p.height) Object.assign(out, { width: p.width, height: p.height })
    if (p.duration) out.duration = p.duration
    const thumb = await videoThumb(p.uri, p.duration).catch(() => '')
    if (thumb) out.thumb = thumb
  }
  if (!out.path) {
    const size = p.size || new File(p.uri).size || 0
    if (size > as.MAX_BYTES) throw tooBig(p, size)
    out.path = inCache(p.uri, p.name)
  }
  const bytes = new File(out.path).size || 0
  if (bytes > as.MAX_BYTES) throw tooBig(p, bytes)
  return out
}

// A picture as a THUMB_SIDE JPEG thumbnail, base64.
async function smallJpeg (source: string | ImageRef): Promise<string> {
  const pic = typeof source === 'string' ? await ImageManipulator.manipulate(source).renderAsync() : source
  const fit = pic.width >= pic.height ? { width: Math.min(as.THUMB_SIDE, pic.width) } : { height: Math.min(as.THUMB_SIDE, pic.height) }
  const small = await ImageManipulator.manipulate(pic).resize(fit).renderAsync()
  const saved = await small.saveAsync({ format: SaveFormat.JPEG, compress: as.THUMB_QUALITY, base64: true })
  return saved.base64 || ''
}

// A frame a moment into a video (a third of the way into a short one), as a thumbnail. `uri` is a
// file in the cache or the backend's loopback stream (assets/stream).
async function videoThumb (uri: string, duration?: number): Promise<string> {
  const time = Math.round(Math.min(1, (duration || 3) / 3) * 1000)
  const frame = await VideoThumbnails.getThumbnailAsync(uri, { time, quality: 1 })
  try {
    return await smallJpeg(frame.uri)
  } finally {
    try { new File(frame.uri).delete() } catch {}
  }
}

// A thumbnail for an Asset that has none (shared/assets.mjs needsThumb), from its file once the
// viewer has it: a picture's, or a video's frame. '' when it can't be made here (a PDF's and a
// book's come from the viewer page).
export async function thumbOf (kind: string, uri: string, mime = '', duration?: number): Promise<string> {
  if (kind === 'image' && mime !== 'image/svg+xml') return smallJpeg(uri)
  if (kind === 'video') return videoThumb(uri, duration)
  return ''
}

// Where an Asset's file goes in this phone's cache, for a viewer or another app to open (the
// backend writes it there, `assets`/`readTo`). The cache is the app's own, so nothing else sees it
// until the user shares it.
export function cachedFile (id: string, name: string): File {
  const dir = new Directory(Paths.cache, 'assets', id)
  if (!dir.exists) dir.create({ intermediates: true })
  return new File(dir, safeName(name))
}

function exifTime (exif: Record<string, unknown> | null | undefined): string | null {
  const raw = exif && (exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime)
  return as.exifTime(String(raw || ''))
}
