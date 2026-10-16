import JSZip from 'jszip'
import Papa from 'papaparse'

import { notify } from '../../utils/notify'
import { parseMathRef, parseModuleRef, restorePorts, restoreVariables } from '../../utils/config'
import { PORT_TYPE_OPTIONS } from '../../utils/constants'
import { normaliseMultiport, VOLUME_PORT } from '../../utils/multiport'
import { isBlank } from '../../utils/variables'
import { resolveBoundaryValues } from './boundaryValues'
import { checkHearts, warnDeprecatedJunctions } from '../caRules'
import { buildCaCellmlFiles, isHeart, listNamed } from './caCellml'
import { orderForCa } from './caOrder'

// CA's placeholder for a value still to be given; it reads an empty cell as NaN.
const EMPTY_VALUE = 'EMPTY_MUST_BE_FILLED'
// The folder for CA's external_modules_dir, which reads every JSON file in it as a module config, so obs_data stays out.
const MODULES_DIR = 'modules'
// The module CA adds as a pulmonary artery and vein ('par', 'pvn') when the heart has one output.
const PULMONARY_MODULE_REF = 'arterial_simple:vp'

/**
 * Generates a zip blob for the Circulatory Autogen export.
 * @param {string} fileName - The name for the exported files.
 * @param {Array} nodes - The array of nodes from Vue Flow.
 * @param {Array} edges - The array of edges from Vue Flow.
 * @param {Object} libraryStore - The Pinia builder store.
 * @param {ArrayBuffer|string|null} [obsData] - The workspace's obs_data.json, with its protocol, written as
 *   `<fileName>_obs_data.json` beside the config, as CA names it.
 * @returns {Promise<Blob>} A promise that resolves with the zip file blob.
 */
export async function generateExportZip(fileName, nodes, edges, libraryStore, obsData = null) {
  try {
    const zip = new JSZip()

    // Create a map for quick lookup of node names
    const nodeNameMap = new Map()
    for (const node of nodes) {
      nodeNameMap.set(node.id, node.data.name)
    }

    const uniqueModuleConfigs = new Map()
    const instance_array = []
    const allParameters = new Set()

    // Rows and their out/inp lists in the order that has CA give each connection the port slots it holds here.
    const { rows, outEdges, inpEdges, unmatched, hearts } = orderForCa(nodes, edges)
    warnUnmatchedSlots(unmatched, nodeNameMap, hearts)

    // --- 1. PROCESS NODES FOR CONFIG AND TOPOLOGY ---
    for (const node of rows) {
      const inp_instances = inpEdges.get(node.id).map((edge) => nodeNameMap.get(edge.source))
      const out_instances = outEdges.get(node.id).map((edge) => nodeNameMap.get(edge.target))

      const { moduleType, moduleSubtype } = parseModuleRef(node.data.moduleRef)

      const moduleData = libraryStore.availableModules.get(node.data.moduleRef)
      if (!moduleData) {
        throw new Error(`Missing module definition '${node.data.moduleRef}' for node '${node.data.name}'`)
      }

      if (!uniqueModuleConfigs.has(node.data.moduleRef)) {
        uniqueModuleConfigs.set(node.data.moduleRef, moduleConfigEntry(node.data))
      }

      instance_array.push({
        name: node.data.name,
        module_subtype: moduleSubtype,
        module_type: moduleType,
        inp_instances: inp_instances.join(' '),
        out_instances: out_instances.join(' '),
      })

      // Collect parameters for this node's module. CA needs a row for every boundary condition, and uses it only
      // while nothing is connected to it.
      for (const variable of node.data.variables || []) {
        if (variable.type === 'constant') {
          allParameters.add(JSON.stringify({
            variable_name: `${variable.name}_${node.data.name}`,
            units: variable.units || '',
            value: isBlank(variable.value) ? '' : variable.value,
            data_reference: variable.data_reference || 'phlynx',
          }))
        } else if (variable.type === 'boundary_condition') {
          allParameters.add(JSON.stringify({
            variable_name: `${variable.name}_${node.data.name}`,
            units: variable.units || '',
            value: isBlank(variable.value) ? EMPTY_VALUE : variable.value,
            data_reference: variable.data_reference || 'phlynx',
          }))
        }
      }
    }

    checkHearts(instance_array)
    warnDeprecatedJunctions(instance_array.map((row) => row.module_type))
    warnMissingBoundaryValues(nodes, edges)
    addPulmonaryModule(instance_array, uniqueModuleConfigs, libraryStore)

    // Convert Map to array
    const module_config = Array.from(uniqueModuleConfigs.values());
    checkMultiports(module_config)

    // The config's CellML, edits included; may rename component files so CA finds them.
    const { files: cellmlFiles, missingUnits } = await buildCaCellmlFiles(fileName, module_config, libraryStore)
    if (missingUnits.length) {
      notify.warning({
        title: 'Missing Units',
        message: `No library units file defines ${listNamed(missingUnits)}, so the exported units file leaves ${missingUnits.length === 1 ? 'it' : 'them'} out.`,
      })
    }

    // --- 2. CONSOLIDATE PARAMETER FILES INTO ONE CSV ---
    const globalConstants = libraryStore.globalVariables

    for (const variable of globalConstants) {
      allParameters.add(JSON.stringify({
        variable_name: variable[0],
        units: variable[1].units || '',
        value: isBlank(variable[1].value) ? '' : variable[1].value,
        data_reference: 'phlynx',
      }))
    }

    const consolidatedParameters = Array.from(allParameters).map((paramStr) => JSON.parse(paramStr))

    // --- 3. FINALIZING AND COMPRESSING ZIP ---
    zip.file(`${MODULES_DIR}/${fileName}_module_config.json`, JSON.stringify(module_config, null, 2))
    zip.file(`${fileName}_module_array.csv`, Papa.unparse(instance_array))
    zip.file(`${fileName}_parameters.csv`, Papa.unparse(consolidatedParameters))
    if (obsData != null) zip.file(`${fileName}_obs_data.json`, obsData)
    for (const [name, text] of cellmlFiles) zip.file(`${MODULES_DIR}/${name}`, text)

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })

    return zipBlob
  } catch (error) {
    console.error('Export Error:', error)
    notify.error({ message: `Failed to export config files: ${error.message}` })
    throw error
  }
}

