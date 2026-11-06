import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

// Photos for an AI turn travel inside every Bridge request (the Client ships the whole transcript
// each turn — ADR-0013 §5), so each one is scaled to at most MAX_SIDE px on its long side and
// re-encoded as JPEG. That keeps a photo at a few hundred KB. Models scale larger images down anyway.
const MAX_SIDE = 1568
const QUALITY = 0.7

// Returns the picked photos as data:image/jpeg URLs — the form nomad.ai.chat's `images` takes.
// An empty array means the person cancelled.
export async function pickImages (source: 'camera' | 'library', limit: number): Promise<string[]> {
  if (limit <= 0) return []
  let result: ImagePicker.ImagePickerResult
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new Error('Camera access is off for Nomad. Turn it on in system settings.')
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })
  } else {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: limit > 1,
      selectionLimit: limit
    })
  }
  if (result.canceled) return []
  const urls: string[] = []
  for (const asset of result.assets.slice(0, limit)) urls.push(await toJpegDataUrl(asset.uri))
  return urls
}

async function toJpegDataUrl (uri: string): Promise<string> {
  let image = await ImageManipulator.manipulate(uri).renderAsync()
  if (image.width > MAX_SIDE || image.height > MAX_SIDE) {
    const size = image.width >= image.height ? { width: MAX_SIDE } : { height: MAX_SIDE }
    image = await ImageManipulator.manipulate(image).resize(size).renderAsync()
  }
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true })
  if (!saved.base64) throw new Error('Could not read the photo')
  return 'data:image/jpeg;base64,' + saved.base64
}

// A Persona's picture (ADR-0031): one square photo, cropped by the picker and scaled to AVATAR px,
// as a data:image/jpeg URL. null means the person cancelled.
const AVATAR = 512
export async function pickAvatar (source: 'camera' | 'library'): Promise<string | null> {
  let result: ImagePicker.ImagePickerResult
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new Error('Camera access is off for Nomad. Turn it on in system settings.')
    result = await ImagePicker.launchCameraAsync(opts)
  } else {
    result = await ImagePicker.launchImageLibraryAsync(opts)
  }
  if (result.canceled || !result.assets[0]) return null
  let image = await ImageManipulator.manipulate(result.assets[0].uri).renderAsync()
  if (image.width > AVATAR || image.height > AVATAR) {
    image = await ImageManipulator.manipulate(image).resize({ width: AVATAR, height: AVATAR }).renderAsync()
  }
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true })
  if (!saved.base64) throw new Error('Could not read the photo')
  return 'data:image/jpeg;base64,' + saved.base64
}

// Photos for a shared Space's family album (ADR-0043, shared/photos.mjs): each scaled to ALBUM_SIDE
// on its long side and a THUMB_SIDE thumbnail, both JPEG as base64, with when it was taken (EXIF,
// else now). The same sizes desktop's nomad://photos makes, so every Device keeps the same files.
const ALBUM_SIDE = 2560
const ALBUM_QUALITY = 0.85
const THUMB_SIDE = 480
const THUMB_QUALITY = 0.75
export const ALBUM_BATCH = 30

export interface AlbumPhoto { photo: string; thumb: string; width: number; height: number; takenAt: string }

// The photos picked, not yet scaled (scaleAlbumPhoto does that one at a time, so the screen can
// show progress). An empty array means the person cancelled.
export interface PickedPhoto { uri: string; takenAt: string | null }
export async function pickAlbumPhotos (source: 'camera' | 'library'): Promise<PickedPhoto[]> {
  let result: ImagePicker.ImagePickerResult
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new Error('Camera access is off for Nomad. Turn it on in system settings.')
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: true })
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: ALBUM_BATCH, exif: true })
  }
  if (result.canceled) return []
  return result.assets.slice(0, ALBUM_BATCH).map((a) => ({ uri: a.uri, takenAt: exifTime(a.exif) }))
}

// Scale one picked photo (the `uri` pickAlbumPhotos gives back) for the album.
export async function scaleAlbumPhoto (picked: PickedPhoto): Promise<AlbumPhoto> {
  const source = await ImageManipulator.manipulate(picked.uri).renderAsync()
  const fit = (side: number) => (source.width >= source.height ? { width: Math.min(side, source.width) } : { height: Math.min(side, source.height) })
  const big = await ImageManipulator.manipulate(source).resize(fit(ALBUM_SIDE)).renderAsync()
  const saved = await big.saveAsync({ format: SaveFormat.JPEG, compress: ALBUM_QUALITY, base64: true })
  const small = await ImageManipulator.manipulate(source).resize(fit(THUMB_SIDE)).renderAsync()
  const thumb = await small.saveAsync({ format: SaveFormat.JPEG, compress: THUMB_QUALITY, base64: true })
  if (!saved.base64 || !thumb.base64) throw new Error('Could not read the photo')
  return { photo: saved.base64, thumb: thumb.base64, width: saved.width, height: saved.height, takenAt: picked.takenAt || new Date().toISOString() }
}

function exifTime (exif: Record<string, unknown> | null | undefined): string | null {
  const raw = exif && (exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime)
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(raw || ''))
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(d.getTime()) && +m[1] > 1990 ? d.toISOString() : null
}
