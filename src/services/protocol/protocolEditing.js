/**
 * Edits an obs_data document's protocol. Each edit gives a new document, keeping everything it doesn't touch, and
 * renumbers the observations that refer to experiments and sub-experiments by their place, so none points at the
 * wrong one after a change.
 */
import { isMapping } from './protocolShapes.js'

// The lists in protocol_info with one entry per experiment.
const PER_EXPERIMENT = ['pre_times', 'sim_times', 'experiment_labels', 'experiment_colors', 'experiment_ids']
// Matplotlib's colours, as CA's experiment_colors name them, for experiments added after them.
const COLOURS = ['r', 'b', 'g', 'm', 'c', 'y', 'k']

/**
 * Copies a document as JSON, so edits never reach the one given.
 *
 * @param {*} document
 * @returns {*}
 */
const copy = (document) => JSON.parse(JSON.stringify(document))

/**
 * Gives a document with a protocol to edit: an empty one of a single experiment when it has none. A bare list of
 * data items becomes the document's data_items.
 *
 * @param {Object|Array|null} document
 * @returns {Object}
 */
export function ensureProtocol(document) {
  const edited = Array.isArray(document) ? { data_items: copy(document) } : copy(document ?? {})
  if (!isMapping(edited.protocol_info)) edited.protocol_info = { pre_times: [0], sim_times: [[1]], params_to_change: {} }
  if (!isMapping(edited.protocol_info.params_to_change)) edited.protocol_info.params_to_change = {}
  return edited
}

/**
 * Applies an edit to a copy of a document's protocol, then drops the shapes nothing uses any more, which CA refuses
 * unless they say how long they last.
 *
 * @param {Object} document
 * @param {Function} edit - Called with the copy, to change in place.
 * @returns {Object}
 */
function editDocument(document, edit) {
  const edited = ensureProtocol(document)
  edit(edited)
  const info = edited.protocol_info
  if (isMapping(info.protocol_shapes)) {
    const used = new Set(Object.values(info.params_to_change).flatMap((rows) => rows.flat().filter((leaf) => typeof leaf === 'string')))
    for (const [name, shape] of Object.entries(info.protocol_shapes)) {
      if (!used.has(name) && !(isMapping(shape) && 'duration' in shape)) delete info.protocol_shapes[name]
    }
  }
  return edited
}

/**
 * Renumbers the observations after an experiment's place changes, dropping those of a removed one. An observation
 * without an index is in experiment 0, as CA reads it.
 *
 * @param {Object} document
 * @param {Function} renumber - Gives an experiment's new index, or null when it is gone.
 */
function renumberExperiments(document, renumber) {
  for (const key of ['data_items', 'prediction_items']) {
    if (!Array.isArray(document[key])) continue
    document[key] = document[key].flatMap((item) => {
      const next = renumber(item.experiment_idx ?? 0)
      if (next == null) return []
      return next === (item.experiment_idx ?? 0) ? [item] : [{ ...item, experiment_idx: next }]
    })
  }
}

/**
 * Lists the observations that refer to an experiment, or to one of its sub-experiments.
 *
 * @param {Object|Array} document
 * @param {number} experiment
 * @param {number} [sub] - Leave out for the whole experiment. Prediction items refer to no sub-experiment.
 * @returns {string[]} Their names.
 */
export function findObservationsAt(document, experiment, sub = null) {
  const items = Array.isArray(document) ? document.map((item) => ['data_items', item]) : ['data_items', 'prediction_items'].flatMap((key) => (document?.[key] ?? []).map((item) => [key, item]))
  return items
    .filter(([key, item]) => (item.experiment_idx ?? 0) === experiment && (sub == null || (key === 'data_items' && (item.subexperiment_idx ?? 0) === sub)))
    .map(([, item]) => item.data_item_name ?? '(unnamed)')
}

/**
 * Adds an experiment after the others, a copy of one of them.
 *
 * @param {Object} document
 * @param {number} from - The experiment to copy.
 * @returns {Object}
 */
export function addExperiment(document, from) {
  return editDocument(document, ({ protocol_info: info }) => {
    const count = info.sim_times.length
    for (const key of PER_EXPERIMENT) {
      if (!Array.isArray(info[key])) continue
      if (key === 'experiment_labels') info[key].push(`${info[key][from] ?? 'experiment'} (copy)`)
      else if (key === 'experiment_colors') info[key].push(COLOURS[count % COLOURS.length])
      else if (key === 'experiment_ids') info[key].push(null)
      else info[key].push(copy(info[key][from]))
    }
    for (const rows of Object.values(info.params_to_change)) rows.push(copy(rows[from]))
  })
}

/**
 * Removes an experiment, and the observations of it.
 *
 * @param {Object} document
 * @param {number} experiment
 * @returns {Object}
 */
