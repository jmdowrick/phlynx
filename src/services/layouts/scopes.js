import { runFcoseLayout } from './cytoscape'

/**
 * Lays out each super-module's children and interface with fCoSE, as the root is laid out once drawn; they aren't
 * drawn until entered, so each is taken at a module's usual size.
 *
 * @param {Array} nodes - Changed in place: positions and opacity.
 * @param {Array} edges
 * @param {Object} [options]
 * @param {Set<string>} [options.keep] - The super-modules already placed, left as they are.
 */
export async function layoutSupermoduleScopes(nodes, edges, { keep = new Set() } = {}) {
  const scopes = new Map()
  for (const node of nodes) {
    const scope = node.data?.scope ?? null
    if (scope === null || keep.has(scope)) continue
    if (!scopes.has(scope)) scopes.set(scope, [])
    scopes.get(scope).push(node)
  }
  for (const members of scopes.values()) {
    const ids = new Set(members.map((node) => node.id))
    const sized = members.map((node) => ({ id: node.id, position: node.position, style: node.style, dimensions: {} }))
    await runFcoseLayout(sized, edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)))
    sized.forEach((copy, i) => Object.assign(members[i], { position: copy.position, style: copy.style }))
  }
}
