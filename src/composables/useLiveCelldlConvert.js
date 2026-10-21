/**
 * Converts the CellDL editor's diagram to CellML as it is edited, in a worker, so the page never waits on
 * libCellML. Two passes follow each edit: a cheap one once edits pause (no libCellML checks: the CellML, the
 * element manifest and the issues found building the model, in tens of milliseconds), then a full one once the
 * diagram has been left alone a while (the Validator and Analyser, which can take seconds on a big diagram).
 *
 * One conversion runs at a time, and of those waiting only the newest is sent. A result for a diagram edited
 * since is dropped. The results are advisory: diagrams mid-edit are often invalid, and Save converts again.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { useCelldlEditorHost } from './useCelldlEditorHost'
import { useLibraryStore } from '../stores/libraryStore'
import { getModuleFormat } from '../services/moduleFormats'
import { knownUnitsFor } from '../services/celldl/knownUnits.js'

/** How long edits must pause before the cheap pass, and the diagram be left alone before the full one. */
export const CHEAP_DELAY_MS = 150
export const FULL_DELAY_MS = 1000

/** The libCellML checks each pass runs (bg2cellml's `checks`). */
const PASS_CHECKS = Object.freeze({ cheap: 'none', full: 'full' })

/**
 * Starts the conversion worker.
 *
 * @param {Object} framework - The BG-RDF framework as text, `{ ontology, templates }`.
 * @param {string[]} knownUnits
 * @returns {Promise<Object>} bg2cellml's ConversionWorker.
 */
async function startWorker(framework, knownUnits) {
  const { createConversionWorker } = await import('@physiomelinks/bg2cellml/worker')
  const worker = new Worker(new URL('../workers/celldlConvertWorker.js', import.meta.url), { type: 'module' })
  return createConversionWorker(worker, { framework, defaults: { knownUnits } })
}

async function loadFramework() {
  const { bgRdfFramework } = await import('@celldl/editor/bgrdf')
  return bgRdfFramework()
}

async function loadAnnotations(elements) {
  const { toViewerAnnotations } = await import('@physiomelinks/bg2cellml')
  return toViewerAnnotations(elements)
}

const isSameList = (list, other) => list.length === other.length && list.every((item, index) => item === other[index])

/**
 * Creates a live conversion. The app uses the one useLiveCelldlConvert returns; tests make their own.
 *
 * @param {Object} options
 * @param {Object} options.host - The CellDL editor host (createCelldlEditorHost).
 * @param {() => string[]} [options.knownUnits] - The library's units for the converted module to name around; read
 *   reactively, and sent to the worker again only when they change.
 * @param {(framework: Object, knownUnits: string[]) => Promise<Object>} [options.createWorker] - Starts
 *   bg2cellml's ConversionWorker.
 * @param {() => Promise<Object>} [options.loadFramework]
 * @param {(elements: Object) => Promise<Object>} [options.loadAnnotations] - Makes viewer annotations of an
 *   element manifest.
 * @param {boolean} [options.isAvailable] - Whether this build can convert; Electron can't.
 * @param {number} [options.cheapDelay]
 * @param {number} [options.fullDelay]
 */
