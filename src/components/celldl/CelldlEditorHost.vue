<template>
  <Teleport :to="host.target.value ?? parking">
    <div ref="rootRef" class="celldl-host">
      <CellDLEditor
        :editor-command="host.command.value"
        :theme="isDarkMode ? 'dark' : 'light'"
        @editor-data="host.onEditorData"
        @editor-state="host.onEditorState"
        @event="host.onViewerEvent"
      />
    </div>
  </Teleport>
</template>

<script setup>
/**
 * Mounts the CellDL editor once, beside the instance editor, and shows it in whichever pane claims it (see
 * useCelldlEditorHost). Between claims it waits off screen, at a fixed size, as the editor can't mount in an
 * empty box and is never recreated.
 */
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'

import { useCelldlEditorHost } from '../../composables/useCelldlEditorHost'
import { useColorScheme } from '../../composables/useColorScheme'

const host = useCelldlEditorHost()
const { isDarkMode } = useColorScheme()
const rootRef = ref(null)

// Made before the first render, so the editor can teleport there from the start.
const parking = document.createElement('div')
parking.className = 'celldl-parking'
parking.inert = true
parking.setAttribute('aria-hidden', 'true')
document.body.appendChild(parking)

// The editor's styles apply only while it shows, and while it first mounts, as that needs its layout: its
// stylesheet (tooltips, utilities, icons, and PrimeVue overrides scoped under its root), the token fixes it adds
// for its PrimeVue components, and the diagram's own stylesheet, whose `svg { font-size }` is global. Its PrimeVue
// components share PhLynx's, so their styles are PhLynx's own.
const style = document.createElement('style')
style.dataset.celldlEditor = ''
document.head.appendChild(style)
const isStyleOn = computed(() => !host.isReady.value || host.isActive.value)
const applyStyles = () => {
  const fixes = document.head.querySelectorAll('style[id^="lib-fix-"]')
  for (const element of [style, ...fixes, ...(rootRef.value?.querySelectorAll('style') ?? [])]) {
    if (element.sheet) element.sheet.disabled = !isStyleOn.value
  }
}
watch(isStyleOn, applyStyles, { flush: 'post' })
// Setting a style's text makes a new sheet, which starts enabled.
const styleLoaded = import('@celldl/editor/style.css?inline').then(({ default: css }) => {
  style.textContent = css
  applyStyles()
})

// The editor sizes itself as it mounts, so its stylesheet comes first.
const CellDLEditor = defineAsyncComponent(async () => {
  const [{ default: editor }] = await Promise.all([import('@celldl/editor'), styleLoaded])
  return editor
})

onMounted(() => {
  host.listen()
  host.attach(rootRef.value)
})

onUnmounted(() => {
  host.unlisten()
  parking.remove()
  style.remove()
})
</script>

<style>
/* Unscoped: the parking box is made outside the component. */
.celldl-parking {
  position: fixed;
  top: 0;
  left: -10000px;
  width: 960px;
  height: 640px;
  overflow: hidden;
  pointer-events: none;
}
</style>

<style scoped>
.celldl-host {
  width: 100%;
  height: 100%;
}
</style>
