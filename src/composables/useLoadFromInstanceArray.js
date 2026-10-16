import { useVueFlow } from '@vue-flow/core'
import { useLibraryStore } from '../stores/libraryStore'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useGtm } from './useGtm'
import { useClearWorkspace } from '../composables/useClearWorkspace'
import { buildWorkflowGraph } from '../services/import/buildWorkflow'
import { importCaModuleArray } from '../services/import/caFold'
import { looksLikeSupermoduleInstance } from '../services/import/caModuleArray'
import { moduleRefOf } from '../services/import/caModuleConfig'
import { layoutSupermoduleScopes } from '../services/layouts/scopes'
import { warnDeprecatedJunctions } from '../services/caRules'
import { escapeHtml } from '../utils/importBatch'
import { notify } from '../utils/notify'
import { skippedParametersMessage } from '../utils/parameters'
import { useWorkflowLayout } from './useWorkflowLayout'

/**
 * @param {object} [options]
 * @param {object|import('vue').Ref<object>} [options.fitViewParams] fitView options applied after layout.
 */
export function useLoadFromInstanceArray({ fitViewParams } = {}) {
  const { nodes, addNodes, addEdges } = useVueFlow()
  const store = useLibraryStore()
  const { trackEvent } = useGtm()
  const { clearWorkspace } = useClearWorkspace()
  const { prepareLayout } = useWorkflowLayout({ fitViewParams })
  const history = useFlowHistoryFor()

  /** Whether a module array instantiates super-modules, which are imported as super instances. */
  const hasSupermodules = (rows) =>
    rows.some((row) => !!store.availableSupermodules?.has(moduleRefOf(row.module_type, row.module_subtype)) || looksLikeSupermoduleInstance(row))

  /**
   * Builds a module array with super-modules as super instances (see caFold.importCaModuleArray), its parameters applied:
   * the host file's, the super-modules' parameterisations the library holds, and the global constants they set.
   */
  const buildFolded = async (instanceArray) => {
    const folded = importCaModuleArray(
      instanceArray.instances,
      {
        supermodules: store.availableSupermodules,
        modules: store.availableModules,
        getMathAnalysis: store.getMathAnalysis,
        getMathDefaults: store.getMathDefaults,
        variants: store.caVariants,
      },
      { source: instanceArray.source, load: store.caParameterLoader(), hostRows: instanceArray.parameters ?? [], currentNodes: nodes.value }
    )
    for (const { name, value, units, data_reference } of folded.globals) store.assignGlobalConstant(name, value, units, data_reference)
    if (folded.warnings.length) {
      notify.warning({ title: 'Module Array Imported With Warnings', message: folded.warnings.map(escapeHtml).join('<br>') })
    }
    // As loading the parameters file warns for a flat module array.
    if (folded.skipped.length) {
      notify.warning({ title: 'Some Parameters Not Applied', message: escapeHtml(skippedParametersMessage(folded.skipped)) })
    }
    await layoutSupermoduleScopes(folded.nodes, folded.edges, { keep: folded.positioned })
    const rootIds = new Set(folded.nodes.filter((node) => !node.hidden).map((node) => node.id))
    const isRoot = (edge) => rootIds.has(edge.source) && rootIds.has(edge.target)
    return {
      pendingInstances: folded.nodes,
      pendingEdges: folded.edges.filter(isRoot),
      scopeEdges: folded.edges.filter((edge) => !isRoot(edge)),
      conflicts: folded.conflicts,
      ivcZeroedHearts: [],
      parametersApplied: true,
    }
  }

  /**
   * Replaces the workspace with a CA module array's modules and connections. Super-module instances become
   * super instances, with the module array's parameters applied (see buildFolded); a flat array is built as it always was.
   *
   * @param {{instances: Array, parameters?: Array, source?: string}} instanceArray - The module array rows, and the
   *   host parameters file's rows, which a module array with super-modules applies itself.
   * @param {Function|null} [progressCallback]
   * @returns {Promise<{ivcZeroedHearts: string[], parametersApplied: boolean}>} The hearts whose ivc flow CA's rule
   *   set to 0, which the module array's parameters file must not set (see withoutZeroedIvcRows); and whether the
   *   parameters were applied already.
   */
  const loadFromInstanceArray = async (instanceArray, progressCallback = null) => {
    try {
      await clearWorkspace({ recordHistory: false })

      if (progressCallback) {
        progressCallback(0, instanceArray.instances.length, 'Building graph...')
      }

      const result = hasSupermodules(instanceArray.instances) ? await buildFolded(instanceArray) : buildWorkflowGraph(
        instanceArray.instances,
        store.availableModules,
        store.getMathAnalysis,
        nodes.value,
        progressCallback,
        store.getMathDefaults,
        { caRules: true, variants: store.caVariants }
      )

      if (progressCallback) {
        progressCallback(
          instanceArray.instances.length,
          instanceArray.instances.length,
          'Graph built, calculating layout...'
        )
      }

      if (result.conflicts.length) {
        notify.warning({ title: 'Connections Not Made', message: result.conflicts.join(' ') })
      }
      warnDeprecatedJunctions(instanceArray.instances.map((instance) => instance.module_type ?? ''))

      // 1. Prepare the layout promise chain
      const layoutPromise = prepareLayout(result.pendingEdges, progressCallback)

      // 2. Add nodes as a single undoable batch so this import is not split into
      //    separate node and edge history entries.
      history.startBatch()
      try {
        addNodes(result.pendingInstances)
        // The edges inside super-modules join nodes not drawn, so the root's layout leaves them out.
        if (result.scopeEdges?.length) addEdges(result.scopeEdges)
      } finally {
        history.endBatch()
      }

      // 3. Await the layout completion
      await layoutPromise

      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_from_instance_array',
        label: `Modules: ${instanceArray.instances.length}`,
        file_type: 'instance_array',
      })
      return { ivcZeroedHearts: result.ivcZeroedHearts ?? [], parametersApplied: !!result.parametersApplied }
    } catch (error) {
      trackEvent('workflow_load_action', {
        category: 'Workflow',
        action: 'load_from_instance_array',
        label: `Error: ${error.message}`,
        file_type: 'instance_array',
      })
      notify.error({ message: `Failed to load workflow: ${error.message}` })
      throw error
    }
  }

  return { loadFromInstanceArray }
}
