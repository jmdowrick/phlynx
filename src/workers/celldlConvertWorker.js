/**
 * SPIKE: converts CellDL diagrams off the main thread. It loads its own libCellML and oxigraph, and is
 * sent the BG-RDF framework once as N-Quads.
 *
 * Messages in:
 *   { type: 'init', framework: string (N-Quads), knownUnits?: string[] }
 *   { type: 'units', knownUnits: string[] }
 *   { type: 'convert', seq, rdf, documentUri, componentName, cheap?, withCellml? }
 *   { type: 'memory' }
 * Messages out:
 *   { type: 'ready', timings } | { type: 'init-error', error }
 *   { type: 'result', seq, result, timings: { queued, worker } }
 *   { type: 'memory', libcellml, oxigraph, jsHeap }
 */
import createLibCellML from 'libcellml.js/libcellml.js'
import libcellmlWasm from 'libcellml.js/libcellml.wasm?url'
import initOxigraph, * as oxigraph from 'oxigraph/web.js'
import oxigraphWasm from 'oxigraph/web_bg.wasm?url'
import { DOMParser } from '@xmldom/xmldom'
import { Converter } from '@physiomelinks/bg2cellml'

import { convertLive } from '../services/celldl/livePipeline.js'

// SPIKE: catch each wasm instance's memory, for the memory report (libCellML doesn't export wasmMemory).
const wasmMemories = []
const keepMemory = (result) => {
  const instance = result.instance ?? result
  for (const value of Object.values(instance.exports ?? {})) if (value instanceof WebAssembly.Memory) wasmMemories.push(value)
  return result
}
for (const name of ['instantiate', 'instantiateStreaming']) {
  const original = WebAssembly[name]
  WebAssembly[name] = (...args) => original.apply(WebAssembly, args).then(keepMemory)
}

let runtime = null
let framework = null
let oxigraphExports = null
let knownUnits = []
let ready = null

async function init(nquads) {
  const t0 = performance.now()
  const [libcellml, exports] = await Promise.all([
    createLibCellML({ locateFile: () => libcellmlWasm }),
    initOxigraph({ module_or_path: oxigraphWasm }),
  ])
  oxigraphExports = exports
  const tWasm = performance.now()
  const store = new oxigraph.Store()
  store.load(nquads, { format: 'application/n-quads' })
  runtime = { libcellml, oxigraph, domParser: new DOMParser() }
  const converter = new Converter(runtime)
  const issues = converter.loadFramework({ quads: store.match() })
  if (issues.length) throw new Error(issues.join('; '))
  framework = converter.framework
  return { wasm: tWasm - t0, framework: performance.now() - tWasm, total: performance.now() - t0 }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    if (data.knownUnits) knownUnits = data.knownUnits
    ready = init(data.framework)
    try {
      self.postMessage({ type: 'ready', timings: await ready })
    } catch (error) {
      self.postMessage({ type: 'init-error', error: String(error?.stack ?? error) })
    }
    return
  }
  if (data.type === 'units') {
    knownUnits = data.knownUnits ?? []
    return
  }
  if (data.type === 'memory') {
    self.postMessage({
      type: 'memory',
      wasm: wasmMemories.map((memory) => memory.buffer.byteLength),
      oxigraph: oxigraphExports?.memory?.buffer.byteLength ?? null,
      jsHeap: self.performance?.memory?.usedJSHeapSize ?? null,
    })
    return
  }
  if (data.type === 'convert') {
    const received = performance.now()
    await ready
    const start = performance.now()
    let result
    try {
      result = convertLive(runtime, framework, data.rdf, {
        baseUri: data.documentUri,
        componentName: data.componentName,
        knownUnits,
        cheap: !!data.cheap,
        validateOnly: !!data.validateOnly,
        withCellml: data.withCellml !== false,
      })
    } catch (error) {
      result = { ok: false, issues: [{ message: String(error?.message ?? error), severity: 'error', stage: 'exception' }], elements: {}, timings: {} }
    }
    self.postMessage({ type: 'result', seq: data.seq, result, timings: { queued: start - received, worker: performance.now() - start } })
  }
}
