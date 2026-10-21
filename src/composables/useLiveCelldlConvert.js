/**
 * SPIKE: converts the CellDL editor's diagram as it is edited, on a debounce, in a worker (or on the main
 * thread, to compare). Stale results are dropped by sequence number, and at most one conversion is in
 * flight: edits that arrive meanwhile wait, and only the latest is converted next.
 *
 * Settings come from `window.__liveConvertConfig` (for the measuring driver):
 *   mode: 'worker' | 'main' | 'off' (default 'worker')
 *   debounce: ms (default 300)
 *   cheap: skip libCellML's Validator and Analyser (default false)
 *   tiered: cheap pass on the debounce, then a full one after `fullDelay` ms idle (default false, 1000)
 * Each conversion is logged in `window.__liveConvert.log`.
 */
import { ref, shallowRef } from 'vue'

import { useCelldlEditorHost } from './useCelldlEditorHost'
import { useLibraryStore } from '../stores/libraryStore'
import { whenLibCellMLReady } from '../utils/cellml.js'
import { getConverter } from '../services/celldl/runtime.js'
import { convertLive } from '../services/celldl/livePipeline.js'
import { DEFAULT_SOURCE_URI } from '@physiomelinks/bg2cellml'

const config = () => ({ mode: 'worker', debounce: 300, cheap: false, tiered: false, fullDelay: 1000, ...(window.__liveConvertConfig ?? {}) })

const metrics = (window.__liveConvert ??= { log: [], startup: null, memory: [] })

let state = null