export function removeExperiment(document, experiment) {
  return editDocument(document, (edited) => {
    const info = edited.protocol_info
    for (const key of PER_EXPERIMENT) if (Array.isArray(info[key])) info[key].splice(experiment, 1)
    for (const rows of Object.values(info.params_to_change)) rows.splice(experiment, 1)
    renumberExperiments(edited, (index) => (index === experiment ? null : index > experiment ? index - 1 : index))
  })
}

/**
 * Moves an experiment to another place, its observations with it.
 *
 * @param {Object} document
 * @param {number} from
 * @param {number} to
 * @returns {Object}
 */
export function moveExperiment(document, from, to) {
  return editDocument(document, (edited) => {
    const info = edited.protocol_info
    const move = (list) => list.splice(to, 0, ...list.splice(from, 1))
    for (const key of PER_EXPERIMENT) if (Array.isArray(info[key])) move(info[key])
    for (const rows of Object.values(info.params_to_change)) move(rows)
    const order = info.sim_times.map((_, index) => index)
    move(order)
    renumberExperiments(edited, (index) => order.indexOf(index))
  })
}

/**
 * Adds a sub-experiment at the end of an experiment, each parameter holding its last value.
 *
 * @param {Object} document
 * @param {number} experiment
 * @returns {Object}
 */
export function addSubExperiment(document, experiment) {
  return editDocument(document, ({ protocol_info: info }) => {
    info.sim_times[experiment].push(info.sim_times[experiment].at(-1))
    for (const rows of Object.values(info.params_to_change)) {
      const last = rows[experiment].at(-1)
      // A shape belongs to its sub-experiment, so the new one holds a number instead.
      rows[experiment].push(typeof last === 'number' ? last : 0)
    }
  })
}

/**
 * Removes a sub-experiment, and the observations of it; the experiment keeps at least one.
 *
 * @param {Object} document
 * @param {number} experiment
 * @param {number} sub
 * @returns {Object}
 */
export function removeSubExperiment(document, experiment, sub) {
  return editDocument(document, (edited) => {
    const info = edited.protocol_info
    if (info.sim_times[experiment].length < 2) return
    info.sim_times[experiment].splice(sub, 1)
    for (const rows of Object.values(info.params_to_change)) rows[experiment].splice(sub, 1)
    if (!Array.isArray(edited.data_items)) return
    edited.data_items = edited.data_items.flatMap((item) => {
      if ((item.experiment_idx ?? 0) !== experiment) return [item]
      const index = item.subexperiment_idx ?? 0
      if (index === sub) return []
      return index > sub ? [{ ...item, subexperiment_idx: index - 1 }] : [item]
    })
  })
}

/**
 * Sets an experiment's warm-up, a sub-experiment's length, or an experiment's label.
 *
 * @param {Object} document
 * @param {{experiment: number, sub?: number, preTime?: number, duration?: number, label?: string}} change
 * @returns {Object}
 */
export function setTiming(document, { experiment, sub, preTime, duration, label }) {
  return editDocument(document, ({ protocol_info: info }) => {
    if (preTime !== undefined) info.pre_times[experiment] = preTime
    if (duration !== undefined) info.sim_times[experiment][sub] = duration
    if (label !== undefined) {
      if (!Array.isArray(info.experiment_labels)) info.experiment_labels = info.sim_times.map((_, index) => `exp_${index}`)
      info.experiment_labels[experiment] = label
    }
  })
}

/**
 * Adds a parameter the protocol sets, at one value throughout.
 *
 * @param {Object} document
 * @param {string} parameter - As CA names it, `instance/variable`.
 * @param {number} value
 * @returns {Object}
 */
export function addParameter(document, parameter, value) {
  return editDocument(document, ({ protocol_info: info }) => {
    if (!Object.hasOwn(info.params_to_change, parameter)) info.params_to_change[parameter] = info.sim_times.map((subs) => subs.map(() => value))
  })
}

/**
 * Stops the protocol setting a parameter.
 *
 * @param {Object} document
 * @param {string} parameter
 * @returns {Object}
 */
export function removeParameter(document, parameter) {
  return editDocument(document, ({ protocol_info: info }) => {
    delete info.params_to_change[parameter]
  })
}

/**
 * Sets a parameter's value in a sub-experiment: a number, or the name of a trace or shape.
 *
 * @param {Object} document
 * @param {{parameter: string, experiment: number, sub: number, value: number|string}} change
 * @returns {Object}
 */
export function setValue(document, { parameter, experiment, sub, value }) {
  return editDocument(document, ({ protocol_info: info }) => {
    info.params_to_change[parameter][experiment][sub] = value
  })
}
