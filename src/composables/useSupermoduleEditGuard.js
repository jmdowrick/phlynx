/**
 * Asks before the first structural edit made inside a super instance whose super-module is shared or came from the
 * library: change the super-module for all its super instances, make this one a new super-module, or cancel. The
 * answer holds until the canvas leaves that super instance. It gates the workspace's history (see historyStore
 * setGate), so every structural edit recorded passes it, whatever made it: an edit names the scopes whose structure it
 * changes as its `scopes` (nodes or super instances added or removed, edges or couplings changed, ports exposed).
 * Value edits name none, and a super-module edited from the library never asks.
 *
 * It also tracks which super-modules a structural edit changed this session, as the library shows.
 */
import { effectScope, ref, shallowRef, watch } from 'vue'

import { useCanvasLevel } from './useCanvasLevel'
import { useHierarchyOperations } from './useHierarchyOperations'
import { useSupermodules } from './useSupermodules'
import { FLOW_IDS } from '../utils/constants'

// Each flow's guard, shared by every caller.
const guards = new Map()

/**
 * Gives a flow's edit guard.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {ReturnType<typeof createGuard>}
 */
export function useSupermoduleEditGuard(flowId = FLOW_IDS.MAIN) {
  // Outside any component, so no component's unmounting stops it for the others.
  if (!guards.has(flowId)) guards.set(flowId, effectScope(true).run(() => createGuard(flowId)))
  return guards.get(flowId)
}

/**
 * Builds a flow's edit guard.
 *
 * @param {string} flowId
 */
function createGuard(flowId) {
  const level = useCanvasLevel(flowId)
  const { find } = useSupermodules(flowId)
  let operations = null

  /**
   * The question asked while an edit waits: `{name, count}`, the super-module's name and how many super instances it
   * has in the model. Null when none is asked.
   */
  const question = shallowRef(null)
  let respond = null
  // The super-module an edit asks about, found when its change was held.
  let target = null
  // The answer for the super instance shown: `{key, choice}`.
  let remembered = null
  // The super-modules a structural edit changed this session.
  const modifiedIds = ref(new Set())

  const levelKey = () => level.instancePath.value.join('/')
  // At once, so leaving the super instance and coming back forgets the answer too.
  watch(levelKey, () => (remembered = null), { flush: 'sync' })

  /**
   * Finds the super-module shown when an edit to it asks first: it is reached through a super instance, it has more
   * than one copy in the model or came from the library, and this super instance has no answer yet.
   *
   * @returns {{smId: string, name: string, count: number, instanceId: string}|null}
   */
  function guarded() {
    const path = level.instancePath.value
    if (!path.length || remembered?.key === levelKey()) return null
    const smId = level.scope.value
    const entry = find(smId)
    if (!entry || (entry.occurrences <= 1 && !entry.source)) return null
    return { smId, name: entry.name, count: entry.occurrences, instanceId: path.at(-1) }
  }

  /** @returns {boolean} Whether a command changes the structure of the super-module shown, so it waits for an answer. */
  function holds(command) {
    if (!command.scopes?.includes(level.scope.value)) return false
    target = guarded()
    return target !== null
  }

  /**
   * Asks what the held change does.
   *
   * @returns {Promise<'keep'|'discard'|Object>} For the history (see setGate).
   */
  async function decide() {
    const { name, count, instanceId } = target
    const choice = await new Promise((resolve) => {
      respond = resolve
      question.value = { name, count }
    })
    if (choice !== 'all' && choice !== 'new') return 'discard'
    remembered = { key: levelKey(), choice }
    return choice === 'all' ? 'keep' : operations.keepForOneCommand(instanceId)
  }

  /**
   * Answers the question asked.
   *
   * @param {'all'|'new'|'cancel'} choice - Change all its super instances, make this one a new super-module, or
   *   leave the edit unmade.
   */
  function answer(choice) {
    const resolve = respond
    respond = null
    question.value = null
    resolve?.(choice)
  }

  /** Marks the super-modules a step changed the structure of, but not those it made. */
  function recorded(commands) {
    const created = new Set(commands.flatMap((command) => command.created ?? []))
    const changed = commands.flatMap((command) => command.scopes ?? []).filter((scope) => scope !== null && !created.has(scope))
    if (changed.every((smId) => modifiedIds.value.has(smId))) return
    modifiedIds.value = new Set([...modifiedIds.value, ...changed])
  }

  /** Forgets what was changed and answered, as a workspace is cleared or loaded. */
  function cleared() {
    modifiedIds.value = new Set()
    remembered = null
    if (respond) answer('cancel')
  }

  /**
   * Gates a history with this guard.
   *
   * @param {Object} history - The workspace's history store.
   */
  function install(history) {
    operations = useHierarchyOperations({ flowId, history })
    history.setGate?.({ holds, decide, recorded, cleared })
  }

  /** @returns {boolean} Whether a structural edit changed a super-module this session. */
  const isModified = (smId) => modifiedIds.value.has(smId)

  return { question, answer, install, isModified }
}
