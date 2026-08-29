export type EveImageSize = 32 | 64 | 128 | 256 | 512 | 1024
export type EveImageTenant = 'tranquility' | 'singularity'

type EveImageId = number | string
type EveImageRequest =
  | { category: 'alliances'; id: EveImageId; variation: 'logo' }
  | { category: 'characters'; id: EveImageId; variation: 'portrait' }
  | { category: 'corporations'; id: EveImageId; variation: 'logo' }
  | { category: 'types'; id: EveImageId; variation: 'bp' | 'bpc' | 'icon' | 'relic' | 'render' }

const imageSizes = new Set<EveImageSize>([32, 64, 128, 256, 512, 1024])

export function useEveImages() {
  const runtimeConfig = useRuntimeConfig()
  const baseUrl = trimTrailingSlashes(String(runtimeConfig.public.eveImageBase))

  function imageUrl(
    request: EveImageRequest,
    size: EveImageSize,
    tenant: EveImageTenant = 'tranquility',
  ) {
    if (!imageSizes.has(size)) throw new RangeError(`Unsupported EVE image size: ${size}`)

    const id = normalizeImageId(request.id)
    const query = new URLSearchParams({ size: String(size), tenant })
    return `${baseUrl}/${request.category}/${id}/${request.variation}?${query}`
  }

  return {
    allianceLogo: (id: EveImageId, size: EveImageSize = 128) =>
      imageUrl({ category: 'alliances', id, variation: 'logo' }, size),
    characterPortrait: (id: EveImageId, size: EveImageSize = 128) =>
      imageUrl({ category: 'characters', id, variation: 'portrait' }, size),
    corporationLogo: (id: EveImageId, size: EveImageSize = 128) =>
      imageUrl({ category: 'corporations', id, variation: 'logo' }, size),
    // EVE serves empire emblems under corporations; faction corporation IDs are navy crests.
    factionLogo: (id: EveImageId, size: EveImageSize = 128) =>
      imageUrl({ category: 'corporations', id, variation: 'logo' }, size),
    typeImage: (
      id: EveImageId,
      variation: Extract<EveImageRequest, { category: 'types' }>['variation'],
      size: EveImageSize = 128,
    ) => imageUrl({ category: 'types', id, variation }, size),
  }
}

function trimTrailingSlashes(value: string) {
  let end = value.length
  while (end > 0 && value.codePointAt(end - 1) === 47) end -= 1
  return value.slice(0, end)
}

function normalizeImageId(value: EveImageId) {
  const id = String(value)
  if (!isPositiveInteger(id)) throw new TypeError(`Invalid EVE image ID: ${id}`)
  return id
}

function isPositiveInteger(value: string) {
  if (value.length === 0 || value.codePointAt(0)! < 49 || value.codePointAt(0)! > 57) return false

  for (let index = 1; index < value.length; index += 1) {
    const code = value.codePointAt(index)!
    if (code < 48 || code > 57) return false
  }
  return true
}
