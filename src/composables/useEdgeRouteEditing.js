import { useVueFlow } from '@vue-flow/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useFlowHistoryStore } from '../stores/historyStore'
import {
  editableRoute,
  getEdgeWaypoints,
  moveSegment,
  routeWaypoints,
  segmentAxis,
  snapCoordinate,
  withEdgeWaypoints,
} from '../utils/edgeRoute'

/** Screen pixels within which a dragged segment lines up with a handle or another bend. */
const SNAP_PIXELS = 6

/** Shortest segment, in flow units, that gets a drag handle. */
const MIN_HANDLE_SEGMENT = 12

const sameWaypoints = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Sets an edge's waypoints as one undo step. The edge is found by id on undo and redo, so the step
 * still applies after the edge is re-created.
 *
 * @param {Object} options
 * @param {Function} options.findEdge
 * @param {Object} options.history - The flow history store.
 * @param {string} edgeId
 * @param {Array<{x: number, y: number}>|undefined} waypoints - None goes back to smoothstep.
 * @returns {boolean} Whether anything changed.
 */
export function setEdgeRoute({ findEdge, history }, edgeId, waypoints) {
  const edge = findEdge(edgeId)
  if (!edge) return false
  const before = getEdgeWaypoints(edge)
  const after = waypoints?.length ? waypoints : undefined
  if (sameWaypoints(before, after)) return false

  const apply = (value) => {
    const target = findEdge(edgeId)
    if (target) target.data = withEdgeWaypoints(target.data, value)
  }
  apply(after)
  history.addCommand({ type: 'edge-route', undo: () => apply(before), redo: () => apply(after) })
  return true
}

/**
 * Lets the user reshape a selected coupling edge by dragging its segments, draw.io style.
 *
 * @param {Object} props - The edge component's props.
 * @returns {{ route: ComputedRef, handles: ComputedRef, isEditing: ComputedRef, startDrag: Function }}
 *   route is the polyline to draw while dragging (else null); handles are the segment midpoints.
 */
export function useEdgeRouteEditing(props) {
  const { findEdge, getSelectedEdges, screenToFlowCoordinate, viewport } = useVueFlow()
  const history = useFlowHistoryStore()

  const draft = ref(null)
  let drag = null

  const isEditing = computed(() => props.selected && getSelectedEdges.value.length === 1)

  // The segments between the two stubs, each with its midpoint and the way it moves.
  const handles = computed(() => {
    if (!isEditing.value) return []
    const route = draft.value ?? editableRoute(props)
    const result = []
    for (let i = 1; i <= route.length - 3; i++) {
      const a = route[i]
      const b = route[i + 1]
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < MIN_HANDLE_SEGMENT) continue
      result.push({ index: i, axis: segmentAxis(route, i), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
    return result
  })

  const toFlow = (event) => screenToFlowCoordinate({ x: event.clientX, y: event.clientY })

  function onMove(event) {
    if (!drag) return
    const point = toFlow(event)
    const { route, index, axis, start, origin } = drag
    const raw = origin + point[axis] - start[axis]
    // Line up with either handle or another bend; Alt places freely.
    const targets = route.filter((_, j) => j !== index && j !== index + 1).map((p) => p[axis])
    const value = event.altKey ? raw : snapCoordinate(raw, targets, SNAP_PIXELS / viewport.value.zoom)
    draft.value = moveSegment(route, index, value)
  }

  function finish(commit) {
    if (!drag) return
    const { element, pointerId } = drag
    element.removeEventListener('pointermove', onMove)
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
    window.removeEventListener('keydown', onKeyDown, true)
    if (commit && draft.value) setEdgeRoute({ findEdge, history }, props.id, routeWaypoints(draft.value))
    drag = null
    draft.value = null
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    finish(false)
  }

  /**
   * Starts dragging a segment handle.
   *
   * @param {PointerEvent} event
   * @param {{index: number, axis: 'x'|'y'}} handle
   */
  function startDrag(event, handle) {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const route = editableRoute(props)
    const element = event.currentTarget
    element.setPointerCapture?.(event.pointerId)
    drag = {
      route,
      index: handle.index,
      axis: handle.axis,
      start: toFlow(event),
      origin: route[handle.index][handle.axis],
      element,
      pointerId: event.pointerId,
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', () => finish(true), { once: true })
    element.addEventListener('pointercancel', () => finish(false), { once: true })
    window.addEventListener('keydown', onKeyDown, true)
  }

  onBeforeUnmount(() => finish(false))

  return { route: computed(() => draft.value), handles, isEditing, startDrag }
}
