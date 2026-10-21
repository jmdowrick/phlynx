// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const RUNTIME = '../../../../src/services/celldl/runtime.js'

/** Mocks the editor, bg2cellml and libCellML, the editor's loader running `load` each time. */
function mockModules({ load, frameworkIssues = [] }) {
  const loader = vi.fn(load)
  const loadFramework = vi.fn(() => frameworkIssues)
  const Converter = vi.fn(function (runtime) {
    this.runtime = runtime
    this.loadFramework = loadFramework
  })
  vi.doMock('../../../../src/utils/cellml.js', () => ({ whenLibCellMLReady: () => Promise.resolve('libcellml') }))
  vi.doMock('@celldl/editor', () => ({ CellDLEditor: { __asyncLoader: loader }, bgRdfStatements: () => ['quad'] }))
  vi.doMock('@physiomelinks/bg2cellml', () => ({ Converter }))
  return { loader, loadFramework, Converter }
}

const startRdf = async () => {
  globalThis.rdfModule = 'oxigraph'
}

describe('getConverter', () => {
  beforeEach(() => {
    vi.resetModules()
    delete globalThis.rdfModule
  })

  afterEach(() => {
    vi.doUnmock('../../../../src/utils/cellml.js')
    vi.doUnmock('@celldl/editor')
    vi.doUnmock('@physiomelinks/bg2cellml')
    delete globalThis.rdfModule
  })

  it("builds one converter on the editor's oxigraph and framework", async () => {
    const { loader, loadFramework, Converter } = mockModules({ load: startRdf })
    const { getConverter } = await import(RUNTIME)

    const converter = await getConverter()

    expect(await getConverter()).toBe(converter)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(Converter).toHaveBeenCalledWith({ libcellml: 'libcellml', oxigraph: 'oxigraph' })
    expect(loadFramework).toHaveBeenCalledWith({ quads: ['quad'] })
  })

  it("carries on when the editor's UI chunk fails after its RDF layer starts", async () => {
    mockModules({
      load: async () => {
        await startRdf()
        throw new Error('document is not defined')
      },
    })
    const { getConverter } = await import(RUNTIME)

    await expect(getConverter()).resolves.toBeTruthy()
  })

  it("fails, and tries again next time, when the editor's RDF layer doesn't start", async () => {
    const { loader } = mockModules({
      load: async () => {
        throw new Error('no wasm')
      },
    })
    const { getConverter } = await import(RUNTIME)

    await expect(getConverter()).rejects.toThrow('no wasm')
    loader.mockImplementation(startRdf)
    await expect(getConverter()).resolves.toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it("fails when the framework doesn't load", async () => {
    mockModules({ load: startRdf, frameworkIssues: ['No ontology'] })
    const { getConverter } = await import(RUNTIME)

    await expect(getConverter()).rejects.toThrow(/framework didn't load: No ontology/)
  })
})
