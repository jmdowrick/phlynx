import { computed, h, markRaw, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import {
  ZIP_FILE_TYPES,
  CELLML_FILE_TYPES,
  OMEX_FILE_TYPES,
  IMPORT_KEYS,
  EXPORT_KEYS,
  SEND_KEYS,
} from '../utils/constants'

import CellMLIcon from '../components/icons/CellMLIcon.vue'
import CUFLynxIcon from '../components/icons/CUFLynxIcon.vue'
import OpenCORIcon from '../components/icons/OpenCORIcon.vue'
import CombineIcon from '../components/icons/CombineIcon.vue'

import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useSessionMetadataStore } from '../stores/sessionMetadataStore'
import { useOmexStore } from '../stores/omexStore'
import { useProtocolStore } from '../stores/protocolStore'

import { createCellMLDataFragment, generateOmexArchive, createOmexDataFragment } from '../services/compress'
import { generateExportZip } from '../services/export/ca'
import { summariseExpansionErrors } from '../services/hierarchy/errors'
import { isNestedModelId } from '../services/hierarchy/expand'
import { resolvePlotConfig } from '../services/simulation/plotSelections'
import { buildScopedModel, checkScope, resolveScope, summariseScopeReport } from '../services/simulation/scopedModel'
import { useConfirmDialog } from './useConfirmDialog'
import { notify } from '../utils/notify'
import { generateFlattenedModel, extractVoiAndParametersFromModel } from '../utils/cellml'
import { readFileAsText } from '../utils/misc'
import { getFileHandle } from '../utils/save'
import { getImportConfig } from '../utils/import'

/**
 * Gives the workspace's import, export and send menus and actions. Exports build the model (see useModelGraph).
 *
 * @param {Object} options
 * @param {import('vue').Ref<Array>} options.nodes - The model's nodes.
 * @param {import('vue').Ref<Array>} options.edges - The model's edges.
 * @param {import('vue').Ref<string[]>} options.selectedNodeIds - The model nodes the canvas selection stands for.
 * @param {import('vue').Ref<Array>} [options.modelErrors] - The problems expanding subsystems found (useModelGraph's
 *   `errors`): errors stop an export, warnings are shown with it.
 * @param {import('vue').Ref<boolean>} [options.isHierarchical] - Whether the workspace has subsystems (useModelGraph's).
 * @returns {Object} The menus, the current modes and their triggers.
 */