/**
 * Warns about connections CA couples to other port slots than they hold here, as no module order reproduces them: a
 * pairing made by hand, a connection left on a later slot when the one on an earlier slot was deleted, or heart
 * inputs on slots CA doesn't give them.
 *
 * @param {Array} unmatched - The edges, from orderForCa.
 * @param {Map<string, string>} nodeNames - Each node id to its name.
 * @param {Set<string>} hearts - The heart nodes' ids, from orderForCa.
 */
function warnUnmatchedSlots(unmatched, nodeNames, hearts) {
  if (!unmatched.length) return
  const names = unmatched.map((edge) => `${nodeNames.get(edge.source)} → ${nodeNames.get(edge.target)}`)
  const isOne = unmatched.length === 1
  const heartNote = unmatched.some((edge) => hearts.has(edge.target))
    ? ' CA gives a heart\'s inputs its ivc, svc and pulmonary slots in order, two inputs being svc and pulmonary.'
    : ''
  notify.warning({
    title: 'Connections Paired Differently',
    message: `CA gives each connection the first free slot of a repeated port, and no module order gives ${listNamed(names)} the port slots ${isOne ? 'it holds' : 'they hold'} here, so CA will couple ${isOne ? 'it' : 'them'} differently. This follows a pairing made by hand, or deleting a connection on an earlier slot; redrawing ${isOne ? 'it' : 'them'} takes the first free slot.${heartNote}`,
  })
}

/**
 * Warns about boundary conditions that nothing is connected to and that have no value, which CA leaves to be filled.
 *
 * @param {Array} nodes - The array of nodes from Vue Flow.
 * @param {Array} edges - The array of edges from Vue Flow.
 */
