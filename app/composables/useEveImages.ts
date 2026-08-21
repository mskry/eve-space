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
  const baseUrl = String(runtimeConfig.public.eveImageBase).replace(/\/+$/, '')

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
    // EVE serves empire/faction emblems under the corporations category, keyed by faction ID.
    // Passing the faction's corporation_id instead yields its navy crest, not the empire emblem.
    factionLogo: (id: EveImageId, size: EveImageSize = 128) =>
      imageUrl({ category: 'corporations', id, variation: 'logo' }, size),
    typeImage: (
      id: EveImageId,
      variation: Extract<EveImageRequest, { category: 'types' }>['variation'],
      size: EveImageSize = 128,
    ) => imageUrl({ category: 'types', id, variation }, size),
  }
}

function normalizeImageId(value: EveImageId) {
  const id = String(value)
  if (!/^[1-9]\d*$/.test(id)) throw new TypeError(`Invalid EVE image ID: ${id}`)
  return id
}
