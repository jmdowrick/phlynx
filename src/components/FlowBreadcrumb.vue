<template>
  <div v-if="!isAtRoot" class="flow-level">
    <nav class="flow-breadcrumb" aria-label="Canvas level">
      <ol class="crumb-list">
        <li class="crumb-item">
          <button type="button" class="crumb crumb--link" @click="exitTo(0)">
            <i class="pi pi-home" aria-hidden="true" /> Model
          </button>
        </li>
        <li v-for="(entry, index) in path" :key="`${index}:${entry.instanceId ?? entry.smId}`" class="crumb-item">
          <i class="pi pi-angle-right crumb-separator" aria-hidden="true" />
          <component
            :is="index < path.length - 1 ? 'button' : 'span'"
            :type="index < path.length - 1 ? 'button' : undefined"
            :class="['crumb', index < path.length - 1 ? 'crumb--link' : 'crumb--current']"
            :aria-current="index === path.length - 1 ? 'location' : undefined"
            @click="index < path.length - 1 && exitTo(index + 1)"
          >
            <i v-if="entry.instanceId === null" class="pi pi-pencil crumb-icon" aria-hidden="true" />
            <!-- On one line, so the name and its detail read with a space between. -->
            <span class="crumb-name">{{ entry.name }}</span> <span v-if="detailOf(entry)" class="crumb-detail">({{ detailOf(entry) }})</span>
          </component>
        </li>
      </ol>
    </nav>
    <div v-if="sharedCount > 1" class="supermodule-banner" role="status">
      <i class="pi pi-clone" aria-hidden="true" />
      <span>
        Editing super-module '{{ current.supermoduleName }}' — changes apply to {{ sharedCount }} subsystems
      </span>
    </div>
  </div>
</template>

<script setup>
/**
 * Where the canvas is: Model, then each subsystem entered (or the super-module edited on its own), the last the one
 * shown. Earlier entries go back there, and Escape goes up one level. While the super-module shown has more than one
 * copy in the model, a banner says an edit changes them all.
 */
import { computed } from 'vue'

import { useActiveDocumentListeners } from '../composables/useActiveDocumentListeners'
import { useCanvasLevel } from '../composables/useCanvasLevel'
import { shouldIgnoreShortcut } from '../composables/useWorkspaceClipboard'

const props = defineProps({
  // While a dialog or another use of Escape is open, Escape leaves the level as it is.
  escapeDisabled: {
    type: Boolean,
    default: false,
  },
})

const { isAtRoot, path, exitTo, exitOne } = useCanvasLevel()

const current = computed(() => path.value.at(-1))
const sharedCount = computed(() => current.value?.occurrences ?? 0)

/**
 * Says what a crumb is a copy of: a subsystem's super-module, where its name differs, and how many subsystems that
 * has, when more than one; for the super-module edited on its own, that it is one.
 *
 * @param {Object} entry - A path entry of useCanvasLevel.
 * @returns {string} Empty when there is nothing to add.
 */
function detailOf(entry) {
  if (entry.instanceId === null) return 'super-module'
  const parts = []
  if (entry.supermoduleLabel !== entry.name) parts.push(entry.supermoduleLabel)
  if (entry.count > 1) parts.push(`×${entry.count}`)
  return parts.join(' ')
}

/** Goes up one level on Escape, unless it is meant for a field, a dialog or a menu. */
function onKeydown(event) {
  if (event.key !== 'Escape' || event.defaultPrevented || isAtRoot.value) return
  if (shouldIgnoreShortcut(event, props.escapeDisabled)) return
  if (event.target?.closest?.('[role="dialog"], [role="alertdialog"]')) return
  // An open menu, such as the canvas's context menu, takes Escape to close.
  if (document.querySelector('[role="menu"]')) return
  exitOne()
}

useActiveDocumentListeners({ keydown: onKeydown })
</script>

<style scoped>
/* The canvas runs under the library panel, whose width the workbench sets. */
.flow-level {
  position: absolute;
  top: 16px;
  left: calc(var(--library-panel-width, 0px) + 16px);
  transition: left 160ms ease;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-width: calc(100% - var(--library-panel-width, 0px) - 15.5rem - 48px);
}

.flow-breadcrumb {
  max-width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--p-content-background);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--p-text-color) 15%, transparent);
  font-size: 13px;
}

.crumb-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.crumb-item {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 2px 4px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--p-text-muted-color);
  font: inherit;
  white-space: nowrap;
}

.crumb--link {
  cursor: pointer;
}

.crumb--link:hover {
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
}

.crumb--link:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.crumb--current {
  color: var(--p-text-color);
  font-weight: 600;
}

.crumb-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb-detail {
  color: var(--p-text-muted-color);
  font-weight: 400;
}

.crumb-icon {
  font-size: 11px;
}

.crumb-separator {
  font-size: 10px;
  color: var(--p-text-muted-color);
}

.supermodule-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--p-orange-500) 45%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--p-orange-500) 12%, var(--p-content-background));
  color: var(--p-text-color);
  font-size: 12px;
}
</style>