function warnMissingBoundaryValues(nodes, edges) {
  const nodeNames = new Map(nodes.map((node) => [node.id, node.data.name]))
  const missing = [...resolveBoundaryValues(nodes, edges).missing].flatMap(([nodeId, names]) =>
    [...names].map((name) => `${nodeNames.get(nodeId)}.${name}`)
  )
  if (!missing.length) return

  const count = missing.length === 1 ? '1 boundary condition has' : `${missing.length} boundary conditions have`
  notify.warning({
    title: 'Missing Boundary Values',
    message: `${count} no value and nothing connected, so CA will ask for ${missing.length === 1 ? 'it' : 'them'}: ${listNamed(missing)}.`,
  })
}

/**
 * Fails on a multi_port CA would reject, such as a Multiply on a port with several variables, which PhLynx's
 * own CellML allows; warns about a volume_port's whole-port Sum, which CA sums over the inp_vessels only.
 *
 * @param {Object[]} moduleConfig - The config entries.
 * @throws {Error} naming each port CA would reject.
 */
function checkMultiports(moduleConfig) {
  const rejected = []
  const volumeSums = new Set()
  for (const entry of moduleConfig) {
    const description = `Module "${entry.module_type}:${entry.module_subtype}"`
    for (const port of PORT_TYPE_OPTIONS.flatMap(({ value }) => entry[value] ?? [])) {
      const value = port.multi_port
      const multiplies = Array.isArray(value) && value.some((type) => typeof type === 'string' && type.toLowerCase() === 'multiply')
      if (multiplies && port.variables.length > 1) {
        rejected.push(`${description}: port "${port.port_type}" multiplies variables ${JSON.stringify(port.variables)}; CA multiplies only a port with one variable.`)
        continue
      }
      try {
        normaliseMultiport(port, description)
      } catch (error) {
        rejected.push(error.message)
      }
      if (port.port_type === VOLUME_PORT && typeof value === 'string' && value.toLowerCase() === 'sum') {
        volumeSums.add(`${entry.module_type}:${entry.module_subtype}`)
      }
    }
  }
  if (rejected.length) throw new Error(`CA can't read ${rejected.length === 1 ? 'a port' : `${rejected.length} ports`}. ${rejected.join(' ')}`)
  if (volumeSums.size) {
    notify.warning({
      title: 'Volume Port Sum',
      message: `CA sums a volume_port's whole-port Sum over its inp_vessels only, the legacy blood-volume sum, where PhLynx sums every connection: ${listNamed([...volumeSums])}.`,
    })
  }
}

/**
 * Makes a module's CA config entry.
 *
 * @param {{moduleRef: string, mathRef: string, ports: Array, variables: Array}} module - A node's data or a library module.
 * @returns {Object}
 */
function moduleConfigEntry(module) {
  const portsByType = restorePorts(module.ports)
  const { componentFile, componentName } = parseMathRef(module.mathRef)
  const { moduleType, moduleSubtype } = parseModuleRef(module.moduleRef)
  return {
    module_type: moduleType,
    module_subtype: moduleSubtype,
    module_format: 'cellml', // TODO - will need to generalise
    component_file: componentFile,
    component_type: componentName,
    entrance_ports: portsByType.entrance_ports || [],
    exit_ports: portsByType.exit_ports || [],
    general_ports: portsByType.general_ports || [],
    variables_and_units: restoreVariables(module.variables),
  }
}

/**
 * Adds the module CA uses for the pulmonary artery and vein it adds when the only heart has one output, and warns that
 * CA will ask for their values.
 *
 * @param {Array} instanceArray - The module array rows.
 * @param {Map<string, Object>} moduleConfigs - The config entries by module ref, added to.
 * @param {Object} libraryStore - The library, for `availableModules`.
 */
function addPulmonaryModule(instanceArray, moduleConfigs, libraryStore) {
  const hearts = instanceArray.filter((row) => isHeart(row.module_type))
  if (hearts.length !== 1 || hearts[0].out_instances.split(' ').filter(Boolean).length >= 2) return

  const module = libraryStore.availableModules.get(PULMONARY_MODULE_REF)
  if (module && !moduleConfigs.has(PULMONARY_MODULE_REF)) moduleConfigs.set(PULMONARY_MODULE_REF, moduleConfigEntry(module))
  notify.warning({
    title: 'Pulmonary Circuit Added',
    message: `"${hearts[0].name}" has one output, so CA adds a pulmonary artery and vein (par, pvn) and will ask for their values.`,
  })
}
