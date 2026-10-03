<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTradingInventory } from '../useTradingInventory'
import { coverageLabel, inventoryMessage } from '../inventory-presentation'
import TradingInventoryClocks from '../components/TradingInventoryClocks.vue'

useHead({ title: 'Trading inventory · EVE Space' })
const inventory = useTradingInventory()
const { selection, filters, data, status, error, corporations, characters } = inventory
const allCharacters = ref(true)
const selectedCharacters = ref<number[]>([])
const typeId = ref('')
const groupId = ref('')
const categoryId = ref('')
const locationKey = ref('')
const filterError = ref('')
const holderKey = ref('')
const scopeChoice = computed({
  get: () =>
    selection.value.scope === 'personal' ? 'personal' : String(selection.value.corporationId),
  set: (value: string) => {
    if (value === 'personal')
      selection.value = allCharacters.value
        ? { scope: 'personal' }
        : { scope: 'personal', characterIds: [...selectedCharacters.value] }
    else selection.value = { scope: 'corporation', corporationId: Number(value) }
    holderKey.value = ''
  },
})
const busy = computed(() => status.value === 'loading' || status.value === 'checking')
const announcement = computed(() => {
  if (busy.value) return 'Verifying access and loading inventory.'
  if (status.value === 'unavailable')
    return 'Verification unavailable. Inventory is hidden until access can be verified.'
  if (status.value === 'denied' || status.value === 'error') return inventoryMessage(error.value)
  if (!data.value) return 'Sign in to view your inventory.'
  return `${data.value.status.expectedSubjects} selected characters; ${data.value.groups.rows.length} item groups on this page.`
})
const counts = computed(() => data.value?.status.coverageCounts)
const hasGaps = computed(() => data.value && !data.value.status.sourcesComplete)
const announcer = useAnnouncer()
watch(announcement, (message) => announcer.polite(message))
watch(
  [allCharacters, selectedCharacters],
  () => {
    if (selection.value.scope === 'personal')
      selection.value = allCharacters.value
        ? { scope: 'personal' }
        : {
            scope: 'personal',
            characterIds: [...selectedCharacters.value].toSorted((a, b) => a - b),
          }
  },
  { deep: true },
)
const applyFilters = () => {
  filterError.value = ''
  const ids = [typeId.value, groupId.value, categoryId.value]
  if (
    ids.some(
      (value) => value && (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))),
    )
  ) {
    filterError.value = 'Type, group and category IDs must be positive whole numbers.'
    return
  }
  filters.value = {
    typeId: typeId.value || undefined,
    groupId: groupId.value || undefined,
    categoryId: categoryId.value || undefined,
    locationKey: locationKey.value || undefined,
  }
  holderKey.value = ''
}
const showHolders = (key: string, label: string) => {
  holderKey.value = key
  inventory.showHolders(key, label)
}
const nextHolders = () => {
  const holders = data.value?.holders
  if (holders?.endCursor)
    inventory.showHolders(holderKey.value, data.value!.holderLabel!, holders.endCursor)
}
</script>

