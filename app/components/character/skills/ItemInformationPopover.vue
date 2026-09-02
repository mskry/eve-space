<script setup lang="ts">
const props = defineProps<{
  name: string
  statusDescription: string
  typeId: number
}>()

const statusDescriptionId = `${useId()}-status`

function attributeLabel(attribute: string | null) {
  return attribute ? `${attribute[0]?.toUpperCase()}${attribute.slice(1)}` : 'Unavailable'
}

function attributeIcon(attribute: string | null) {
  return attribute ? `/images/eve-attributes/${attribute}.png` : null
}
</script>

<template>
  <EveItemInformationPopover details-label="Attributes" :type-id="typeId">
    <template #trigger>
      <button
        class="skill-row-trigger"
        type="button"
        :aria-label="`View item information for ${props.name}`"
        :aria-describedby="statusDescriptionId"
      >
        <slot />
        <span :id="statusDescriptionId" class="sr-only">{{ statusDescription }}</span>
      </button>
    </template>

    <template #details="{ item }">
      <dl v-if="item.detail?.kind === 'skill'" class="skill-item-information-details">
        <div>
          <img
            class="skill-item-information-icon"
            data-skill-detail-icon="training-multiplier"
            src="/images/22_32_16.png"
            alt=""
            width="16"
            height="16"
            aria-hidden="true"
          />
          <dt>Training multiplier</dt>
          <dd>{{ item.detail.rank === null ? 'Unavailable' : `${item.detail.rank}x` }}</dd>
        </div>
        <div>
          <img
            v-if="item.detail.primaryAttribute"
            class="skill-item-information-icon"
            :src="attributeIcon(item.detail.primaryAttribute)!"
            alt=""
            width="16"
            height="16"
            aria-hidden="true"
          />
          <span v-else class="skill-item-information-icon is-unavailable" aria-hidden="true"
            >?</span
          >
          <dt>Primary attribute</dt>
          <dd>{{ attributeLabel(item.detail.primaryAttribute) }}</dd>
        </div>
        <div>
          <img
            v-if="item.detail.secondaryAttribute"
            class="skill-item-information-icon"
            :src="attributeIcon(item.detail.secondaryAttribute)!"
            alt=""
            width="16"
            height="16"
            aria-hidden="true"
          />
          <span v-else class="skill-item-information-icon is-unavailable" aria-hidden="true"
            >?</span
          >
          <dt>Secondary attribute</dt>
          <dd>{{ attributeLabel(item.detail.secondaryAttribute) }}</dd>
        </div>
      </dl>
    </template>
  </EveItemInformationPopover>
</template>

<style scoped>
.skill-item-information-details {
  margin: 0;
  padding: 4px 12px 10px;
  display: grid;
}

.skill-item-information-details div {
  min-width: 0;
  min-height: 32px;
  padding: 7px 6px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.skill-item-information-icon {
  width: 16px;
  height: 16px;
  display: block;
  object-fit: contain;
}

.skill-item-information-icon.is-unavailable {
  display: grid;
  place-items: center;
  border: 1px solid var(--ui-border);
  color: var(--ui-text-faint);
  font: 500 9px/1 var(--ui-font-mono);
}

.skill-item-information-details dt {
  color: var(--ui-text-subtle);
  font: 500 8px/1.2 var(--ui-font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.skill-item-information-details dd {
  margin: 0;
  color: var(--ui-text);
  font: 500 11px/1.2 var(--ui-font-mono);
  text-align: right;
}
</style>
