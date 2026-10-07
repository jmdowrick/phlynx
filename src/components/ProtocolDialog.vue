<template>
  <Dialog
    :visible="modelValue"
    header="Protocol"
    modal
    :draggable="false"
    :dismissableMask="true"
    :style="{ width: '960px', maxHeight: '90vh' }"
    :appendTo="'body'"
    @update:visible="(visible) => !visible && requestClose()"
  >
    <p class="dialog-intro">Experiments to run, as CUFLynx and circulatory autogen describe them in obs_data.json.</p>
    <ProtocolEditor v-model:document="draft" :nodes="nodes" :get-global-constant="libraryStore.getGlobalConstant" />

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="requestClose" />
      <Button label="Save" severity="primary" :disabled="!hasChanges" @click="save" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * The workspace's experiment protocol, to write or edit. Everything is a draft until Save, which writes it as the
 * archive's obs_data.json; a close with unsaved changes asks first.
 */
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

import ProtocolEditor from './simulation/ProtocolEditor.vue'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useLibraryStore } from '../stores/libraryStore'
import { useProtocolStore } from '../stores/protocolStore'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  nodes: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])
const { confirm } = useConfirmDialog()
const libraryStore = useLibraryStore()
const protocolStore = useProtocolStore()

// The obs_data document being edited, or null while the workspace has none.
const draft = ref(null)
const initialSignature = ref('null')
const hasChanges = computed(() => JSON.stringify(draft.value) !== initialSignature.value)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    const document = protocolStore.source?.document
    draft.value = document == null ? null : JSON.parse(JSON.stringify(document))
    initialSignature.value = JSON.stringify(draft.value)
  }
)

/** Saves the protocol and closes. */
function save() {
  protocolStore.saveDocument(draft.value)
  initialSignature.value = JSON.stringify(draft.value)
  emit('update:modelValue', false)
}

/** Closes, asking first when there are unsaved changes. */
async function requestClose() {
  if (hasChanges.value) {
    const shouldDiscard = await confirm({
      header: 'Discard unsaved changes?',
      message: 'You have unsaved changes to the protocol. Close without saving?',
      severity: 'warning',
      acceptLabel: 'Discard',
      rejectLabel: 'Keep Editing',
    })
    if (!shouldDiscard) return
  }
  emit('update:modelValue', false)
}
</script>

<style scoped>
.dialog-intro {
  margin: 0 0 12px;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}
</style>
