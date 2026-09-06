<script setup lang="ts">
import {
  AutocompleteAnchor,
  AutocompleteCancel,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompletePortal,
  AutocompleteRoot,
  AutocompleteTrigger,
  AutocompleteViewport,
} from 'reka-ui'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    inputId?: string
    label: string
    options: readonly string[]
    placeholder?: string
  }>(),
  {
    disabled: false,
    inputId: undefined,
    placeholder: 'Type to search',
  },
)

const modelValue = defineModel<string>({ required: true })
const visibleOptions = computed(() => {
  const query = modelValue.value.trim().toLocaleLowerCase('en')
  return props.options
    .filter((option) => query === '' || option.toLocaleLowerCase('en').includes(query))
    .toSorted((left, right) => {
      const leftStartsWith = left.toLocaleLowerCase('en').startsWith(query)
      const rightStartsWith = right.toLocaleLowerCase('en').startsWith(query)
      return Number(rightStartsWith) - Number(leftStartsWith) || left.localeCompare(right, 'en')
    })
    .slice(0, 20)
})
</script>

<template>
  <AutocompleteRoot
    v-model="modelValue"
    class="ui-autocomplete"
    :disabled="disabled"
    ignore-filter
    open-on-click
    open-on-focus
  >
    <AutocompleteAnchor class="ui-autocomplete-anchor">
      <AutocompleteInput
        :id="inputId"
        class="ui-autocomplete-input"
        type="search"
        :aria-label="label"
        :placeholder="placeholder"
      />
      <AutocompleteCancel
        v-if="modelValue"
        class="ui-autocomplete-action"
        type="button"
        :aria-label="`Clear ${label.toLocaleLowerCase('en')}`"
      >
        Clear
      </AutocompleteCancel>
      <AutocompleteTrigger
        class="ui-autocomplete-action"
        type="button"
        :aria-label="`Show ${label.toLocaleLowerCase('en')} suggestions`"
      >
        Suggestions
      </AutocompleteTrigger>
    </AutocompleteAnchor>

    <AutocompletePortal defer>
      <AutocompleteContent
        class="ui-autocomplete-content"
        position="popper"
        :collision-padding="8"
        :side-offset="4"
      >
        <AutocompleteViewport class="ui-autocomplete-viewport">
          <AutocompleteEmpty class="ui-autocomplete-empty">No suggestions</AutocompleteEmpty>
          <AutocompleteItem
            v-for="option in visibleOptions"
            :key="option"
            class="ui-autocomplete-item"
            :text-value="option"
            :value="option"
          >
            {{ option }}
          </AutocompleteItem>
        </AutocompleteViewport>
      </AutocompleteContent>
    </AutocompletePortal>
  </AutocompleteRoot>
</template>
