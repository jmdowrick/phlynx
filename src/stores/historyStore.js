import { defineStore } from 'pinia'
import { ref, computed, shallowRef, toRaw } from 'vue'

/**
 * Creates an undo/redo command stack with batching. The workspace shares one (useFlowHistoryStore);
 * an editor can make its own.
 *
 * @returns {Object} The stack's state and actions.
 */
export function createHistory() {
  // Command stack and pointer.
  const stack = ref([])
  const pointer = ref(-1)
  const working = ref(false)
  const lastChangeWasAdd = ref(false)
  // Depth of withoutHistory calls in progress.
  const suppressedDepth = ref(0)

  // Batching related controls.
  let batchTimer = null
  const eventWaitTime = 25
  const pendingCommands = shallowRef([])

  // Manual batching flag.
  const isManualBatching = ref(false)

  // Where each command was recorded, and how to capture and go back there (see setContextHandlers).
  const contexts = new WeakMap()
  let contextHandlers = null

  const canUndo = computed(() => pointer.value >= 0)
  const canRedo = computed(() => pointer.value < stack.value.length - 1)
  const isUndoRedoing = computed(() => working.value || suppressedDepth.value > 0)
  const pointerIndex = computed(() => pointer.value)
  const lastCommandHadOffsetApplied = computed(() => {
    if (pendingCommands.value.length) {
      const cmd = pendingCommands.value[pendingCommands.value.length - 1]
      return cmd.offset === 'applied'
    }

    return false
  })

  /**
   * Internal helper to handle stack slicing and pointer.
   */
  function _pushToStack(command) {
    if (pointer.value < stack.value.length - 1) {
      stack.value = stack.value.slice(0, pointer.value + 1)
    }
    stack.value.push(command)
    pointer.value++
  }

  function lastChangeWasAddSetter(value) {
    lastChangeWasAdd.value = value
  }

  /**
   * Whether `command` is still waiting to be committed, so it can still be changed.
   *
   * @param {Object} command
   * @returns {boolean}
   */
  function isPending(command) {
    return pendingCommands.value.includes(command)
  }

  function replaceLastCommand(command) {
    if (pendingCommands.value.length) {
      const replaced = toRaw(pendingCommands.value[pendingCommands.value.length - 1])
      if (contexts.has(replaced)) contexts.set(toRaw(command), contexts.get(replaced))
      pendingCommands.value[pendingCommands.value.length - 1] = command
    }
  }

  /**
   * Makes every command recorded from now on remember where it was made, and undo and redo go back there before
   * applying it, so the change they make is in view: the workspace's canvas level.
   *
   * @param {{capture: () => *, restore: (context: *) => void}|null} handlers - capture gives where things are now;
   *   restore goes back to what capture gave. Null forgets them.
   */
  function setContextHandlers(handlers) {
    contextHandlers = handlers
  }

  /** Remembers where a command was recorded. The stack holds commands reactive, so they are keyed raw. */
  function stamp(command) {
    const key = toRaw(command)
    if (contextHandlers && !contexts.has(key)) contexts.set(key, contextHandlers.capture())
  }

  /** Goes back to where a command was recorded, without recording. */
  function revisit(command) {
    const key = toRaw(command)
    if (contextHandlers && contexts.has(key)) contextHandlers.restore(contexts.get(key))
  }

  function clear() {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    stack.value = []
    pointer.value = -1
    working.value = false
    lastChangeWasAdd.value = false
    pendingCommands.value = []
    isManualBatching.value = false
  }

  function addCommand(command) {
    if (isUndoRedoing.value) {
      return
    }

    stamp(command)
    pendingCommands.value.push(command)

    if (isManualBatching.value) {
      return
    }

    if (batchTimer) clearTimeout(batchTimer)

    batchTimer = setTimeout(() => {
      commitBatch()
    }, eventWaitTime)
  }
  /**
   * Start a manual transaction.
   * Disables the auto-timer and holds all subsequent commands in pendingCommands.
   */
  function startBatch() {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    isManualBatching.value = true
  }

  /**
   * End a manual transaction.
   * Forces a commit of all pending commands into a single history step.
   */
  function endBatch() {
    isManualBatching.value = false
    commitBatch()
  }

  function commitBatch() {
    if (pendingCommands.value.length === 0) return

    const batch = [...pendingCommands.value]

    // Clear pending commands.
    pendingCommands.value = []
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }

    if (batch.length === 1) {
      _pushToStack(batch[0])
    } else {
      const superCommand = {
        type: 'super',
        redo: () => {
          batch.forEach((cmd) => cmd.redo())
        },
        undo: () => {
          ;[...batch].reverse().forEach((cmd) => cmd.undo())
        },
      }
      // A batch is one change, made in one place.
      const first = toRaw(batch[0])
      if (contexts.has(first)) contexts.set(superCommand, contexts.get(first))
      _pushToStack(superCommand)
    }
  }

  async function executeAndAddCommand(command) {
    if (suppressedDepth.value > 0) {
      await command.redo()
      return
    }

    stamp(command)
    working.value = true

    try {
      await command.redo()
      // If manual batching is active, capture this explicit execution too
      if (isManualBatching.value) {
        pendingCommands.value.push(command)
      } else {
        _pushToStack(command)
      }
    } finally {
      working.value = false
    }
  }

  /**
   * Runs `fn` without recording: commits pending commands first, then ignores every change and
   * command until `fn` (sync or async) settles. For changes that are not edits, like navigation.
   * Inside a manual batch, an undo or redo, or another withoutHistory, nothing is committed, so a
   * batch still ends as one step.
   *
   * @param {Function} fn
   * @returns {*} What `fn` returns.
   */
  function withoutHistory(fn) {
    if (!isManualBatching.value && !isUndoRedoing.value) commitBatch()
    lastChangeWasAdd.value = false
    suppressedDepth.value++

    const restore = () => {
      suppressedDepth.value--
    }
    let result
    try {
      result = fn()
    } catch (error) {
      restore()
      throw error
    }
    if (typeof result?.then === 'function') {
      return Promise.resolve(result).finally(restore)
    }
    restore()
    return result
  }

  async function undo() {
    if (!canUndo.value) {
      return
    }
    working.value = true
    try {
      const command = stack.value[pointer.value]
      pointer.value--
      revisit(command)
      await command.undo()
    } finally {
      working.value = false
    }
  }

  async function redo() {
    if (!canRedo.value) {
      return
    }

    working.value = true
    try {
      pointer.value++
      const command = stack.value[pointer.value]
      revisit(command)
      await command.redo()
    } finally {
      working.value = false
    }
  }

  return {
    addCommand,
    canRedo,
    canUndo,
    clear,
    endBatch,
    executeAndAddCommand,
    isPending,
    isUndoRedoing,
    lastChangeWasAdd,
    lastChangeWasAddSetter,
    lastCommandHadOffsetApplied,
    pointerIndex,
    redo,
    replaceLastCommand,
    setContextHandlers,
    startBatch,
    undo,
    withoutHistory,
  }
}

export const useFlowHistoryStore = defineStore('flowHistory', createHistory)
