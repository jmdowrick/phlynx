// @vitest-environment happy-dom
/**
 * The Circulatory Autogen exports' menu entries: the native one asks once for each super-module's identity before
 * asking where to save, and writes from the store's super-modules; the flat one asks nothing and writes the model.
 */
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }))
vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../../src/utils/save', () => ({ getFileHandle: vi.fn(async () => ({ success: true, handle: {}, cleanName: 'model' })) }))
vi.mock('../../../src/services/export/ca', async (original) => ({ ...(await original()), generateExportZip: vi.fn(async () => new Blob(['zip'])) }))

const { useImportExportSend } = await import('../../../src/composables/useImportExportSend.js')
const { generateExportZip } = await import('../../../src/services/export/ca')
const { exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

describe('the Circulatory Autogen exports of a workspace with a super-module', () => {
  let store
  let ask
  let save
  let onExportConfirm

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const child = module('p', 'p', { scope: 'sm_1', ports: [port('exit_ports', 'flow', ['v'])] })
    const sm = supermodule('sm_1', 'pump', { submoduleOrder: ['p'] })
    const exposure = exposures('sm_1', [exposed('xp_0', 'p', 'exit_ports', 'flow')])
    store = { nodes: [superInstance({ nodes: [sm, child], edges: exposure }, 'dndnode_0', 'pump', 'sm_1'), sm, child], edges: exposure }
    ask = vi.fn(async (request) => request.suggestion)
    save = vi.fn(async () => true)
    onExportConfirm = vi.fn()
  })

  const setup = () =>
    useImportExportSend({
      libcellml: { status: 'ready' },
      nodes: ref([]),
      edges: ref([]),
      importDialogVisible: ref(false),
      exportDialogVisible: ref(false),
      currentImportConfig: ref(null),
      onExportConfirm,
      hasModelChanged: ref(false),
      snapshotFlowState: vi.fn(),
      selectedNodeIds: ref([]),
      isHierarchical: ref(true),
      storeGraph: () => store,
      caIdentities: { ask, save },
    })
  const menuItem = (items, label) => items.value.find((item) => item.label === label)

  it('offers the native, flat and legacy CSV exports', () => {
    const labels = setup().exportMenuItems.value.map((item) => item.label)
    expect(labels).toEqual(expect.arrayContaining(['Circulatory Autogen', 'Circulatory Autogen (flat)', 'Circulatory Autogen (legacy CSV)']))
  })

  it('asks for the identity of a super-module without one, stores it, then writes from the store', async () => {
    const exports = setup()
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen').command()
    expect(ask.mock.calls.map(([request]) => [request.smId, request.name, request.reason, request.suggestion])).toEqual([
      ['sm_1', 'pump', 'new', { module_type: 'pump', module_subtype: 'phlynx_v1' }],
    ])
    // The prompt checks what is typed.
    const [, problemOf] = ask.mock.calls[0]
    expect(problemOf({ module_type: 'pump', module_subtype: 'phlynx_v1' })).toBeNull()
    expect(problemOf({ module_type: 'a pump', module_subtype: 'phlynx_v1' })).toBeTruthy()
    expect(save).toHaveBeenCalledWith(new Map([['sm_1', { module_type: 'pump', module_subtype: 'phlynx_v1' }]]))
    expect(onExportConfirm).toHaveBeenCalled()

    await exports.currentExportMode.value.action('model')
    expect(generateExportZip.mock.calls.at(-1)[5]).toEqual({ arrayFormat: 'json', hierarchy: store })
  })

  it('goes on to export when the identity is cancelled, storing none', async () => {
    ask.mockResolvedValue(null)
    await menuItem(setup().exportMenuItems, 'Circulatory Autogen').command()
    expect(save).not.toHaveBeenCalled()
    expect(onExportConfirm).toHaveBeenCalled()
  })

  it('asks nothing for the flat export, and writes the model', async () => {
    const exports = setup()
    await menuItem(exports.exportMenuItems, 'Circulatory Autogen (flat)').command()
    expect(ask).not.toHaveBeenCalled()
    await exports.currentExportMode.value.action('model')
    expect(generateExportZip.mock.calls.at(-1)[5]).toEqual({ arrayFormat: 'json', hierarchy: null })
  })
})
