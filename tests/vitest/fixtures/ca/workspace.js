/**
 * Small workspaces for the CA export's pairing tests: ports, nodes and edges whose couplings name port slots as the
 * edge connection dialog records them.
 */
import Papa from 'papaparse'

import { normaliseConfig } from '../../../../src/utils/config.js'
import { slotOf } from '../../../../src/utils/edges.js'
import { couplingPairs } from '../../../../src/services/export/caOrder.js'
import { comparePairs, simulateCaPairing, simulateImportPairing } from '../../../../src/services/export/caSimulate.js'

export const BG_MATH_REF = 'BG_modules.cellml:vp_simple_type'

/** A port. */
export const port = (portType, label, variables = ['x'], multiportType = 'None') => ({ portType, label, variables, multiportType })

/** A node named as its id, on a module ref. */
export const node = (id, ports, moduleRef = 'vessel:vp') => ({
  id,
  data: { name: id, moduleRef, mathRef: BG_MATH_REF, ports, variables: [] },
})

/**
 * An edge coupling the given ports, each pair `[source port index, target port index]`, with the slots the dialog
 * records.
 *
 * @param {Object} source
 * @param {Object} target
 * @param {Array<[number, number]>} pairs
 * @param {string} [id]
 * @returns {Object}
 */
export function connect(source, target, pairs, id = `${source.id}--${target.id}`) {
  const couplings = pairs.map(([s, t]) => {
    const [sourcePort, targetPort] = [source.data.ports[s], target.data.ports[t]]
    return { sourcePort, targetPort, sourceSlot: slotOf(source.data.ports, sourcePort), targetSlot: slotOf(target.data.ports, targetPort) }
  })
  return { id, source: source.id, target: target.id, data: { couplings } }
}

/**
 * Lists what CA and the import still pair otherwise than the workspace, with a plan's order and ports.
 *
 * @param {Object} plan - From planCaPairing.
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {{ ca: Array<string>, imported: Array<string>, failures: Array<string> }} Each as `source>target:indices`.
 */
export function differences(plan, nodes, edges) {
  const portsOf = (id) => plan.ports.get(id)
  const kept = edges.filter((edge) => !plan.dropped.includes(edge))
  const { pairs } = couplingPairs(nodes, kept)
  const ca = simulateCaPairing({ ...plan, portsOf })
  const imported = simulateImportPairing({ ...plan, portsOf })
  const describe = ({ edge, source, target }) => `${edge.source}>${edge.target}:${source}>${target}`
  const caDiff = comparePairs(pairs, ca.pairs, { ruled: ca.ruled, portsOf })
  const importDiff = comparePairs(pairs, imported.pairs, { portsOf })
  return {
    ca: [...caDiff.missing.map((p) => `-${describe(p)}`), ...caDiff.spurious.map((p) => `+${describe(p)}`)],
    imported: [...importDiff.missing.map((p) => `-${describe(p)}`), ...importDiff.spurious.map((p) => `+${describe(p)}`), ...imported.errors.map(describe)],
    failures: ca.errors.filter((error) => error.kind !== 'misaligned').map((error) => `${error.kind}:${error.edge.id}`),
  }
}

/**
 * Lists the ports a plan changed, as `node#index: field=value`.
 *
 * @param {Object} plan
 * @returns {Array<string>}
 */
export function changedPorts(plan) {
  return [...plan.ports].flatMap(([id, ports]) =>
    ports.flatMap((p, index) => (p.original ? [`${id}#${index}: ${p.portType}/${p.label} was ${JSON.stringify(p.original)}`] : []))
  )
}

/**
 * Reads an exported module array and config back as the simulators read a module array.
 *
 * @param {string} arrayCsv - The module array.
 * @param {Array} config - The module config's entries.
 * @returns {{ rows: Array, outEdges: Map<string, Array>, inpEdges: Map<string, Array>, portsOf: Function,
 *   byId: Map<string, Object> }} rows: a node per row, its id its name, its ports its config entry's.
 */
export function arrayFromExport(arrayCsv, config) {
  const entries = new Map(config.map((entry) => [`${entry.module_type}:${entry.module_subtype}`, entry]))
  const lines = Papa.parse(arrayCsv, { header: true, skipEmptyLines: true }).data
  const rows = lines.map((line) => {
    const entry = entries.get(`${line.module_type}:${line.module_subtype}`)
    const data = { name: line.name, moduleRef: `${line.module_type}:${line.module_subtype}`, mathRef: `${entry.component_file}:${entry.component_type}` }
    return { id: line.name, data: { ...data, ports: normaliseConfig(entry).ports } }
  })
  const names = (value) => (value ?? '').split(' ').filter(Boolean)
  const edges = lines.flatMap((line) => names(line.out_instances).map((target) => ({ id: `${line.name}>${target}`, source: line.name, target })))
  const byId = new Map(rows.map((node) => [node.id, node]))
  return {
    rows,
    outEdges: new Map(rows.map((node) => [node.id, edges.filter((edge) => edge.source === node.id)])),
    inpEdges: new Map(lines.map((line) => [line.name, names(line.inp_instances).map((source) => edges.find((edge) => edge.source === source && edge.target === line.name))])),
    portsOf: (id) => byId.get(id).data.ports,
    byId,
  }
}