<template>
  <div class="trading-page">
    <header>
      <p class="trading-eyebrow">Observed possessions</p>
      <h1>Trading inventory</h1>
      <p>
        Read holdings across your characters, or admitted corporation members. Observations happen
        at different times. These totals do not commit stock or grant permission to move anyone’s
        items.
      </p>
    </header>
    <section aria-labelledby="trading-scope">
      <h2 id="trading-scope">Inventory scope</h2>
      <label for="trading-scope-choice">View</label>
      <select id="trading-scope-choice" v-model="scopeChoice">
        <option value="personal">My characters</option>
        <option v-for="corporation in corporations" :key="corporation" :value="String(corporation)">
          Corporation {{ corporation }}
        </option>
      </select>
      <fieldset v-if="selection.scope === 'personal'">
        <legend>Included characters</legend>
        <label><input v-model="allCharacters" type="checkbox" />All attached characters</label>
        <div v-if="!allCharacters" class="trading-characters">
          <label v-for="character in characters" :key="character.characterId">
            <input v-model="selectedCharacters" type="checkbox" :value="character.characterId" />{{
              character.name
            }}
          </label>
          <p>An empty selection includes no characters.</p>
        </div>
      </fieldset>
    </section>
    <form aria-labelledby="trading-filters" @submit.prevent="applyFilters">
      <h2 id="trading-filters">Filter item groups</h2>
      <div class="trading-filters">
        <label
          >Type ID<input v-model="typeId" inputmode="numeric" :aria-invalid="Boolean(filterError)"
        /></label>
        <label
          >Group ID<input
            v-model="groupId"
            inputmode="numeric"
            :aria-invalid="Boolean(filterError)"
        /></label>
        <label
          >Category ID<input
            v-model="categoryId"
            inputmode="numeric"
            :aria-invalid="Boolean(filterError)"
        /></label>
        <label
          >Physical location key<input
            v-model="locationKey"
            maxlength="100"
            placeholder="For example station:60003760"
        /></label>
      </div>
      <p>
        Filters change item rows. Coverage always describes the complete selected character scope.
      </p>
      <p v-if="filterError" role="alert">{{ filterError }}</p>
      <button type="submit" :disabled="busy">Apply filters</button>
    </form>
    <output aria-label="Inventory status" aria-live="off" :aria-busy="busy">{{
      announcement
    }}</output>
    <button type="button" :disabled="busy" @click="inventory.refresh">
      {{
        status === 'denied' || status === 'error'
          ? 'Restart inventory'
          : 'Verify and refresh inventory'
      }}
    </button>

    <template v-if="data">
      <section aria-labelledby="trading-totals">
        <h2 id="trading-totals">Item groups</h2>
        <p v-if="hasGaps">
          Some holdings are unknown or excluded. The quantities below cover readable complete
          observations only.
        </p>
        <p v-if="data.groups.rows.length === 0">
          {{
            hasGaps
              ? 'No matching readable item groups. Missing holdings remain unknown.'
              : 'No matching item groups in the complete selected observations.'
          }}
        </p>
        <div v-else class="trading-table-scroll" tabindex="0" aria-label="Inventory item groups">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Physical location</th>
                <th scope="col">Current quantity</th>
                <th scope="col">Stale quantity</th>
                <th scope="col">Contributions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="group in data.groups.rows" :key="group.key">
                <th scope="row">
                  {{ group.typeName || `Unknown type ${group.typeId}`
                  }}<small
                    >Type {{ group.typeId }} · Group {{ group.groupId || 'unknown' }} · Category
                    {{ group.categoryId || 'unknown' }} · {{ group.blueprint }}</small
                  >
                </th>
                <td>
                  {{ group.location.name || group.location.key
                  }}<small>{{ group.location.state }} · {{ group.location.key }}</small>
                </td>
                <td>{{ group.currentQuantity }}</td>
                <td>{{ group.staleQuantity }}</td>
                <td>
                  <button
                    type="button"
                    @click="showHolders(group.key, group.typeName || group.typeId)"
                  >
                    Holders of {{ group.typeName || group.typeId }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button v-if="data.groups.hasNextPage" type="button" @click="inventory.nextGroups">
          Next item groups
        </button>
      </section>
      <section v-if="data.holders" aria-labelledby="trading-holders">
        <h2 id="trading-holders">Holders of {{ data.holderLabel }}</h2>
        <p>Permitted character contributions; these items are not reserved or committed.</p>
        <ul>
          <li v-for="holder in data.holders.rows" :key="holder.characterId">
            <h3>{{ holder.characterName }}</h3>
            <p>Current: {{ holder.currentQuantity }} · Stale: {{ holder.staleQuantity }}</p>
            <TradingInventoryClocks :source="holder.source" />
          </li>
        </ul>
        <button v-if="data.holders.hasNextPage" type="button" @click="nextHolders">
          Next holders
        </button>
      </section>
      <section aria-labelledby="trading-coverage">
        <h2 id="trading-coverage">Source coverage</h2>
        <p>
          Selected characters: {{ data.status.expectedSubjects }}. Current:
          {{ counts?.includedCurrent }}. Stale: {{ counts?.includedStale }}. Authorization required:
          {{ counts?.authorizationRequired }}. Never collected: {{ counts?.neverCollected }}.
          Unavailable: {{ counts?.unavailable }}. Incomplete: {{ counts?.incomplete }}. Beyond
          retention: {{ counts?.beyondRetention }}. Conflicting: {{ counts?.conflictingSource }}.
        </p>
        <p>
          {{
            data.status.traversalComplete
              ? 'Selected scope traversal is complete.'
              : 'Selected scope traversal is incomplete.'
          }}
          {{
            data.status.sourcesComplete
              ? 'All selected sources are complete.'
              : 'Some selected sources do not supply complete holdings.'
          }}
        </p>
        <ul>
          <li v-for="source in data.coverage.rows" :key="source.characterId">
            <h3>{{ source.characterName }}</h3>
            <p>{{ coverageLabel(source.state) }}</p>
            <p v-if="source.state === 'authorization-required' && selection.scope === 'personal'">
              Authorize assets for this character from your Characters page.
            </p>
            <TradingInventoryClocks v-if="source.source" :source="source.source" />
          </li>
        </ul>
        <button v-if="data.coverage.hasNextPage" type="button" @click="inventory.nextCoverage">
          Next coverage sources
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.trading-page {
  color: var(--ui-text);
  display: grid;
  gap: 1.5rem;
  max-width: 90rem;
  margin: 0 auto;
  padding: clamp(1rem, 3vw, 2rem);
}
header,
section,
form {
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  background: var(--ui-surface);
  padding: 1rem;
}
h1,
h2,
h3 {
  margin-top: 0;
}
.trading-eyebrow,
small {
  color: var(--ui-text-muted);
}
.trading-filters,
.trading-characters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.trading-filters label {
  display: grid;
  gap: 0.4rem;
  flex: 1 1 12rem;
}
input,
select,
button {
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 0.25rem;
  padding: 0.5rem;
  font: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: wait;
  opacity: 0.6;
}
input[type='checkbox'] {
  margin-right: 0.5rem;
}
fieldset {
  margin-top: 1rem;
  border: 1px solid var(--ui-border);
}
:is(input, select, button, .trading-table-scroll):focus-visible {
  outline: 2px solid var(--ui-focus-ring);
  outline-offset: 3px;
}
.trading-table-scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--ui-border);
}
small {
  display: block;
  margin-top: 0.35rem;
  font-weight: normal;
}
ul {
  padding: 0;
  list-style: none;
}
li {
  border-top: 1px solid var(--ui-border);
  padding: 1rem 0;
}
output {
  padding: 0.5rem 0;
}
</style>