export function useImportExportSend({
  libcellml,
  nodes: modelNodes,
  edges: modelEdges,
  importDialogVisible,
  exportDialogVisible,
  currentImportConfig,
  onExportConfirm,
  hasModelChanged,
  snapshotFlowState,
  selectedNodeIds,
  modelErrors = { value: [] },
  isHierarchical = { value: false },
}) {
  const simulationSettingsStore = useSimulationSettingsStore()
  const libraryStore = useLibraryStore()
  const inspectionModuleStore = useInspectionModuleStore()
  const sessionMetadataStore = useSessionMetadataStore()
  const omexStore = useOmexStore()
  const protocolStore = useProtocolStore()
  const { confirm } = useConfirmDialog()

  const currentImportKey = ref(IMPORT_KEYS.INSTANCE_ARRAY)
  const currentExportKey = ref(EXPORT_KEYS.CELLML)
  const currentSendKey = ref(SEND_KEYS.OPENCOR)

  const { simulationSettings, plotConfig, parameterScanConfig } = storeToRefs(simulationSettingsStore)

  const importOptions = computed(() => [
    {
      key: IMPORT_KEYS.INSTANCE_ARRAY,
      label: 'Instance Array',
      icon: 'pi pi-th-large',
      disabled: false,
    },
    {
      key: IMPORT_KEYS.CELLML_FILE,
      label: 'CellML File',
      icon: CellMLIcon,
      disabled: libcellml.status !== 'ready',
    },
    {
      key: IMPORT_KEYS.MODULE_CONFIG,
      label: 'Module Config',
      icon: 'pi pi-wrench',
      disabled: libcellml.status !== 'ready',
    },
    {
      key: IMPORT_KEYS.PARAMETER,
      label: 'Parameters',
      icon: 'pi pi-sliders-h',
      disabled: false,
    },
    {
      key: IMPORT_KEYS.OMEX,
      label: 'COMBINE Archive',
      icon: CombineIcon,
      disabled: libcellml.status !== 'ready',
    },
  ])

  const currentImportMode = computed(
    () => importOptions.value.find((option) => option.key === currentImportKey.value) ?? importOptions.value[0] ?? null
  )

  /** Resolves the selected nodes into a scope, to export on their own. */
  const resolveSelectionScope = () =>
    resolveScope(selectedNodeIds.value, modelNodes.value, modelEdges.value, inspectionModuleStore.modules, {
      modelErrors: modelErrors.value,
    })

  /**
   * Gets the whole model to export. Problems expanding its subsystems stop the export, and their warnings are shown
   * once, as it starts.
   *
   * @returns {{nodes: Array, edges: Array}}
   * @throws {Error} Listing the errors.
   */
  const buildWholeModel = () => {
    const { errors, warnings } = summariseExpansionErrors(modelErrors.value)
    if (errors.length) throw new Error(errors.join('\n'))
    if (warnings.length) notify.warning({ title: 'Model Warnings', message: warnings.join('\n') })
    return { nodes: modelNodes.value, edges: modelEdges.value }
  }

  /**
   * Names slider selections as the model exports their modules: a module inside a subsystem is renamed with any
   * subsystem it is in, which its stored name doesn't follow. A root module's selection, and any in a workspace without
   * subsystems, is kept as stored, as before.
   *
   * @param {Array<Object>} selections - parameterScanConfig.selections.
   * @returns {Array<Object>}
   */
  const withModelNames = (selections) => {
    if (!isHierarchical.value) return selections
    const nameById = new Map(modelNodes.value.map((node) => [node.id, node.data?.name]))
    return selections.map((selection) => {
      const name = isNestedModelId(selection.nodeId) && nameById.get(selection.nodeId)
      return name ? { ...selection, nodeName: name } : selection
    })
  }

  /**
   * Checks the selection before it is exported: errors stop the export, and warnings ask to go on.
   *
   * @returns {Promise<boolean>} Whether to export.
   */
  const confirmSelectionExport = async () => {
    const { errors, warnings } = summariseScopeReport(checkScope(resolveSelectionScope(), libraryStore))
    if (errors.length) {
      notify.error({ title: 'Selection can’t be exported', message: errors.join('\n') })
      return false
    }
    if (!warnings.length) return true
    return confirm({
      header: 'Export Selection',
      message: warnings.map((warning) => `• ${warning}`).join('\n'),
      severity: 'warning',
      acceptLabel: 'Export',
      rejectLabel: 'Cancel',
    })
  }

  /**
   * Builds the OMEX archive of the whole model, or of a scope on its own: its model, its instances'
   * plotted variables and parameter scans, and a snapshot of just its nodes.
   *
   * @param {string} finalName
   * @param {ReturnType<typeof resolveScope>|null} [scope]
   * @returns {Promise<Blob>}
   */
  const generateOmexArchiveAction = async (finalName, scope = null) => {
    const model = scope ? null : buildWholeModel()
    const blob = scope
      ? await buildScopedModel(scope, libraryStore)
      : await generateFlattenedModel(model.nodes, model.edges, libraryStore, inspectionModuleStore.modules)
    const inScope = (selection) => !scope || scope.nodeIds.includes(selection.nodeId)
    const selections = withModelNames((parameterScanConfig.value?.selections ?? []).filter(inScope))
    const scanConfig = { ...parameterScanConfig.value, selections }
    const rehydratedModel = await readFileAsText(blob)
    const extractedData = extractVoiAndParametersFromModel(rehydratedModel, scanConfig)
    const snapshot = snapshotFlowState(scope?.nodeIds ?? null)
    const cellmlFileName = omexStore.cellmlFileName

    return generateOmexArchive(
      { blob },
      snapshot,
      {
        simulationSettings: simulationSettings.value,
        plotConfig: resolvePlotConfig(plotConfig.value, scope?.nodes ?? modelNodes.value),
        parameterScanConfig: scanConfig,
      },
      // A selection is never the model as imported.
      { extractedData, modified: scope ? true : hasModelChanged.value, cellmlFileName }
    )
  }

  const hasSelection = computed(() => (selectedNodeIds.value?.length ?? 0) > 0)

  const selectionOmexOption = (key) => ({
    key,
    label: 'OpenCOR (selection)',
    icon: OpenCORIcon,
    disabled: libcellml.status !== 'ready' || !hasSelection.value,
    isSelection: true,
    suffix: '.omex',
    fileTypes: OMEX_FILE_TYPES,
    message: 'Generating OMEX archive of the selection for Web OpenCOR.',
    preflight: confirmSelectionExport,
    action: (finalName) => generateOmexArchiveAction(finalName, resolveSelectionScope()),
  })

  const exportOptions = computed(() => [
    {
      key: EXPORT_KEYS.CELLML,
      label: 'CellML',
      icon: CellMLIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.cellml',
      fileTypes: CELLML_FILE_TYPES,
      message: 'Generating flattened CellML model.',
      action: () => {
        const model = buildWholeModel()
        return generateFlattenedModel(model.nodes, model.edges, libraryStore, inspectionModuleStore.modules)
      },
      successMessage: async (blob, finalName) => {
        const dataUri = await createCellMLDataFragment(blob, finalName)
        return h('div', null, [
          'Model exported to CellML. Open this model directly in ',
          h(
            'a',
            {
              href: `https://opencor.ws/app/?opencor://openFile/#${dataUri}`,
              rel: 'noopener noreferrer',
              style: { color: 'var(--p-primary-color)', fontWeight: 'bold' },
              target: '_blank',
            },
            'OpenCOR'
          ),
        ])
      },
    },
    {
      key: EXPORT_KEYS.CA,
      label: 'Circulatory Autogen',
      icon: 'pi pi-box',
      disabled: libcellml.status !== 'ready',
      suffix: '.zip',
      fileTypes: ZIP_FILE_TYPES,
      message: 'Generating and zipping CA files.',
      // CA's own checks, such as its one heart, run on the model's rows.
      action: (finalName) => {
        const model = buildWholeModel()
        return generateExportZip(finalName, model.nodes, model.edges, libraryStore, protocolStore.source?.entry.payload ?? null)
      },
      successMessage: () => 'Circulatory Autogen export zip generated.',
    },
    {
      key: EXPORT_KEYS.OMEX,
      label: 'OpenCOR',
      icon: OpenCORIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.omex',
      fileTypes: OMEX_FILE_TYPES,
      message: 'Generating OMEX archive for Web OpenCOR.',
      action: generateOmexArchiveAction,
      successMessage: async (blob, finalName) => {
        const dataUri = await createOmexDataFragment(blob)
        return h('div', null, [
          'OMEX archive generated for Web OpenCOR. Open this model directly in ',
          h(
            'a',
            {
              href: `https://opencor.ws/app/?opencor://openFile/#${dataUri}`,
              rel: 'noopener noreferrer',
              style: { color: 'var(--p-primary-color)', fontWeight: 'bold' },
              target: '_blank',
            },
            'OpenCOR'
          ),
        ])
      },
    },
    {
      key: EXPORT_KEYS.CUFLYNX,
      label: 'CUFLynx',
      icon: CUFLynxIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.omex',
      fileTypes: OMEX_FILE_TYPES,
      message: 'Generating OMEX archive for CUFLynx.',
      action: generateOmexArchiveAction,
      successMessage: () => 'CUFLynx export OMEX generated.',
      // Temporarily disabled until CUFLynx can register the protocol handler.
      // successMessage: async (blob, finalName) => {
      //   const dataUri = await createOmexDataFragment(blob)
      //   return h('div', null, [
      //     'OMEX archive generated for CUFLynx. Open this model directly in ',
      //     h(
      //       'a',
      //       {
      //         href: `cuflynx://api?import=omex#${dataUri}`,
      //         rel: 'noopener noreferrer',
      //         style: { color: 'var(--p-primary-color)', fontWeight: 'bold' },
      //         target: '_blank',
      //       },
      //       'CUFLynx'
      //     ),
      //   ])
      // },
    },
    {
      key: EXPORT_KEYS.CELLML_SELECTION,
      label: 'CellML (selection)',
      icon: CellMLIcon,
      disabled: libcellml.status !== 'ready' || !hasSelection.value,
      isSelection: true,
      suffix: '.cellml',
      fileTypes: CELLML_FILE_TYPES,
      message: 'Generating flattened CellML model of the selection.',
      preflight: confirmSelectionExport,
      action: () => buildScopedModel(resolveSelectionScope(), libraryStore),
      successMessage: () => 'Selection exported to CellML.',
    },
    selectionOmexOption(EXPORT_KEYS.OMEX_SELECTION),
  ])

  const currentExportMode = computed(
    () => exportOptions.value.find((option) => option.key === currentExportKey.value) ?? exportOptions.value[0] ?? null
  )

  const sendOptions = computed(() => [
    {
      key: SEND_KEYS.OPENCOR,
      label: 'OpenCOR',
      icon: OpenCORIcon,
      disabled: libcellml.status !== 'ready',
      suffix: '.omex',
      fileTypes: OMEX_FILE_TYPES,
      message: 'Generating OMEX archive for Web OpenCOR.',
      action: generateOmexArchiveAction,
    },
    selectionOmexOption(SEND_KEYS.OPENCOR_SELECTION),
  ])

  const currentSendMode = computed(
    () => sendOptions.value.find((option) => option.key === currentSendKey.value) ?? sendOptions.value[0] ?? null
  )

  const importMenuItems = computed(() =>
    importOptions.value.map((opt) => ({
      label: opt.label,
      icon: opt.icon,
      disabled: opt.disabled,
      command: () => performImport(opt),
    }))
  )

  /**
   * Builds menu items for options, with a separator before the selection-only ones.
   *
   * @param {Array<Object>} options
   * @param {Function} onSelect - Called with the chosen option.
   * @returns {Array<Object>}
   */
  const buildMenuItems = (options, onSelect) =>
    options.flatMap((opt, index) => [
      ...(opt.isSelection && !options[index - 1]?.isSelection ? [{ separator: true }] : []),
      {
        label: opt.label,
        icon: opt.icon,
        disabled: opt.disabled || !opt.action,
        command: () => onSelect(opt),
      },
    ])

  // The whole-model modes to fall back to when a remembered selection mode has nothing selected.
  let wholeModelExportKey = currentExportKey.value
  let wholeModelSendKey = currentSendKey.value

  const exportMenuItems = computed(() =>
    buildMenuItems(exportOptions.value, (opt) => {
      currentExportKey.value = opt.key
      if (!opt.isSelection) wholeModelExportKey = opt.key
      return performExport(opt)
    })
  )

  const sendMenuItems = computed(() =>
    buildMenuItems(sendOptions.value, (opt) => {
      currentSendKey.value = opt.key
      if (!opt.isSelection) wholeModelSendKey = opt.key
      return performSend(opt)
    })
  )

  watch(hasSelection, (isSelected) => {
    if (isSelected) return
    if (currentExportMode.value?.isSelection) currentExportKey.value = wholeModelExportKey
    if (currentSendMode.value?.isSelection) currentSendKey.value = wholeModelSendKey
  })

  const currentExportDisabled = computed(() => !currentExportMode.value || currentExportMode.value.disabled)

  const currentImportDisabled = computed(() => !currentImportMode.value || currentImportMode.value.disabled)

  const currentSendDisabled = computed(() => !currentSendMode.value || currentSendMode.value.disabled)

  const triggerCurrentImport = () => {
    performImport(currentImportMode.value)
  }

  const triggerCurrentSend = () => {
    performSend(currentSendMode.value)
  }

  const performImport = (mode) => {
    currentImportKey.value = mode.key
    currentImportConfig.value = getImportConfig(mode.key)

    if (currentImportConfig.value) {
      importDialogVisible.value = true
    }
  }

  const performExport = async (mode) => {
    if (mode.preflight && !(await mode.preflight())) return
    const baseName = sessionMetadataStore.lastSaveName
    const fileTypes = mode.fileTypes || ZIP_FILE_TYPES

    const result = await getFileHandle(baseName, fileTypes, mode.suffix)
    if (result.success && result.handle) {
      onExportConfirm(result.cleanName, result.handle)
    } else if (result.needsLegacyDialog) {
      exportDialogVisible.value = true
    }
  }

  const performSend = async (mode) => {
    if (mode.preflight && !(await mode.preflight())) return
    const baseName = sessionMetadataStore.lastSaveName

    const notification = notify.info({ title: 'Sending...', message: mode.message, duration: 0 })
    try {
      const blob = await mode.action(baseName)
      const dataUri = await createOmexDataFragment(blob)
      // Open the generated OMEX archive in Web OpenCOR
      // This needs to change to support other send modes in the future, but for now we only have OpenCOR.
      const url = `https://opencor.ws/app/?opencor://openFile/#${dataUri}`
      window.open(url, '_blank', 'noreferrer')
    } catch (error) {
      notify.error({ title: 'Send failed', message: error.message })
    } finally {
      notification?.close?.()
    }
  }

  const triggerCurrentExport = () => {
    if (currentExportMode.value) {
      performExport(currentExportMode.value)
    }
  }

  return {
    currentExportMode,
    currentImportMode,
    currentSendMode,
    exportMenuItems,
    importMenuItems,
    sendMenuItems,
    currentExportDisabled,
    currentImportDisabled,
    currentSendDisabled,
    triggerCurrentExport,
    triggerCurrentImport,
    triggerCurrentSend,
  }
}
