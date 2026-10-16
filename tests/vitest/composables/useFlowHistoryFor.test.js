// @vitest-environment happy-dom
import { defineComponent, h, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { provideFlowHistory, useFlowHistoryFor } from '../../../src/composables/useFlowHistoryFor.js'
import { createHistory, useFlowHistoryStore } from '../../../src/stores/historyStore.js'

/**
 * Mounts a parent that provides `provided` (when given) around a child; reports what each one resolves.
 *
 * @param {Object|null} provided
 * @returns {{ parent: Object, child: Object }}
 */
function resolveIn(provided) {
  const seen = {}
  const Child = defineComponent({
    setup() {
      seen.child = useFlowHistoryFor()
      return () => h('div')
    },
  })
  const Parent = defineComponent({
    setup() {
      if (provided) provideFlowHistory(provided)
      seen.parent = useFlowHistoryFor()
      return () => h(Child)
    },
  })
  mount(Parent)
  return seen
}

describe('useFlowHistoryFor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('falls back to the workspace store with no provider or outside setup', () => {
    expect(resolveIn(null).child).toBe(useFlowHistoryStore())
    expect(useFlowHistoryFor()).toBe(useFlowHistoryStore())
  })

  it('gives descendants the provided stack, but not the providing component itself', () => {
    const own = reactive(createHistory())
    const seen = resolveIn(own)

    expect(seen.child).toBe(own)
    expect(seen.parent).toBe(useFlowHistoryStore())
  })

  it('prefers a stack passed in directly', () => {
    const own = reactive(createHistory())
    expect(useFlowHistoryFor(own)).toBe(own)
  })
})
