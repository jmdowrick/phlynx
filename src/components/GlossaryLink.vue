<template>
  <el-tooltip
    v-if="definition"
    :content="definition"
    placement="top"
    effect="dark"
  >
    <RouterLink
      :to="`/docs/reference/glossary#${canonicalTerm}`"
      class="glossary-link"
    >
      <slot>{{ label || term }}</slot>
    </RouterLink>
  </el-tooltip>

  <RouterLink
    v-else
    :to="`/docs/reference/glossary`"
    class="glossary-link missing"
  >
    <slot>{{ label || term }}</slot>
  </RouterLink>
</template>

<script setup>
import { computed } from 'vue'
import { resolveTerm, getDefinition } from '../router/glossaryIndex'

const props = defineProps({
  term: { type: String, required: true },
  label: { type: String, default: '' }
})

const canonicalTerm = computed(() => resolveTerm(props.term))
const definition = computed(() =>
  canonicalTerm.value ? getDefinition(canonicalTerm.value) : null
)

if (import.meta.env.DEV && !canonicalTerm.value) {
  console.warn(`Glossary term not found: "${props.term}"`)
}
</script>

<style scoped>
.glossary-link {
  border-bottom: 1px dotted #409eff;
}

.glossary-link.missing {
  border-bottom-color: #e6a23c;
}
</style>
