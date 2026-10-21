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
    <!-- SPIKE: live conversion status and CellML preview. -->
    <div class="celldl-live" :data-status="live.status.value">
      <span class="celldl-live-status">
        Live: {{ live.status.value }}<template v-if="live.lastMs.value !== null">
          ({{ live.lastKind.value }}, {{ Math.round(live.lastMs.value) }} ms after the edit)</template
        ><template v-if="live.issues.value.length">
          · {{ live.issues.value.length }} issue(s): {{ live.issues.value[0].message }}</template
        >
      </span>
      <button type="button" class="celldl-live-toggle" @click="showCellml = !showCellml">
        {{ showCellml ? 'Hide' : 'Show' }} CellML
      </button>
    </div>
    <pre v-if="showCellml" class="celldl-live-cellml">{{ live.cellml.value }}</pre>
  </div>
</template>

<script setup>
/**
 * The instance editor's CellDL tab: it shows the app's one CellDL editor (useCelldlEditorHost) while mounted,
 * with the source the dialog prepared. Selecting a diagram element emits the variable it plots.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

import { useCelldlEditorHost } from '../../composables/useCelldlEditorHost'
import { variableForElement } from '../../services/celldl/elements'
import { useLiveCelldlConvert } from '../../composables/useLiveCelldlConvert'

const props = defineProps({
  /** The instance's variable rows, which an element's variable must have to be plotted. */
  rows: { type: Array, default: () => [] },
})

const emit = defineEmits(['variable-click'])

const host = useCelldlEditorHost()
const slotRef = ref(null)
const live = useLiveCelldlConvert()
const showCellml = ref(false)
const isPending = computed(() => !host.isReady.value || host.isSyncing.value)

/**
 * Emits the variable of a selected element. An element added since the diagram was saved has no annotation, so
 * nothing to plot.
 *
 * @param {{type: string, component?: {id: string, annotation?: Object}}} event - The editor's viewer event.
 */
function onViewerEvent(event) {
  if (event?.type !== 'select') return
  const name = variableForElement(event.component?.annotation, props.rows)
  if (name) emit('variable-click', name)
}

onMounted(() => {
  if ((window.__liveConvertConfig?.mode ?? 'worker') === 'worker') live.startWorker().catch((e) => console.error(e))
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
  gap: 0.5rem;
  align-items: center;
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
  color: var(--p-text-muted-color);
}

.celldl-live[data-status='error'] .celldl-live-status {
  color: var(--p-red-500);
}

.celldl-live-status {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.celldl-live-toggle {
  text-decoration: underline;
}

.celldl-live-cellml {
  max-height: 30%;
  overflow: auto;
  font-size: 0.7rem;
  margin: 0;
  padding: 0.5rem;
  background: var(--p-content-hover-background);
}

.celldl-pane-error {
  margin-bottom: 0.5rem;
}
</style>
