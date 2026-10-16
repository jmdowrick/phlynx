import JSZip from 'jszip'
import Papa from 'papaparse'

import { notify } from '../../utils/notify'
import { BASE_SUBTYPE_KEY, parseMathRef, parseModuleRef, restorePorts, restoreVariables } from '../../utils/config'
import { PORT_TYPE_OPTIONS } from '../../utils/constants'
import { normaliseMultiport, VOLUME_PORT } from '../../utils/multiport'
import { isBlank } from '../../utils/variables'
import { resolveBoundaryValues } from './boundaryValues'
import { checkHearts, warnDeprecatedJunctions } from '../caRules'
import { configSignature, variantSubtype } from '../caVariants'
import { resolveInstanceVariables } from '../import/buildWorkflow'
import { buildCaCellmlFiles, isHeart, listNamed } from './caCellml'
import { planCaPairing, RESIDUAL_REASONS } from './caPairing'

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

    // The rows and their out/inp lists in the order that has CA give each connection the port slots it holds here,
    // and each instance's ports as exported where no order does.
    const plan = planCaPairing(nodes, edges)
    const subtypeOf = subtypeChooser(libraryStore)
    const variants = []
    // The modules variants stand in for, and the instances each entry is written for.
    const variantBases = new Map()
    const usersOf = new Map()

    // --- 1. PROCESS NODES FOR CONFIG AND TOPOLOGY ---
    for (const node of plan.rows) {
      const inp_instances = plan.inpEdges.get(node.id).map((edge) => nodeNameMap.get(edge.source))
      const out_instances = plan.outEdges.get(node.id).map((edge) => nodeNameMap.get(edge.target))

      const { moduleType, moduleSubtype } = parseModuleRef(node.data.moduleRef)

      const moduleData = libraryStore.availableModules.get(node.data.moduleRef)
      if (!moduleData) {
        throw new Error(`Missing module definition '${node.data.moduleRef}' for node '${node.data.name}'`)
      }

      // Each instance's own config: one that differs from its library module's is a variant of its own (#689).
      const entry = moduleConfigEntry({ ...node.data, ports: plan.ports.get(node.id) })
      const subtype = subtypeOf(node.data.moduleRef, moduleData, entry)
      if (subtype !== moduleSubtype) {
        variants.push(node.data.name)
        variantBases.set(node.data.moduleRef, moduleData)
      }
      const ref = `${moduleType}:${subtype}`
      if (!uniqueModuleConfigs.has(ref)) {
        uniqueModuleConfigs.set(ref, subtype === moduleSubtype ? entry : asVariant(entry, subtype))
      }
      const written = uniqueModuleConfigs.get(ref)
      usersOf.set(written, [...(usersOf.get(written) ?? []), node.data.name])

      instance_array.push({
        name: node.data.name,
        module_subtype: subtype,
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

    addVariantBases(variantBases, uniqueModuleConfigs, libraryStore)
    checkHearts(instance_array)
    reportPlan(plan, nodeNameMap)
    noteVariants(variants)
    warnDeprecatedJunctions(instance_array.map((row) => row.module_type))
    warnMissingBoundaryValues(nodes, edges)
    addPulmonaryModule(instance_array, uniqueModuleConfigs, libraryStore)

    // Convert Map to array
    const module_config = Array.from(uniqueModuleConfigs.values());
    checkMultiports(module_config)

    // The config's CellML, edits included; may rename component files so CA finds them.
    const { files: cellmlFiles, missingUnits } = await buildCaCellmlFiles(fileName, module_config, libraryStore, {
      usersOf: (entry) => usersOf.get(entry) ?? [],
    })
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
 * Reports what the export can't make CA pair as here: fails where CA would stop, and warns about connections CA will
 * pair differently (naming CA's rule), couplings made before their ports changed, and edges without couplings that
 * are left out of the module array.
 *
 * @param {Object} plan - From planCaPairing.
 * @param {Map<string, string>} names - Each node id to its name.
 * @throws {Error} naming each connection CA would stop on.
 */
function reportPlan({ failures, residuals, stale, dropped, ports }, names) {
  const nameOf = (edge) => `${names.get(edge.source)} → ${names.get(edge.target)}`
  // A label as the workspace has it, which a relabelled port keeps in original.
  const labelOf = (edge, label) =>
    [edge.source, edge.target].flatMap((id) => ports.get(id) ?? []).find((port) => port.label === label)?.original?.label ?? label

  if (failures.length) {
    const messages = [...new Set(failures.map((failure) => describeFailure(failure, names, labelOf(failure.edge, failure.label))))]
    throw new Error(`CA would stop on ${messages.length === 1 ? 'a connection' : `${messages.length} connections`}. ${messages.join(' ')}`)
  }

  if (residuals.length) {
    const byReason = new Map()
    for (const { edge, label, reason } of residuals) {
      if (!byReason.has(reason)) byReason.set(reason, [])
      byReason.get(reason).push(`${nameOf(edge)} (${label})`)
    }
    const isOne = residuals.length === 1
    notify.warning({
      title: 'Connections Paired Differently',
      message: `CA will pair ${isOne ? 'a connection' : `${residuals.length} connections`} differently from here. ${[...byReason]
        .map(([reason, items]) => `${listNamed([...new Set(items)])}: ${RESIDUAL_REASONS[reason]}.`)
        .join(' ')}`,
    })
  }

  if (stale.length) {
    const changed = [...new Set(stale.filter(({ gone }) => !gone).map(({ edge }) => nameOf(edge)))]
    const gone = [...new Set(stale.filter(({ gone }) => gone).map(({ edge }) => nameOf(edge)))]
    const parts = [
      changed.length && `${listNamed(changed)} ${changed.length === 1 ? 'was' : 'were'} coupled before a port changed, so CA couples the ports as they are now`,
      gone.length && `${listNamed(gone)} ${gone.length === 1 ? 'couples a port' : 'couple ports'} that no longer exist${gone.length === 1 ? 's' : ''}, which CA leaves out`,
    ].filter(Boolean)
    notify.warning({
      title: 'Stale Connections',
      message: `${parts.join('; ')}. Reopen ${stale.length === 1 ? 'its' : 'their'} connection dialog to bring the couplings up to date.`,
    })
  }

  if (dropped.length) {
    const isOne = dropped.length === 1
    notify.info({
      title: 'Connections Left Out',
      message: `${listNamed(dropped.map(nameOf))} ${isOne ? 'couples' : 'couple'} no ports, so the module array leaves ${isOne ? 'it' : 'them'} out: CA would couple every port label the modules share.`,
    })
  }
}

/**
 * Describes where CA would stop.
 *
 * @param {{edge: Object, kind: string}} failure
 * @param {Map<string, string>} names
 * @param {string} label - The port label, as the workspace has it.
 * @returns {string}
 */
function describeFailure({ edge, kind }, names, label) {
  const [source, target] = [names.get(edge.source), names.get(edge.target)]
  switch (kind) {
    case 'noMatchingPort':
      return `"${source}" and "${target}" share no port label, which CA requires of a module with both exit and general ports.`
    case 'targetFull':
      return `"${target}" has no free "${label}" slot left for "${source}", and CA needs one wherever connected modules share a label.`
    case 'sourceFull':
      return `"${source}" has no free "${label}" slot left for "${target}".`
    case 'heartPin':
      return `"${target}" has no heart slot for "${source}" at its place in the heart's inputs.`
    case 'listCount':
      return `"${source}" and "${target}" sum or multiply through "${label}" ports with different numbers of variables.`
    default:
      return `"${source}"'s "${label}" port has more variables than "${target}"'s, which CA reads by the source's.`
  }
}

/**
 * Notes the instances exported as variants of their module.
 *
 * @param {string[]} names
 */
function noteVariants(names) {
  if (!names.length) return
  const isOne = names.length === 1
  notify.info({
    title: 'Module Variants',
    message: `${listNamed(names)} ${isOne ? 'differs' : 'differ'} from ${isOne ? 'its' : 'their'} library module, so ${isOne ? 'it is' : 'each is'} exported with a config of its own, its subtype followed by "__" and a hash of that config.`,
  })
}

/**
 * Makes the chooser of each instance's module_subtype: the module's own for the first config equal to the library
 * module's, else `<subtype>__<hash of its config>`.
 *
 * @param {Object} libraryStore
 * @returns {(moduleRef: string, module: Object, entry: Object) => string}
 */
function subtypeChooser(libraryStore) {
  const claimed = new Map()
  const known = new Map()
  // Each ref written so far to its config's signature, so a variant never takes a ref another config has.
  const written = new Map()
  return (moduleRef, module, entry) => {
    const { moduleType, moduleSubtype } = parseModuleRef(moduleRef)
    const signature = configSignature(entry)
    if (!known.has(moduleRef)) known.set(moduleRef, librarySignatures(module, libraryStore))
    if (!claimed.has(moduleRef) && known.get(moduleRef).has(signature)) claimed.set(moduleRef, signature)
    if (claimed.get(moduleRef) === signature) {
      written.set(moduleRef, signature)
      return moduleSubtype
    }

    const isFree = (subtype) => (written.get(`${moduleType}:${subtype}`) ?? signature) === signature
    let subtype = variantSubtype(moduleSubtype, signature)
    // Two configs of a module whose hashes share their last 8 characters: the later one keeps all 11.
    if (!isFree(subtype)) subtype = variantSubtype(moduleSubtype, signature, 11)
    written.set(`${moduleType}:${subtype}`, signature)
    return subtype
  }
}

/**
 * The signatures of a library module's config: as the library holds it, and as a new instance of it would hold it.
 *
 * @param {Object} module
 * @param {Object} libraryStore
 * @returns {Set<string>}
 */
function librarySignatures(module, libraryStore) {
  const analysis = libraryStore.getMathAnalysis?.(module.mathRef) ?? null
  const defaults = libraryStore.getMathDefaults?.(module.mathRef) ?? new Map()
  const rows = resolveInstanceVariables(module, analysis, defaults)
  return new Set([configSignature(moduleConfigEntry(module)), configSignature(moduleConfigEntry({ ...module, variables: rows }))])
}

/**
 * Adds the library's own entry for each module that only variants stand in for: no row names it, but the import
 * builds the library from it rather than from a variant. Left out where its math is missing or its component's name
 * is another file's.
 *
 * @param {Map<string, Object>} bases - Module ref to library module.
 * @param {Map<string, Object>} moduleConfigs - The config entries by ref, added to.
 * @param {Object} libraryStore
 */
function addVariantBases(bases, moduleConfigs, libraryStore) {
  for (const [moduleRef, module] of bases) {
    if (moduleConfigs.has(moduleRef) || !libraryStore.availableMath?.has(module.mathRef)) continue
    const entry = moduleConfigEntry(module)
    const clashes = [...moduleConfigs.values()].some(
      (other) => other.component_type === entry.component_type && other.component_file !== entry.component_file
    )
    if (!clashes) moduleConfigs.set(moduleRef, entry)
  }
}

/**
 * A config entry as a variant of its module: its own subtype, naming the one it stands in for.
 *
 * @param {Object} entry
 * @param {string} subtype
 * @returns {Object}
 */
function asVariant(entry, subtype) {
  const { module_type, module_subtype, ...rest } = entry
  return { module_type, module_subtype: subtype, [BASE_SUBTYPE_KEY]: module_subtype, ...rest }
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
    const description = `Module "${entry.module_type}:${entry[BASE_SUBTYPE_KEY] ?? entry.module_subtype}"`
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
        volumeSums.add(`${entry.module_type}:${entry[BASE_SUBTYPE_KEY] ?? entry.module_subtype}`)
      }
    }
  }
  const reasons = [...new Set(rejected)]
  if (reasons.length) throw new Error(`CA can't read ${reasons.length === 1 ? 'a port' : `${reasons.length} ports`}. ${reasons.join(' ')}`)
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
