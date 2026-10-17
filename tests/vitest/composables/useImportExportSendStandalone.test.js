// @vitest-environment happy-dom
/**
 * The CellML export with imports asks for its instance folders' inputs before asking where to save, prefilled from the
 * last run, else the inputs' own values, else blank, and writes the values given; cancelling cancels the export.
 */
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }))
vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../../src/utils/save', () => ({ getFileHandle: vi.fn(async () => ({ success: true, handle: {}, cleanName: 'model' })) }))
vi.mock('../../../src/services/export/cellmlHierarchical', async (original) => ({
  ...(await original()),
  generateHierarchicalCellMLZip: vi.fn(async () => new Blob(['zip'])),
  standaloneInputs: vi.fn(async () => []),
}))

const { useImportExportSend } = await import('../../../src/composables/useImportExportSend.js')
const { generateHierarchicalCellMLZip, standaloneInputs } = await import('../../../src/services/export/cellmlHierarchical')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { notify } = await import('../../../src/utils/notify')

const input = (id, nodeId, variable, own) => ({ id, label: variable, units: 'dimensionless', nodeId, variable, own })
const FOLDERS = [
  {
    folder: 'modules/branch/instances/b/',
    name: 'b',
    kind: 'module',
    path: 'b',
    inputs: [input('ran', 'n1', 'u', '3'), input('own', 'n1', 'w', '0.5'), input('blank', 'n1', 'z', null)],
  },
]

describe('the CellML export with imports’ standalone inputs', () => {
  let ask
  let onExportConfirm
  const store = { nodes: [], edges: [] }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ask = vi.fn(async (folders, values) => values)
    onExportConfirm = vi.fn()
    standaloneInputs.mockResolvedValue(FOLDERS)
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
      storeGraph: () => store,
      standaloneInputs: { ask },
    })
  const exportWithImports = (exports) => exports.exportMenuItems.value.find((item) => item.label === 'CellML (with imports)').command()

  it('asks before the file picker, prefilled from the last run, else the own value, else blank, and writes the values given', async () => {
    const results = useSimulationResultsStore()
    results.results = { voi: { name: 'environment/t' }, variables: new Map([['b/u', { values: new Float64Array([7, 8]) }]]) }
    results.mapping = new Map([['n1::u', 'b/u']])
    ask.mockImplementation(async (folders, values) => new Map([...values, ['blank', '2']]))
    const exports = setup()
    await exportWithImports(exports)

    expect(standaloneInputs).toHaveBeenCalledWith(store.nodes, store.edges, expect.anything())
    const [folders, values] = ask.mock.calls[0]
    expect(folders).toBe(FOLDERS)
    expect(values).toEqual(new Map([['ran', '7'], ['own', '0.5'], ['blank', '']]))
    expect(onExportConfirm).toHaveBeenCalled()
    await exports.currentExportMode.value.action('model')
    expect(generateHierarchicalCellMLZip.mock.calls.at(-1)[4]).toEqual({ standaloneValues: new Map([['ran', '7'], ['own', '0.5'], ['blank', '2']]) })
  })

  it('cancels the export when the prompt is cancelled', async () => {
    ask.mockResolvedValue(null)
    await exportWithImports(setup())
    expect(onExportConfirm).not.toHaveBeenCalled()
  })

  it('asks nothing when no instance needs an input', async () => {
    standaloneInputs.mockResolvedValue([])
    const exports = setup()
    await exportWithImports(exports)
    expect(ask).not.toHaveBeenCalled()
    expect(onExportConfirm).toHaveBeenCalled()
  })

  it('reports a model it can’t export before asking where to save', async () => {
    standaloneInputs.mockRejectedValue(new Error('Missing parameter values: b.k.'))
    await exportWithImports(setup())
    expect(notify.error).toHaveBeenCalledWith({ title: 'Export failed', message: 'Missing parameter values: b.k.' })
    expect(onExportConfirm).not.toHaveBeenCalled()
  })
})