function create() {
  const host = useCelldlEditorHost()
  const store = useLibraryStore()

  const status = ref('idle')
  const issues = shallowRef([])
  const cellml = ref('')
  const lastMs = ref(null)
  const lastKind = ref('')

  let worker = null
  let workerReady = null
  let mainRuntime = null
  let seq = 0
  let latestSeq = 0
  let inFlight = null
  let pending = null
  let debounceTimer = null
  let fullTimer = null
  let latest = null

  async function frameworkNQuads() {
    const editor = await import('@celldl/editor')
    const oxigraph = await editor.initialiseRdf()
    const quadStore = new oxigraph.Store()
    for (const quad of editor.bgRdfStatements()) quadStore.add(quad)
    return quadStore.dump({ format: 'application/n-quads' })
  }

  const knownUnits = () => (store.availableUnits ?? []).map((file) => file.model)

  function startWorker() {
    if (workerReady) return workerReady
    const t0 = performance.now()
    workerReady = (async () => {
      const tf = performance.now()
      const framework = await frameworkNQuads()
      const serialiseMs = performance.now() - tf
      worker = new Worker(new URL('../workers/celldlConvertWorker.js', import.meta.url), { type: 'module' })
      worker.onmessage = onWorkerMessage
      await new Promise((resolve, reject) => {
        startupResolve = resolve
        startupReject = reject
        worker.postMessage({ type: 'init', framework, knownUnits: knownUnits() })
      })
      metrics.startup = { ...metrics.startup, serialiseFrameworkMs: serialiseMs, frameworkBytes: framework.length, endToEndMs: performance.now() - t0 }
    })()
    return workerReady
  }

  let startupResolve = null
  let startupReject = null
  const memoryWaiters = []

  function onWorkerMessage({ data }) {
    if (data.type === 'ready') {
      metrics.startup = { worker: data.timings }
      startupResolve?.()
    } else if (data.type === 'init-error') {
      console.error('Live convert worker failed:', data.error)
      startupReject?.(new Error(data.error))
    } else if (data.type === 'memory') {
      memoryWaiters.shift()?.(data)
    } else if (data.type === 'result') {
      finish(data.seq, data.result, data.timings)
    }
  }

  async function getMainRuntime() {
    if (mainRuntime) return mainRuntime
    const editor = await import('@celldl/editor')
    const [libcellml, oxigraph, converter] = await Promise.all([whenLibCellMLReady(), editor.initialiseRdf(), getConverter()])
    mainRuntime = { runtime: { libcellml, oxigraph }, framework: converter.framework }
    return mainRuntime
  }

  /** Hears a change: converts it once edits pause. */
  function onChange(change, at) {
    const settings = config()
    if (settings.mode === 'off') return
    latest = { ...change, changeAt: at, inputAt: window.__lastInputAt ?? null }
    clearTimeout(debounceTimer)
    clearTimeout(fullTimer)
    status.value = 'waiting'
    debounceTimer = setTimeout(() => {
      request(latest, settings.cheap || settings.tiered)
      if (settings.tiered && !settings.cheap) {
        const target = latest
        fullTimer = setTimeout(() => request(target, false), settings.fullDelay)
      }
    }, settings.debounce)
  }

  function request(change, cheap) {
    const job = { ...change, seq: ++seq, cheap, firedAt: performance.now() }
    latestSeq = job.seq
    if (inFlight) {
      if (pending) record(pending, null, null, { superseded: true })
      pending = job
      return
    }
    run(job)
  }

  async function run(job) {
    inFlight = job
    status.value = 'converting'
    job.postAt = performance.now()
    const settings = config()
    const source = host.shownSource()
    const options = {
      documentUri: source?.documentUri ?? DEFAULT_SOURCE_URI,
      componentName: 'live',
      cheap: job.cheap,
      validateOnly: !!settings.validateOnly,
    }
    if (settings.mode === 'main') {
      const { runtime, framework } = await getMainRuntime()
      const start = performance.now()
      const result = convertLive(runtime, framework, job.rdf, { baseUri: options.documentUri, componentName: options.componentName, knownUnits: knownUnits(), cheap: job.cheap, validateOnly: !!settings.validateOnly })
      finish(job.seq, result, { queued: 0, worker: performance.now() - start })
      return
    }
    await startWorker()
    job.postAt = performance.now()
    worker.postMessage({ type: 'convert', seq: job.seq, rdf: job.rdf, ...options })
  }

  function finish(jobSeq, result, timings) {
    const job = inFlight
    inFlight = null
    const resultAt = performance.now()
    const isStale = jobSeq !== latestSeq
    record(job, result, timings, { resultAt, stale: isStale })
    if (!isStale) {
      issues.value = result.issues
      cellml.value = result.cellml ?? ''
      lastMs.value = resultAt - (job.changeAt ?? resultAt)
      lastKind.value = job.cheap ? 'cheap' : 'full'
      status.value = result.ok ? 'ok' : 'error'
      host.highlight(result.issues.map((issue) => issue.elementId).filter(Boolean))
    }
    if (pending) {
      const next = pending
      pending = null
      run(next)
    }
  }

  function record(job, result, timings, extra) {
    metrics.log.push({
      seq: job?.seq,
      revision: job?.revision,
      cheap: job?.cheap,
      mode: config().mode,
      rdfBytes: job?.rdf?.length,
      inputAt: job?.inputAt,
      changeAt: job?.changeAt,
      firedAt: job?.firedAt,
      postAt: job?.postAt,
      ok: result?.ok,
      nIssues: result?.issues?.length,
      cellmlBytes: result?.cellml?.length,
      stages: result?.timings,
      workerMs: timings?.worker,
      queuedMs: timings?.queued,
      ...extra,
    })
  }

  /** Asks the worker for its wasm memory. */
  function workerMemory() {
    if (!worker) return Promise.resolve(null)
    return new Promise((resolve) => {
      memoryWaiters.push(resolve)
      worker.postMessage({ type: 'memory' })
    })
  }

  host.onChange(onChange)
  metrics.workerMemory = workerMemory
  metrics.startWorker = startWorker
  metrics.mainMemory = () => {
    return { jsHeap: performance.memory?.usedJSHeapSize ?? null }
  }

  return { status, issues, cellml, lastMs, lastKind, startWorker }
}

/** Gets the live conversion, starting it on first use. */
export function useLiveCelldlConvert() {
  state ??= create()
  return state
}
