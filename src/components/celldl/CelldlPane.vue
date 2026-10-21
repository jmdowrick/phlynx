<template>
  <div class="celldl-pane">
    <div v-if="isPending" class="celldl-pane-pending">
      <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
      <span>{{ host.isReady.value ? 'Opening the diagram...' : 'Starting the diagram editor...' }}</span>
    </div>
    <Message v-if="host.error.value" class="celldl-pane-error" severity="error" size="small" :closable="false">
      {{ host.error.value }}
    </Message>
    <!-- Hidden while opening, or after failing to, as the editor still shows the last module's diagram. -->
    <div ref="slotRef" class="celldl-pane-slot" :class="{ 'is-hidden': isPending || host.error.value }"></div>
    <div v-if="live.isAvailable" class="celldl-live" :data-state="liveState">
      <button
        type="button"
        class="celldl-live-toggle"
        :aria-expanded="isPreviewOpen"
        aria-controls="celldl-live-preview"
        @click="isPreviewOpen = !isPreviewOpen"
      >
        <i class="pi" :class="isPreviewOpen ? 'pi-chevron-down' : 'pi-chevron-right'" aria-hidden="true"></i>
        Live CellML
      </button>
      <span class="celldl-live-status" role="status" :title="liveTitle">{{ liveStatus }}</span>
    </div>
    <div v-if="live.isAvailable && isPreviewOpen" id="celldl-live-preview" class="celldl-live-preview">
      <ul v-if="live.issues.value.length" class="celldl-live-issues">
        <li v-for="(line, index) in issueLines(live.issues.value)" :key="index">{{ line }}</li>
      </ul>
      <pre v-if="live.result.value?.cellml" class="celldl-live-cellml">{{ live.result.value.cellml }}</pre>
      <p v-else class="celldl-live-empty">{{ live.isPending.value ? 'Converting…' : 'No CellML yet.' }}</p>
    </div>
  </div>
</template>

<script>
import { ref as moduleRef } from 'vue'

const previewOpen = moduleRef(false)
</script>

<script setup>
/**
 * The instance editor's CellDL tab: it shows the app's one CellDL editor (useCelldlEditorHost) while mounted,
 * with the source the dialog prepared. Selecting a diagram element emits the variable it plots. Below the diagram,
 * the live conversion (useLiveCelldlConvert) says whether it converts, and can show its CellML.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

import { useCelldlEditorHost } from '../../composables/useCelldlEditorHost'
import { useLiveCelldlConvert } from '../../composables/useLiveCelldlConvert'
import { variableForElement } from '../../services/celldl/elements'
import { issueLines } from '../../services/celldl/issues'

const props = defineProps({
  /** The instance's variable rows, which an element's variable must have to be plotted. */
  rows: { type: Array, default: () => [] },
  /** The module's component name and units file, which the live conversion generates its CellML as. */
  componentName: { type: String, default: undefined },
  unitsFile: { type: String, default: null },
})

const emit = defineEmits(['variable-click'])

const host = useCelldlEditorHost()
const live = useLiveCelldlConvert()
const slotRef = ref(null)
const isPending = computed(() => !host.isReady.value || host.isSyncing.value)

// Kept across dialogs, as a preference.
const isPreviewOpen = previewOpen

/** The live conversion's state: off, converting, ok, warnings or errors. */
const liveState = computed(() => {
  if (live.error.value) return 'off'
  const result = live.result.value
  if (live.isPending.value || !result) return 'converting'
  if (result.errors.length) return 'errors'
  return result.warnings.length ? 'warnings' : 'ok'
})

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

const liveStatus = computed(() => {
  const result = live.result.value
  switch (liveState.value) {
    case 'off':
      return 'Live conversion is unavailable'
    case 'converting':
      return 'Converting…'
    case 'errors':
      return `${plural(live.issues.value.length, 'issue')}, checked again on save`
    case 'warnings':
      return `Converts, with ${plural(result.warnings.length, 'warning')}`
    default:
      return live.latest.value.pass === 'full' && result.runnable ? 'Converts and runs' : 'Converts'
  }
})

const liveTitle = computed(() => {
  if (live.error.value) return live.error.value
  if (live.isChecking.value && !live.isPending.value) return 'Checking with libCellML…'
  return live.latest.value?.pass === 'full' ? 'Checked with libCellML' : ''
})

watch(
  () => [props.componentName, props.unitsFile],
  ([componentName, unitsFile]) => live.setModule({ componentName, unitsFile }),
  { immediate: true }
)

/**
 * Emits the variable of a selected element: one the instance has, or else, for an element added since the diagram
 * was saved, its own, which saving makes plottable.
 *
 * @param {{type: string, component?: {id: string, annotation?: Object}}} event - The editor's viewer event.
 */
function onViewerEvent(event) {
  if (event?.type !== 'select') return
  const annotation = event.component?.annotation
  const name = variableForElement(annotation, props.rows)
  if (name) return emit('variable-click', name)
  const unsaved = annotation?.primary ?? annotation?.variables?.[0]
  if (unsaved) emit('variable-click', typeof unsaved === 'string' ? unsaved : unsaved.name, { isUnsaved: true })
}

onMounted(() => {
  live.start().catch(() => {})
  host.claim(slotRef.value, onViewerEvent)
  host.sync().catch((error) => {
    host.error.value = error.message
  })
})

onBeforeUnmount(() => host.release(slotRef.value))
</script>

<style scoped>
.celldl-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.celldl-pane-slot {
  flex: 1;
  min-height: 0;
}

.celldl-pane-slot.is-hidden {
  visibility: hidden;
}

.celldl-pane-pending {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--p-text-muted-color);
}

.celldl-live {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.celldl-live-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.celldl-live-toggle .pi {
  font-size: 0.7rem;
}

.celldl-live-status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.celldl-live[data-state='errors'] .celldl-live-status,
.celldl-live[data-state='warnings'] .celldl-live-status {
  color: var(--p-orange-500);
}

.celldl-live-preview {
  flex: 0 0 auto;
  max-height: 35%;
  overflow: auto;
  border-top: 1px solid var(--p-content-border-color);
  background: var(--p-content-hover-background);
  font-size: 0.75rem;
}

.celldl-live-issues {
  margin: 0;
  padding: 0.5rem;
  list-style: none;
  color: var(--p-orange-600);
}

.celldl-live-cellml {
  margin: 0;
  padding: 0.5rem;
  white-space: pre;
}

.celldl-live-empty {
  margin: 0;
  padding: 0.5rem;
  color: var(--p-text-muted-color);
}

.celldl-pane-error {
  margin-bottom: 0.5rem;
}
</style>
