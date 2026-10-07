import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { findObsDataExtra, readObsDataParts } from '../services/protocol/obsDataDocument'
import { readProtocolInfo } from '../services/protocol/protocolModel'
import { validateProtocolInfo } from '../services/protocol/protocolValidation'
import { cyrb53 } from '../utils/misc'
import { useOmexStore } from './omexStore'

/**
 * The workspace's experiment protocol, read from the obs_data.json its archive carries (CUFLynx and circulatory
 * autogen's format), and whether play runs it. Never saved itself: the obs_data file is saved with the archive's
 * other files.
 */
export const useProtocolStore = defineStore('protocol', () => {
  const omexStore = useOmexStore()
  /** Whether play runs the protocol rather than the settings' time course; the session's choice. */
  const isProtocolMode = ref(false)
  /** The experiment whose results are shown, by index. */
  const activeExperiment = ref(0)

  /** The obs_data file found among the archive's files, or null. */
  const source = computed(() => findObsDataExtra(omexStore.preservedExtras))
  /** The file's protocol_info, or null when it has none or can't be read. */
  const protocolInfo = computed(() => (source.value?.document === undefined ? null : readObsDataParts(source.value.document).protocolInfo))
  /** Whether the workspace has a protocol to run. */
  const hasProtocol = computed(() => protocolInfo.value != null)
  /** `{ errors, warnings }` from checking the protocol; an unreadable file is an error. */
  const validation = computed(() => {
    if (source.value?.parseError) return { errors: [`${source.value.entry.location} isn't valid JSON: ${source.value.parseError.message}`], warnings: [] }
    if (!hasProtocol.value) return { errors: [], warnings: [] }
    const { errors, warnings } = validateProtocolInfo(protocolInfo.value)
    return { errors, warnings }
  })
  /** The protocol as experiments of sub-experiments (see readProtocolInfo), or null when it can't run. */
  const view = computed(() => {
    if (!hasProtocol.value) return null
    const { errors, protocolInfo: valid } = validateProtocolInfo(protocolInfo.value)
    return errors.length ? null : markRaw(readProtocolInfo(valid))
  })
  /** Whether play runs the protocol. */
  const isActive = computed(() => isProtocolMode.value && (hasProtocol.value || !!source.value?.parseError))
  /** The protocol's inputs to a run, to tell when its results have gone stale. */
  const signature = computed(() => (isActive.value ? String(cyrb53(JSON.stringify(protocolInfo.value))) : ''))

  /**
   * Shows an experiment's results.
   *
   * @param {number} index
   */
  function setActiveExperiment(index) {
    activeExperiment.value = index
  }

  function resetState() {
    isProtocolMode.value = false
    activeExperiment.value = 0
  }

  return { isProtocolMode, activeExperiment, source, protocolInfo, hasProtocol, validation, view, isActive, signature, setActiveExperiment, resetState }
})
