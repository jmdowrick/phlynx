// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'

import createLibOpenCOR from '@opencor/libopencor'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { orderForCa } from '../fixtures/ca/order.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { compareCanonical, compareSimulations } from '../../../src/services/testing/modelCompare.js'
import { migrateWorkspace } from '../../../src/services/workspaceMigrator.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { checkAndClaimCouplings, previewCouplings, resolvePortCouplings } from '../../../src/utils/edges.js'
import { isModelEdge } from '../../../src/utils/hierarchy.js'
import {
  bcOnlyThroughInterface,
  exposureLeavesInternalCouplings,
  heartSlots,
  hubBranches,
  loadBundledLibrary,
  moduleFactory,
  multiply,
  threeInstances,
  twoLevel,
  venousFanIn,
} from '../fixtures/hierarchy/equivalence.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// The generated components' variables are named in the order edges are exported, so compare them by what they join.
const GENERATED = ['generated_summations', 'generated_multiplications']

/** Each edge as its modules' names and its couplings' ports, slots and variables, sorted. */
function couplingsOf({ nodes, edges }) {
  const nameOf = new Map(nodes.map((node) => [node.id, node.data.name]))
  const end = (port, slot) => `${port.portType}:${port.label}:${slot}[${port.variables}|${port.multiportType}|${port.multiplyFactor ?? ''}]`
  return edges
    .map((edge) => {
      const couplings = edge.data.couplings.map((c) => `${end(c.sourcePort, c.sourceSlot)} > ${end(c.targetPort, c.targetSlot)}`)
      return `${nameOf.get(edge.source)} > ${nameOf.get(edge.target)}: ${couplings.sort().join(', ')}`
    })
    .sort()
}

/** The circulatory_autogen module array's rows, each with its inp and out lists, as names. */
function caListsOf({ nodes, edges }) {
  const nameOf = new Map(nodes.map((node) => [node.id, node.data.name]))
  const { rows, inpEdges, outEdges } = orderForCa(nodes, edges)
  return rows.map((node) => ({
    name: node.data.name,
    inp: inpEdges.get(node.id).map((edge) => nameOf.get(edge.source)),
    out: outEdges.get(node.id).map((edge) => nameOf.get(edge.target)),
  }))
}

describe('a bundled flat workspace', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('blocks no bundled flat workspace: whatever it reports is a warning', () => {
    const dir = path.resolve(process.cwd(), 'tests/resources/migration-versioning')
    for (const file of ['v1-2-0/sn_simple.json', 'legacy/microvasculature.json', 'legacy/tran_hund_coupled.json']) {
      const { nodes, edges } = migrateWorkspace(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))).flow
      // Legacy edges have no couplings yet; the workspace resolves them on load.
      const nodeById = new Map(nodes.map((node) => [node.id, node]))
      const used = new Set()
      for (const edge of edges.filter((edge) => !edge.data?.couplings)) {
        const [source, target] = [nodeById.get(edge.source), nodeById.get(edge.target)]
        const couplings = resolvePortCouplings(source.data.ports ?? [], target.data.ports ?? [], { sourceId: source.id, targetId: target.id, usedPortKeys: used })
        checkAndClaimCouplings(source.id, target.id, couplings, used)
        edge.data = { ...edge.data, couplings }
      }
      const expansion = expandHierarchy(nodes, edges)
      expect(expansion.nodes).toEqual(nodes)
      expect(expansion.edges).toEqual(edges)
      expect(expansion.errors.filter((error) => error.severity !== 'warning'), file).toEqual([])
    }
  }, 120000)
})