export function createLiveCelldlConvert({
  host,
  knownUnits = () => [],
  createWorker = startWorker,
  loadFramework: getFramework = loadFramework,
  loadAnnotations: annotate = loadAnnotations,
  isAvailable = typeof Worker !== 'undefined',
  cheapDelay = CHEAP_DELAY_MS,
  fullDelay = FULL_DELAY_MS,
}) {
  /** The worker's failure to start, which turns live conversion off. */
  const error = ref('')
  /** Whether the latest diagram has yet to be converted: the cheap pass hasn't reported on it. */
  const isPending = ref(false)
  /** Whether a full pass is waiting or running for the latest diagram. */
  const isChecking = ref(false)
  /** The latest diagram's conversion, `{ pass, edit, result }`, or null before its first. */
  const latest = shallowRef(null)
  /** The component the CellML is generated as, so the preview reads as saving would make it. */
  const componentName = ref(undefined)

  const result = computed(() => latest.value?.result ?? null)
  const issues = computed(() => (result.value ? [...result.value.errors, ...result.value.warnings] : []))

  let worker = null
  let convertLatest = null
  let starting = null
  let stopListening = null
  let stopUnitsWatch = null
  let sentUnits = []
  // The newest diagram heard, and how many have been, so a result for an older one is dropped.
  let diagram = null
  let edits = 0
  let cheapTimer = null
  let fullTimer = null

  /**
   * Starts converting the diagram as it changes, once: the worker is kept for the session. After a failure to
   * start, it tries again.
   *
   * @returns {Promise<void>} Resolves once the worker is ready; rejects if it can't start.
   */
  function start() {
    if (!isAvailable) return Promise.resolve()
    stopListening ??= host.onChange(onChange)
    starting ??= (async () => {
      error.value = ''
      sentUnits = [...knownUnits()]
      const conversionWorker = await createWorker(await getFramework(), sentUnits)
      worker = conversionWorker
      convertLatest = conversionWorker.latest()
      await conversionWorker.ready
      stopUnitsWatch = watch(knownUnits, (units) => {
        if (isSameList(units, sentUnits)) return
        sentUnits = [...units]
        worker?.setDefaults({ knownUnits: sentUnits })
      })
    })().catch((e) => {
      console.error('Live CellDL conversion is off:', e)
      error.value = e.message
      stop()
      throw e
    })
    return starting
  }

  /**
   * Hears a diagram: converts it once edits pause, and checks it fully once they stop. A diagram just opened
   * starts afresh, with its cheap pass at once.
   *
   * @param {{rdf: string, documentUri: string|null, isOpened: boolean}} change
   */
  function onChange(change) {
    diagram = change
    edits += 1
    clearTimeout(cheapTimer)
    clearTimeout(fullTimer)
    if (change.isOpened) latest.value = null
    isPending.value = true
    isChecking.value = true
    cheapTimer = setTimeout(() => run('cheap'), change.isOpened ? 0 : cheapDelay)
    fullTimer = setTimeout(() => run('full'), fullDelay)
  }

  /**
   * Converts the newest diagram.
   *
   * @param {'cheap'|'full'} pass
   */
  async function run(pass) {
    if (!convertLatest) {
      // The worker is still starting; a first edit waits for it.
      try {
        await start()
      } catch {
        return
      }
    }
    const edit = edits
    const { rdf, documentUri } = diagram
    let conversion
    try {
      conversion = await convertLatest(rdf, {
        rdfSource: true,
        checks: PASS_CHECKS[pass],
        ...(documentUri ? { sourceUri: documentUri } : {}),
        ...(componentName.value ? { componentName: componentName.value } : {}),
      })
    } catch (e) {
      if (!worker) return
      console.error('Live CellDL conversion failed:', e)
      conversion = { result: failedResult(e) }
    }
    // Superseded, or the diagram has changed since.
    if (!conversion || edit !== edits) return
    // The full pass may have overtaken a cheap one that waited behind the worker.
    if (pass === 'cheap' && latest.value?.edit === edit && latest.value.pass === 'full') return
    latest.value = { pass, edit, result: conversion.result }
    // A full pass answers for a cheap one it superseded.
    isPending.value = false
    if (pass === 'full') isChecking.value = false
    show(conversion.result, edit)
  }

  /**
   * Marks the elements with issues, and annotates the diagram as converted, so new elements show their variables.
   * An element manifest left empty by a failed build keeps the last annotations.
   */
  function show(conversion, edit) {
    const ids = [...conversion.errors, ...conversion.warnings].map((issue) => issue.elementId).filter(Boolean)
    host.highlight([...new Set(ids)], { isLive: true })
    if (!Object.keys(conversion.elements ?? {}).length) return
    annotate(conversion.elements).then(
      (annotations) => edit === edits && host.setLiveAnnotations(annotations),
      (e) => console.error('CellDL annotations failed:', e)
    )
  }

  /**
   * Sets the component the CellML is generated as.
   *
   * @param {string|undefined} name
   */
  function setComponentName(name) {
    componentName.value = name || undefined
  }

  /** Stops converting and ends the worker. */
  function stop() {
    clearTimeout(cheapTimer)
    clearTimeout(fullTimer)
    stopListening?.()
    stopUnitsWatch?.()
    stopListening = stopUnitsWatch = null
    const ending = worker
    worker = convertLatest = null
    starting = null
    isPending.value = false
    isChecking.value = false
    ending?.terminate()
  }

  return {
    isAvailable,
    error,
    isPending,
    isChecking,
    latest,
    result,
    issues,
    start,
    stop,
    setComponentName,
  }
}

/** A result for a conversion the worker couldn't run, shaped as bg2cellml's. */
function failedResult(e) {
  const issue = { message: `The live conversion failed: ${e.message}`, severity: 'error', stage: 'build' }
  return { ok: false, elements: {}, issues: [issue], errors: [issue], warnings: [] }
}

let live = null

/**
 * Gets the app's live conversion of the CellDL editor's diagram. Its worker ends when the page does.
 *
 * @returns {ReturnType<typeof createLiveCelldlConvert>}
 */
export function useLiveCelldlConvert() {
  if (live) return live
  const store = useLibraryStore()
  const host = useCelldlEditorHost()
  const ownUnitsFile = ref(null)
  live = createLiveCelldlConvert({
    host,
    knownUnits: () => knownUnitsFor(store.availableUnits, ownUnitsFile.value),
    isAvailable: getModuleFormat('celldl').isAvailable && typeof Worker !== 'undefined',
  })
  /**
   * Sets the module the diagram is converted for: its component name and its own units file, which its CellML
   * replaces, so isn't a known units file.
   *
   * @param {{componentName?: string, unitsFile?: string|null}} module
   */
  live.setModule = ({ componentName, unitsFile } = {}) => {
    live.setComponentName(componentName)
    ownUnitsFile.value = unitsFile ?? null
  }
  // A page kept for going back to keeps its worker too.
  window.addEventListener('pagehide', (event) => event.persisted || live.stop())
  return live
}
