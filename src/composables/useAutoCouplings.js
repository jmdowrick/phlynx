import { useVueFlow } from '@vue-flow/core'
import { useBuilderStore } from '../stores/builderStore'
import { getId as getNextEdgeId } from '../utils/edges'
import { FLOW_IDS } from '../utils/constants'

export function useAutoCoupling() {
  const builderStore = useBuilderStore()
  const { nodes, edges, addEdges, removeEdges, updateNodeData } = useVueFlow(FLOW_IDS.MAIN)

  /**
   * Scans all moduleNode instances on the canvas for annotation-derived port labels
   * that match across different nodes (same label string, fromAnnotation: true),
   * then adds a suggested dashed edge for each unconnected matching pair.
   *
   * Suggested edges are ephemeral — they bypass the history store and are not
   * tracked for undo/redo. The first history-tracked event is the user accepting
   * or dismissing the suggestion.
   *
   * Should be called after:
   *  - a module node is dropped onto the canvas
   *  - annotations are loaded (loadTurtleData)
   */
  function resolveAutoCouplings() {
    const labelToNodes = new Map()

    for (const node of nodes.value) {
      if (node.type !== 'moduleNode') continue
      
      // Look up the __annotated__ config for this node's module in the store
      const annotatedConfig = builderStore.getConfigForVessel(
        node.data?.name,      
        '__annotated__'
      )
      if (!annotatedConfig) continue

      const portLabels = annotatedConfig.config.general_ports || []

      for (const portLabel of portLabels) {
        const label = portLabel.port_type 
        if (!label) continue
        if (!labelToNodes.has(label)) labelToNodes.set(label, [])
        labelToNodes.get(label).push({ nodeId: node.id, portLabel })
      }
    }

    // Index existing edges to avoid duplicates
    const existingEdgeKeys = new Set(edges.value.map((e) => `${e.source}::${e.target}`))

    // Index existing suggested edges by their suggestionKey so we don't re-add them
    const existingSuggestions = new Set(
      edges.value
        .filter((e) => e.data?.suggested)
        .map((e) => e.data.suggestionKey)
    )

    const edgesToAdd = []

    for (const [label, participants] of labelToNodes) {
      // Only act when 2+ different nodes share the same annotation label
      const uniqueNodeIds = [...new Set(participants.map((p) => p.nodeId))]
      if (uniqueNodeIds.length < 2) continue

      // Pair up all combinations of distinct nodes for this label
      for (let i = 0; i < uniqueNodeIds.length - 1; i++) {
        for (let j = i + 1; j < uniqueNodeIds.length; j++) {
          const sourceId = uniqueNodeIds[i]
          const targetId = uniqueNodeIds[j]

          // Skip if a real edge already exists in either direction
          if (
            existingEdgeKeys.has(`${sourceId}::${targetId}`) ||
            existingEdgeKeys.has(`${targetId}::${sourceId}`)
          ) continue

          // Skip if a suggested edge for this pair already exists
          const suggestionKey = [sourceId, targetId].sort().join('::') + `::${label}`
          if (existingSuggestions.has(suggestionKey)) continue

          // Skip if this pair has been dismissed by the user on either node
          const sourceNode = nodes.value.find((n) => n.id === sourceId)
          const targetNode = nodes.value.find((n) => n.id === targetId)
          const dismissed  = sourceNode?.data?.dismissedSuggestions || []
          if (dismissed.includes(suggestionKey)) continue

          const edgeId = getNextEdgeId(edges.value.map((e) => e.id))
          edgesToAdd.push({
            id:     edgeId,
            source: sourceId,
            target: targetId,
            type:   'suggestedEdge',
            data: {
              suggested:     true,
              suggestionKey,
              couplingLabel: label,
            },
          })
          existingSuggestions.add(suggestionKey)
        }
      }
    }

    if (edgesToAdd.length) addEdges(edgesToAdd)
  }

  /**
   * Accepts a suggested edge: removes the suggested edge and adds a normal one
   * in its place, going through addEdges so it participates in the flow state.
   * The caller (SuggestedEdge.vue) should wrap this in a history command.
   */
  function acceptSuggestion(suggestedEdge) {
    removeEdges([suggestedEdge.id])
    const { id, data, ...rest } = suggestedEdge
    const newEdgeId = getNextEdgeId(edges.value.map((e) => e.id))
    addEdges([{
      ...rest,
      id:   newEdgeId,
      type: undefined, // revert to default edge type
      data: {
        acceptedFromAnnotation: true,
        couplingLabel:          data.couplingLabel,
      },
    }])
  }

  /**
   * Dismisses a suggested edge: removes it and records the suggestionKey on the
   * source node so resolveAutoCouplings does not re-suggest it.
   */
  function dismissSuggestion(suggestedEdge) {
    const { suggestionKey } = suggestedEdge.data
    removeEdges([suggestedEdge.id])

    const sourceNode = nodes.value.find((n) => n.id === suggestedEdge.source)
    if (sourceNode) {
      const existing = sourceNode.data?.dismissedSuggestions || []
      updateNodeData(sourceNode.id, {
        dismissedSuggestions: [...existing, suggestionKey],
      })
    }
  }

  return { resolveAutoCouplings, acceptSuggestion, dismissSuggestion }
}