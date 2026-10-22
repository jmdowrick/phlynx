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
    <div v-if="isLiveShown" class="celldl-live" :data-state="liveState">
      <span class="celldl-live-status" role="status" :title="liveTitle">{{ liveStatus }}</span>
    </div>
  </div>
</template>

<script setup>
/**
 * The instance editor's CellDL tab: it shows the app's one CellDL editor (useCelldlEditorHost) while mounted,
 * with the source the dialog prepared. Selecting a diagram element emits the variable it plots. Below the diagram,
 * the live conversion (useLiveCelldlConvert) says whether it converts; the math editors show its CellML.
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

// Not for a diagram that failed to open, as the editor still shows the one before.
const isLiveShown = computed(() => live.isAvailable && !host.error.value)

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
      // Runs check the saved module, so until the diagram is saved only its conversion is known.
      if (host.isDirty.value) return 'Converts, not yet saved'
      return isRunnable.value ? 'Converts and runs' : 'Converts'
  }
})

/** Whether libCellML found the diagram's CellML runnable. */
const isRunnable = computed(() => live.latest.value?.pass === 'full' && !!live.result.value?.runnable)

const liveTitle = computed(() => {
  if (live.error.value) return live.error.value
  if (live.issues.value.length) return issueLines(live.issues.value).join('\n')
  if (live.isChecking.value && !live.isPending.value) return 'Checking with libCellML…'
  if (live.latest.value?.pass !== 'full') return ''
  if (host.isDirty.value && isRunnable.value) return 'Checked with libCellML: it runs once saved'
  return 'Checked with libCellML'
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

.celldl-live-status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.celldl-live[data-state='errors'] .celldl-live-status,
.celldl-live[data-state='warnings'] .celldl-live-status {
  color: var(--p-orange-500);
}

.celldl-pane-error {
  margin-bottom: 0.5rem;
}
</style>
