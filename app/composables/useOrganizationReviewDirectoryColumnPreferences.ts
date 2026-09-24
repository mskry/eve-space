import {
  normalizeOrganizationReviewDirectoryFieldIds,
  normalizeOrganizationReviewDirectoryPreference,
  organizationReviewDirectoryDefaultFieldIds,
  organizationReviewDirectoryPreferenceVersion,
  type OrganizationReviewDirectoryFieldId,
  type OrganizationReviewDirectoryPreference,
} from '../utils/organization-review-directory-fields'
import { onMounted, readonly, ref } from 'vue'

export const ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY =
  'eve-space-organization-review-directory-column-preference'

export type OrganizationReviewDirectoryColumnMove = 'up' | 'down'

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type PreferenceStorageProvider = () => PreferenceStorage | undefined

export function useOrganizationReviewDirectoryColumnPreferences(
  getStorage: PreferenceStorageProvider = getBrowserPreferenceStorage,
) {
  const visibleFieldIds = ref<readonly OrganizationReviewDirectoryFieldId[]>(defaultFieldIds())
  let mounted = false

  onMounted(() => {
    mounted = true
    visibleFieldIds.value = readFieldIds(getStorage)
  })

  function showField(fieldId: OrganizationReviewDirectoryFieldId) {
    updateFieldIds([...visibleFieldIds.value, fieldId])
  }

  function hideField(fieldId: OrganizationReviewDirectoryFieldId) {
    updateFieldIds(visibleFieldIds.value.filter((candidate) => candidate !== fieldId))
  }

  function moveField(
    fieldId: OrganizationReviewDirectoryFieldId,
    direction: OrganizationReviewDirectoryColumnMove,
  ) {
    if (!mounted) {
      return
    }
    const currentIndex = visibleFieldIds.value.indexOf(fieldId)
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex <= 0 || currentIndex >= visibleFieldIds.value.length - 1) {
      return
    }
    if (nextIndex <= 0 || nextIndex >= visibleFieldIds.value.length - 1) {
      return
    }

    const reordered = [...visibleFieldIds.value]
    const displacedField = reordered[nextIndex]
    if (displacedField === undefined) {
      return
    }
    reordered[currentIndex] = displacedField
    reordered[nextIndex] = fieldId
    updateFieldIds(reordered)
  }

  function resetFields() {
    if (!mounted) {
      return
    }
    visibleFieldIds.value = defaultFieldIds()
    writeFieldIds(getStorage, visibleFieldIds.value)
  }

  function updateFieldIds(values: readonly unknown[]) {
    if (!mounted) {
      return
    }
    const normalized = [...normalizeOrganizationReviewDirectoryFieldIds(values)]
    if (sameFieldIds(visibleFieldIds.value, normalized)) {
      return
    }
    visibleFieldIds.value = normalized
    writeFieldIds(getStorage, normalized)
  }

  return {
    hideField,
    moveField,
    resetFields,
    showField,
    visibleFieldIds: readonly(visibleFieldIds),
  }
}

function readFieldIds(
  getStorage: PreferenceStorageProvider,
): readonly OrganizationReviewDirectoryFieldId[] {
  try {
    const storedPreference = getStorage()?.getItem(
      ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY,
    )
    if (storedPreference === undefined || storedPreference === null) {
      return defaultFieldIds()
    }
    return [...normalizeOrganizationReviewDirectoryPreference(JSON.parse(storedPreference))]
  } catch {
    return defaultFieldIds()
  }
}

function writeFieldIds(
  getStorage: PreferenceStorageProvider,
  fieldIds: readonly OrganizationReviewDirectoryFieldId[],
) {
  const preference = {
    fieldIds,
    version: organizationReviewDirectoryPreferenceVersion,
  } satisfies OrganizationReviewDirectoryPreference
  try {
    getStorage()?.setItem(
      ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY,
      JSON.stringify(preference),
    )
  } catch {
    return
  }
}

function defaultFieldIds(): readonly OrganizationReviewDirectoryFieldId[] {
  return [...organizationReviewDirectoryDefaultFieldIds]
}

function sameFieldIds(
  left: readonly OrganizationReviewDirectoryFieldId[],
  right: readonly OrganizationReviewDirectoryFieldId[],
) {
  return left.length === right.length && left.every((fieldId, index) => fieldId === right[index])
}

function getBrowserPreferenceStorage(): PreferenceStorage | undefined {
  return globalThis.localStorage
}
