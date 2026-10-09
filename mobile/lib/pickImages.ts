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
