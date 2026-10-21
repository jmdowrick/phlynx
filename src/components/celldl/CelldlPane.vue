<template>
  <div class="celldl-pane">
    <div v-if="!host.isReady.value" class="celldl-pane-pending">
      <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
      <span>Starting the diagram editor...</span>
    </div>
    <Message v-if="host.error.value" class="celldl-pane-error" severity="error" size="small" :closable="false">
      {{ host.error.value }}
    </Message>
    <div ref="slotRef" class="celldl-pane-slot"></div>
  </div>
</template>

<script setup>
/**
 * The instance editor's CellDL tab: it shows the app's one CellDL editor (useCelldlEditorHost) while mounted,
 * with the source the dialog prepared.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

import { useCelldlEditorHost } from '../../composables/useCelldlEditorHost'

// Clicks on the diagram's elements will plot their variables, from the editor's viewer events (claim's handler).
defineEmits(['variable-click'])

const host = useCelldlEditorHost()
const slotRef = ref(null)

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