describe('a nested graph exports as the flat graph it stands for', () => {
  let store
  let make

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadBundledLibrary(store)
    make = moduleFactory(store)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  const exportOf = async ({ nodes, edges }, options = {}) =>
    (await generateFlattenedModel(nodes, edges, store, [], { check: false, ...options })).text()

  /** Expands the nested graph, which must expand cleanly, and compares its export with the flat graph's. */
  async function compareExports({ nested, flat }, options) {
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    expect(expansion.errors).toEqual([])
    expect(expansion.nodes.map((node) => node.data.name).sort()).toEqual(flat.nodes.map((node) => node.data.name).sort())
    expect(couplingsOf(expansion)).toEqual(couplingsOf(flat))
    expect(caListsOf(expansion)).toEqual(caListsOf(flat))
    return compareCanonical(await exportOf(expansion, options), await exportOf(flat, options), { nameByConnection: GENERATED })
  }

  it.each([
    ['venous fan-in summing through a subsystem', venousFanIn],
    ['Multiply read live through an exposed port', multiply],
    ['two levels, through via', twoLevel],
    ['one super-module three times, each with its own values', threeInstances],
    ['an exposed port beside an internal coupling to the same port label', exposureLeavesInternalCouplings],
  ])('%s', async (_, fixture) => {
    const result = await compareExports(fixture(make))
    expect(result.differences).toEqual([])
    expect(result.equal).toBe(true)
  })

  // Not exported: the bundled heart's math uses per_s only in <cn> units, which export doesn't import yet.
  it('heart slots pinned through a subsystem, by coupling and CA lists', () => {
    const { nested, flat } = heartSlots(make)
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    expect(expansion.errors).toEqual([])
    expect(couplingsOf(expansion)).toEqual(couplingsOf(flat))
    expect(couplingsOf(expansion).filter((edge) => edge.includes('> cardiac__heart'))).toEqual([
      expect.stringMatching(/^pvn > cardiac__heart: .* > entrance_ports:vessel_port:2\[v_pvn,u_la/),
      expect.stringMatching(/^venous_svc > cardiac__heart: .* > entrance_ports:vessel_port:1\[v_svc,u_ra/),
    ])
    expect(caListsOf(expansion)).toEqual(caListsOf(flat))
  })

  it('tells a differing flat graph apart', async () => {
    const fixture = threeInstances(make)
    fixture.flat.nodes[1].data.variables = fixture.flat.nodes[1].data.variables.map((row) => (row.name === 'R' ? { ...row, value: '9' } : row))
    const result = await compareExports(fixture)
    expect(result.equal).toBe(false)
    expect(result.differences.join('\n')).toMatch(/seg2__a_R/)
  })

  it('refuses boundary conditions fed only by each other through an interface, as flat', async () => {
    const { nested, flat } = bcOnlyThroughInterface(make)
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    expect(expansion.errors).toEqual([])
    const message = 'Boundary conditions connected only to each other, so nothing computes them: up__art.u_out, term.u_in.'
    await expect(exportOf(expansion)).rejects.toThrow(message)
    await expect(exportOf(flat)).rejects.toThrow(message)
    const result = compareCanonical(await exportOf(expansion, { allowBcOnly: true }), await exportOf(flat, { allowBcOnly: true }), {
      nameByConnection: GENERATED,
    })
    expect(result.differences).toEqual([])
  })

  // The expansion skipping exposure edges is covered by expand.test.js; this is the canvas side of it.
  it('leaves internal couplings as they are when a port is exposed', () => {
    const { nested } = exposureLeavesInternalCouplings(make)
    const scope = nested.nodes.filter((node) => node.data.scope === 'sm_1')
    const scopeEdges = nested.edges.filter((edge) => scope.some((node) => node.id === edge.source))
    const junction = scope.find((node) => node.data.name === 'j')
    const internal = scopeEdges.find((edge) => edge.id === 'e_int')
    expect(scopeEdges.map((edge) => edge.id)).toEqual(['sm_1~j--sm_1', 'e_int'])

    // Recomputing the junction's couplings over the scope's model edges keeps the internal edge on its first slot,
    // and never couples the exposure edge, which unfiltered would be resolved like a model edge.
    expect([...previewCouplings(junction.id, junction.data.ports, scope, scopeEdges).keys()]).toContain('sm_1~j--sm_1')
    const recomputed = previewCouplings(junction.id, junction.data.ports, scope, scopeEdges.filter(isModelEdge))
    expect([...recomputed.keys()]).toEqual(['e_int'])
    expect(recomputed.get('e_int')).toEqual(internal.data.couplings)
    expect(internal.data.couplings[0].targetSlot).toBe(0)
  })
})

describe('a nested graph simulates as the flat graph it stands for', () => {
  let store
  let libOpenCOR

  beforeAll(async () => {
    await ensureLibCellmlReady()
    // One libOpenCOR for the file: a second instance in the same page breaks the first.
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('three subsystems of one super-module, each with its own k', async () => {
    const { nested, flat } = hubBranches(store)
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    expect(expansion.errors).toEqual([])
    const exported = await (await generateFlattenedModel(expansion.nodes, expansion.edges, store)).text()
    const handFlat = await (await generateFlattenedModel(flat.nodes, flat.edges, store)).text()
    expect(compareCanonical(exported, handFlat, { nameByConnection: GENERATED }).differences).toEqual([])
    const result = await compareSimulations(exported, handFlat, { module: libOpenCOR, endTime: 2 })
    expect(result.details.missing).toEqual([])
    expect(result.equal).toBe(true)
    expect(result.maxError).toBe(0)
  })
})
