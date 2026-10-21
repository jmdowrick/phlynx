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
  </div>
</template>

<script setup>
/**
 * The instance editor's CellDL tab: it shows the app's one CellDL editor (useCelldlEditorHost) while mounted,
 * with the source the dialog prepared.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

import { useCelldlEditorHost } from '../../composables/useCelldlEditorHost'

// Clicks on the diagram's elements will plot their variables, from the editor's viewer events (claim's handler).
defineEmits(['variable-click'])

const host = useCelldlEditorHost()
const slotRef = ref(null)
const isPending = computed(() => !host.isReady.value || host.isSyncing.value)

onMounted(() => {
  host.claim(slotRef.value)
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

.celldl-pane-error {
  margin-bottom: 0.5rem;
}
</style>
