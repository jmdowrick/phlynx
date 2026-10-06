<template>
  <AutoComplete
    v-model="query"
    :suggestions="suggestions"
    option-label="path"
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    :virtual-scroller-options="{ itemSize: 46 }"
    scroll-height="18rem"
    complete-on-focus
    :delay="120"
    size="small"
    fluid
    class="variable-path-picker"
    @complete="(event) => search(event.query)"
    @option-select="(event) => pick(event.value)"
  >
    <template #option="{ option }">
      <div class="path-option" :class="{ 'path-option--elsewhere': !option.inScope }">
        <span class="path-text">
          <span class="path-component">{{ option.component }}/</span><span class="path-name">{{ option.name }}</span>
        </span>
        <span class="path-meta">
          <span v-if="option.units" class="path-units">{{ option.units }}</span>
          <span class="path-kind">{{ KIND_LABELS[option.kind] ?? option.kind }}</span>
        </span>
        <!-- Always two lines, as the virtual scroller needs rows of one height. -->
        <span class="path-note">{{ describe(option) ?? (option.inScope ? '\u00a0' : 'Not in the last run') }}</span>
      </div>
    </template>
    <template #empty>No variable matches.</template>
  </AutoComplete>
</template>

<script setup>
/**
 * One search box over every variable in the model, as `instance/variable` paths: every word typed must
 * appear in the path, in any order. Picking one emits it and clears the box for the next.
 */
import { nextTick, ref } from 'vue'

import AutoComplete from 'primevue/autocomplete'

import { searchVariableIndex } from '../../services/simulation/variableIndex'

const KIND_LABELS = { variable: 'variable', constant: 'parameter', global_constant: 'global', boundary_condition: 'boundary' }

const props = defineProps({
  // See buildVariableIndex.
  index: { type: Array, required: true },
  // Keeps an entry, such as only those that can be plotted.
  filter: { type: Function, default: () => true },
  // A note under an entry, such as the plot it is on, or null.
  describe: { type: Function, default: () => null },
  placeholder: { type: String, default: 'Search variables…' },
  ariaLabel: { type: String, default: 'Search variables' },
})
const emit = defineEmits(['pick'])

const query = ref('')
const suggestions = ref([])

/**
 * Lists the entries matching a query.
 *
 * @param {string} text
 */
function search(text) {
  suggestions.value = searchVariableIndex(props.index, text, { filter: props.filter })
}

/**
 * Emits a picked entry and clears the box.
 *
 * @param {Object} entry
 */
async function pick(entry) {
  emit('pick', entry)
  await nextTick()
  query.value = ''
}
</script>

<style scoped>
.path-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 8px;
  min-width: 0;
  font-size: 0.8125rem;
}

.path-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-component {
  color: var(--p-text-muted-color);
}

.path-name {
  font-weight: 600;
}

.path-meta {
  display: flex;
  gap: 6px;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

.path-kind {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--p-content-hover-background);
}

.path-note {
  grid-column: 1 / -1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

.path-option--elsewhere .path-name {
  font-weight: 400;
}
</style>
