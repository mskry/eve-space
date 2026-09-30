import { computed, type Ref } from 'vue'
import type { MarketGroup, MarketType } from './market-catalogue-types'
import { marketGroupPath } from './market-breadcrumbs'

const blueprintMarketRootId = 2

export const marketTypeImageVariation = (type: MarketType, groups: readonly MarketGroup[]) => {
  const root = marketGroupPath(groups, type.groupId)[0]
  // Published blueprints can also live outside the Blueprints & Reactions market root.
  return root?.id === blueprintMarketRootId || type.name.endsWith('Blueprint')
    ? ('bp' as const)
    : ('icon' as const)
}

type TypeImage = ReturnType<typeof useEveImages>['typeImage']

export const marketTypeImageSources = (
  typeImage: TypeImage,
  item: MarketType,
  groups: readonly MarketGroup[],
) => {
  const variation = marketTypeImageVariation(item, groups)
  const source = typeImage(item.id, variation, 64)
  const highDensity = typeImage(item.id, variation, 128)
  return { source, sourceSet: `${source} 1x, ${highDensity} 2x` }
}

export const useMarketTypeImage = (
  type: Readonly<Ref<MarketType | null | undefined>>,
  groups: Readonly<Ref<readonly MarketGroup[]>>,
) => {
  const { typeImage } = useEveImages()
  return computed(() => {
    const item = type.value
    return item ? marketTypeImageSources(typeImage, item, groups.value) : null
  })
}
