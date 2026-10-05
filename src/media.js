// One place that knows how to show / fetch a photo, whatever its vendor.
import { imageUrl, fallbackImageUrl } from './drive'
import { fetchOriginal } from './download'

/** Grid thumbnail. Local files use their object URL (the browser downsizes). */
export function thumbSrc(photo, size = 320) {
  return photo.vendor === 'local' ? photo.url : imageUrl(photo.fileId, size)
}

/** Full-screen display. */
export function displaySrc(photo) {
  return photo.vendor === 'local' ? photo.url : imageUrl(photo.fileId)
}

export function fallbackSrc(photo) {
  return photo.vendor === 'local' ? null : fallbackImageUrl(photo.fileId)
}

/** The ORIGINAL file bytes, for zipping. */
export async function originalBlob(photo, apiKey, { signal } = {}) {
  if (photo.vendor === 'local') {
    if (!photo.file) throw new Error('Local folder is not connected in this browser.')
    return photo.file
  }
  return fetchOriginal({ id: photo.fileId, name: photo.name }, apiKey, { signal })
}
