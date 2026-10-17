<template>
  <Dialog
    :visible="!!question"
    modal
    header="Inputs to Run Instances on Their Own"
    :style="{ width: '560px' }"
    @update:visible="(visible) => !visible && prompt.answer(null)"
    @mousedown.stop
    @wheel.stop
  >
    <form v-if="question" class="standalone-form" @submit.prevent="handleConfirm">
      <p class="standalone-message">
        Each instance and super instance is also exported on its own, in an instance folder. These inputs take their values
        from connections in the model, so give each one a value to run it alone. They start as at the last run, else as
        their own values. A folder with an input left blank is still written, and README.txt lists it as not runnable.
        The values are not saved.
      </p>
      <div class="standalone-folders">
        <fieldset v-for="folder in question.folders" :key="folder.folder" class="standalone-folder">
          <legend>
            <span class="standalone-name">{{ folder.path }}</span>
            <small class="standalone-kind">{{ folder.kind === 'super' ? 'super instance' : 'instance' }}</small>
          </legend>
          <div v-for="input in folder.inputs" :key="input.id" class="standalone-row">
            <label :for="fieldId(input)">{{ input.label }}</label>
            <InputText
              :id="fieldId(input)"
              v-model="values[input.id]"
              size="small"
              :invalid="isInvalid(values[input.id])"
              placeholder="not runnable"
            />
            <small class="standalone-units">{{ input.units }}</small>
          </div>
        </fieldset>
      </div>
      <small :class="['standalone-hint', { 'standalone-hint--error': invalidCount }]">
        {{ invalidCount ? 'Each value must be a number, or blank.' : `${blankCount} of ${inputCount} left blank.` }}
      </small>
    </form>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" text @click="prompt.answer(null)" />
        <Button label="Export" :disabled="!!invalidCount" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Asks for the values the instance folders of the CellML export with imports need to run on their own (see
 * useStandaloneInputsPrompt), each folder's inputs under its instance or super instance, prefilled; cancelling cancels
 * the export.
 */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'

import { useStandaloneInputsPrompt } from '../../composables/useStandaloneInputsPrompt'
import { isNumericLiteral } from '../../utils/variables'

const prompt = useStandaloneInputsPrompt()
const question = prompt.question

const values = ref({})
const inputs = computed(() => question.value?.folders.flatMap((folder) => folder.inputs) ?? [])
const isBlank = (value) => String(value ?? '').trim() === ''
// As CellML writes a number: no '+', hex or spaces, which Number() alone allows.
const isInvalid = (value) => !isBlank(value) && (!isNumericLiteral(value) || !Number.isFinite(Number(value)))
const inputCount = computed(() => inputs.value.length)
const blankCount = computed(() => inputs.value.filter((input) => isBlank(values.value[input.id])).length)
const invalidCount = computed(() => inputs.value.filter((input) => isInvalid(values.value[input.id])).length)
const fieldId = (input) => `standalone-${input.id.replace(/[^A-Za-z0-9_-]/g, '_')}`

// Each question starts from its prefilled values.
watch(question, (asked) => {
  values.value = Object.fromEntries(inputs.value.map((input) => [input.id, asked?.values?.get(input.id) ?? '']))
})

function handleConfirm() {
  if (invalidCount.value) return
  prompt.answer(new Map(inputs.value.map((input) => [input.id, String(values.value[input.id] ?? '').trim()])))
}
</script>

<style scoped>
.standalone-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.standalone-message {
  margin: 0 0 0.5rem;
  line-height: 1.5;
}

.standalone-folders {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 50vh;
  overflow-y: auto;
}

.standalone-folder {
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin: 0;
}

.standalone-name {
  font-weight: 600;
}

.standalone-kind,
.standalone-units,
.standalone-hint {
  color: var(--p-text-muted-color);
}

.standalone-kind {
  margin-left: 0.5rem;
}

.standalone-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 9rem 6rem;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.standalone-row label {
  overflow-wrap: anywhere;
}

.standalone-units {
  overflow-wrap: anywhere;
}

.standalone-hint--error {
  color: var(--p-red-500);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
