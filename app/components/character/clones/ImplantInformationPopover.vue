<script setup lang="ts">
const props = defineProps<{
  name: string
  typeId: number
}>()

function attributeLabel(attribute: string) {
  return `${attribute[0]?.toUpperCase()}${attribute.slice(1)}`
}

function bonusValue(value: number) {
  return `${value > 0 ? '+' : ''}${value}`
}
</script>

<template>
  <EveItemInformationPopover details-label="Implant details" :type-id="typeId">
    <template #trigger>
      <button
        class="character-clones-implant-trigger"
        type="button"
        :aria-label="`View item information for ${props.name}`"
      >
        <slot>{{ props.name }}</slot>
      </button>
    </template>

    <template #details="{ item }">
      <dl v-if="item.detail?.kind === 'implant'" class="character-clones-implant-details">
        <div>
          <dt>Implant slot</dt>
          <dd>{{ item.detail.slot }}</dd>
        </div>
        <div v-for="bonus in item.detail.bonuses" :key="bonus.attribute">
          <dt>{{ attributeLabel(bonus.attribute) }}</dt>
          <dd>{{ bonusValue(bonus.value) }}</dd>
        </div>
      </dl>
      <p v-else class="character-clones-implant-details-unavailable">
        Implant details are unavailable for this item.
      </p>
    </template>
  </EveItemInformationPopover>
</template>

<style scoped>
.character-clones-implant-trigger {
  min-width: 0;
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: inherit;
  cursor: pointer;
}

.character-clones-implant-trigger:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.character-clones-implant-details {
  margin: 0;
  padding: 6px 12px 10px;
  display: grid;
}

.character-clones-implant-details div {
  min-width: 0;
  min-height: 32px;
  padding: 7px 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.character-clones-implant-details dt,
.character-clones-implant-details dd,
.character-clones-implant-details-unavailable {
  margin: 0;
  font: 500 11px/1.3 var(--ui-font-mono);
}

.character-clones-implant-details dt,
.character-clones-implant-details-unavailable {
  color: var(--ui-text-subtle);
}

.character-clones-implant-details dd {
  color: var(--ui-text);
}

.character-clones-implant-details-unavailable {
  padding: 14px 18px 18px;
}
</style>
