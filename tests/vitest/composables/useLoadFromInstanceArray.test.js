import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addNodes: vi.fn(),
  clearWorkspace: vi.fn(),
  trackEvent: vi.fn(),
  prepareLayout: vi.fn(),
  buildWorkflowGraph: vi.fn(),
  notify: { error: vi.fn(), warning: vi.fn() },
  store: { availableModules: ['available'], getMathAnalysis: 'analysis', getMathDefaults: 'defaults' },
  history: { startBatch: vi.fn(), endBatch: vi.fn() },
}))

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes: { value: [] }, addNodes: mocks.addNodes }),
}))
vi.mock('../../../src/stores/libraryStore', () => ({ useLibraryStore: () => mocks.store }))
vi.mock('../../../src/stores/historyStore', () => ({ useFlowHistoryStore: () => mocks.history }))
vi.mock('../../../src/utils/notify', () => ({ notify: mocks.notify }))
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent: mocks.trackEvent }) }))
vi.mock('../../../src/composables/useClearWorkspace', () => ({
  useClearWorkspace: () => ({ clearWorkspace: mocks.clearWorkspace }),
}))
vi.mock('../../../src/composables/useWorkflowLayout', () => ({
  useWorkflowLayout: () => ({ prepareLayout: mocks.prepareLayout }),
}))
vi.mock('../../../src/services/import/buildWorkflow', () => ({ buildWorkflowGraph: mocks.buildWorkflowGraph }))

import { useLoadFromInstanceArray } from '../../../src/composables/useLoadFromInstanceArray.js'

describe('useLoadFromInstanceArray', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clearWorkspace.mockResolvedValue(undefined)
    mocks.prepareLayout.mockResolvedValue(undefined)
  })

  it('warns about the connections left out for want of a free port slot, and adds the rest', async () => {
    const pendingInstances = [{ id: 'a' }, { id: 'b' }]
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances, pendingEdges: [], conflicts: ['a → b: no slot.'] })

    await useLoadFromInstanceArray().loadFromInstanceArray({ instances: [] })

    expect(mocks.notify.warning).toHaveBeenCalledWith({ title: 'Connections Not Made', message: 'a → b: no slot.' })
    expect(mocks.addNodes).toHaveBeenCalledWith(pendingInstances)
  })

  it('warns about nothing when every connection is made', async () => {
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances: [], pendingEdges: [], conflicts: [] })

    await useLoadFromInstanceArray().loadFromInstanceArray({ instances: [] })

    expect(mocks.notify.warning).not.toHaveBeenCalled()
  })
})
