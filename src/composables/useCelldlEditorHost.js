/**
 * The one CellDL editor PhLynx mounts. The editor works as a singleton (fixed element ids, and window and
 * document listeners it never removes), so CelldlEditorHost mounts it once, on first request, and keeps it:
 * a pane claims it to show it, and it is parked off screen between claims rather than recreated.
 *
 * Commands go to the editor through its `editorCommand` prop, which it watches by reference, so each is a
 * new object.
 */
import { computed, ref, shallowRef, watch } from 'vue'

/** How long to wait for the editor to mount, and to answer a command. */
const READY_TIMEOUT_MS = 30000
const COMMAND_TIMEOUT_MS = 10000

/** The editor's options: hovering an element shows its annotation's tooltip, the variables it has. */
export const EDITOR_OPTIONS = Object.freeze({ tooltip: 'tooltip' })

/** The class marking a diagram element a conversion failed on. */
export const ERROR_CLASS = 'phlynx-celldl-error'

/** The keys the editor handles on the window: undo and redo, deleting, and cancelling a path. */
const GATED_KEYS = new Set(['Backspace', 'Delete', 'Escape'])

/**
 * Checks whether a key is one the editor acts on wherever focus is.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isEditorKey(event) {
  if (GATED_KEYS.has(event.key)) return true
  const key = event.key?.toLowerCase()
  return !!(event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')
}

/**
 * Creates a host's state. The app uses the one useCelldlEditorHost returns; tests make their own.
 *
 * @param {Object} [options]
 * @param {number} [options.readyTimeout]
 * @param {number} [options.commandTimeout]
 */
export function createCelldlEditorHost({ readyTimeout = READY_TIMEOUT_MS, commandTimeout = COMMAND_TIMEOUT_MS } = {}) {
  /** Whether a pane has asked for the editor, which mounts the host. */
  const isRequested = ref(false)
  /** The claiming pane's element, or null while parked. */
  const target = shallowRef(null)
  const isActive = computed(() => target.value !== null)
  const command = shallowRef(null)
  const isReady = ref(false)
  /** Whether the diagram was edited since it was opened or marked clean. A hint: the editor reports any change. */
  const isDirty = ref(false)
  /** The editor's last error, e.g. a document it couldn't open. */
  const error = ref('')
  /**
   * Whether the user is working in the claiming pane: the last pointer press or focus landed in it. The editor
   * takes no focus of its own, so a press counts until focus moves elsewhere.
   */
  const isEngaged = ref(false)
  /** Whether the editor is opening a source, so still shows the one before. */
  const isSyncing = ref(false)
  /** The shown source's elements as the editor's annotations, by SVG id: their variables, primary one and tooltip. */
  const annotations = shallowRef({})

  let root = null
  let readyWaiters = []
  // The source the dialog last asked for, and the one the editor shows.
  let wanted = null
  let shown = null
  let baseline = null
  let isOpening = false
  let commandCount = 0
  const pendingData = new Map()
  // The claiming pane's handler for the editor's viewer events (select, unselect, active, unactive).
  let eventHandler = null
  let annotationCount = 0

  const svgOf = () => root?.querySelector('#svg-container > svg') ?? null

  /**
   * Records the source the editor shows, and annotates its elements. A source's elements are those it was saved
   * with, so an element added since has no annotation.
   *
   * @param {{source: Object|null}|null} request
   */
  function setShown(request) {
    shown = request
    const elements = request?.source?.elements
    const count = ++annotationCount
    if (!elements || !Object.keys(elements).length) {
      annotations.value = {}
      return
    }
    import('@physiomelinks/bg2cellml').then(
      ({ toViewerAnnotations }) => {
        if (count === annotationCount) annotations.value = toViewerAnnotations(elements)
      },
      (e) => console.error('CellDL annotations failed:', e)
    )
  }

  /**
   * Waits until a test passes, checking it as the editor's root changes or it reports an error.
   *
   * @param {() => boolean} isDone
   * @param {number} timeout
   * @param {string} what - Named in the timeout's error.
   * @returns {Promise<void>}
   */
  function waitFor(isDone, timeout, what) {
    if (isDone()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!isDone()) return
        finish()
        resolve()
      }
      const observer = new MutationObserver(check)
      const stopWatching = watch(error, check, { flush: 'sync' })
      const timer = setTimeout(() => {
        finish()
        reject(new Error(`The CellDL editor didn't ${what} in time`))
      }, timeout)
      const finish = () => {
        observer.disconnect()
        stopWatching()
        clearTimeout(timer)
      }
      observer.observe(root, { childList: true, subtree: true })
    })
  }

  /**
   * Resolves once the editor has mounted and drawn its first, blank diagram. It mounts in a timeout after its
   * component does, so its component mounting isn't enough.
   *
   * @returns {Promise<void>}
   */
  function whenReady() {
    if (isReady.value) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        readyWaiters = readyWaiters.filter((waiter) => waiter.resolve !== done)
        reject(new Error("The CellDL editor didn't start in time"))
      }, readyTimeout)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      readyWaiters.push({ resolve: done })
    })
  }

  /**
   * Records the host's root element, once mounted, and watches it for the editor's diagram.
   *
   * @param {HTMLElement} element
   */
  function attach(element) {
    root = element
    waitFor(() => svgOf() !== null, readyTimeout, 'start').then(
      () => {
        isReady.value = true
        readyWaiters.forEach((waiter) => waiter.resolve())
        readyWaiters = []
      },
      (e) => (error.value = e.message)
    )
  }

  function send(next) {
    command.value = next
  }

  /**
   * Gets the diagram as CellDL. The editor deselects everything to serialise it.
   *
   * @returns {Promise<string>}
   */
  async function serialise() {
    await whenReady()
    clearHighlights()
    const kind = `phlynx-${++commandCount}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingData.delete(kind)
        reject(new Error("The CellDL editor didn't return its diagram in time"))
      }, commandTimeout)
      pendingData.set(kind, (data) => {
        clearTimeout(timer)
        resolve(data)
      })
      send({ command: 'file', options: { action: 'data', kind } })
    })
  }

  /**
   * Marks the diagram's elements a conversion failed on, until the diagram is next serialised or opened.
   *
   * @param {string[]} ids - Their SVG ids.
   */
  function highlight(ids) {
    clearHighlights()
    const svg = svgOf()
    ids.forEach((id) => svg?.getElementById(id)?.classList.add(ERROR_CLASS))
  }

  /** Clears highlight's marks, which must never be saved with the diagram. */
  function clearHighlights() {
    root?.querySelectorAll(`.${ERROR_CLASS}`).forEach((element) => element.classList.remove(ERROR_CLASS))
  }

  /**
   * Passes on the editor's `editor-data` event.
   *
   * @param {{data: string, kind?: string}} payload
   */
  function onEditorData({ data, kind } = {}) {
    const resolve = pendingData.get(kind)
    if (!resolve) return
    pendingData.delete(kind)
    resolve(data ?? '')
  }

  /**
   * Passes on the editor's `editor-state` event, which carries its errors.
   *
   * @param {{error?: string}} state
   */
  function onEditorState(state) {
    error.value = state?.error ?? ''
  }

  /**
   * Shows a source in the editor: its document, read under its documentUri, or a blank diagram for none. Rejects
   * with the editor's error for a document it can't open.
   *
   * @param {{document: string|null, documentUri: string}|null} source
   * @returns {Promise<void>}
   */
  async function open(source) {
    await whenReady()
    isOpening = true
    error.value = ''
    try {
      const previous = svgOf()
      send(
        source?.document
          ? { command: 'file', options: { action: 'open', data: source.document, name: source.documentUri } }
          : { command: 'file', options: { action: 'close' } }
      )
      await waitFor(() => svgOf() !== previous || error.value !== '', commandTimeout, 'open the diagram')
      if (error.value) throw new Error(error.value)
      // The editor finishes setting the diagram up a tick after drawing it, and may flag it edited as it does.
      await new Promise((resolve) => setTimeout(resolve, 0))
      baseline = await serialise()
      isDirty.value = false
    } finally {
      isOpening = false
    }
  }

  let syncing = null

  /**
   * Asks for a source to be shown: now if a pane holds the editor, e.g. a dialog reloading after a save, or else
   * the next time a pane claims it.
   *
   * @param {Object|null} source
   */
  function prepare(source) {
    // The editor already shows an unedited source, e.g. the one just saved.
    const isShown = !!shown && !isDirty.value && isSameSource(shown.source, source)
    wanted = { source }
    // Its elements may be newer, e.g. a stored source saved since.
    if (isShown) setShown(wanted)
    isDirty.value = false
    if (isActive.value) sync().catch((e) => (error.value = e.message))
  }

  /**
   * Opens the wanted source, unless the editor already shows it.
   *
   * @returns {Promise<void>}
   */
  async function sync() {
    isSyncing.value = true
    try {
      while (wanted && shown !== wanted) {
        const request = wanted
        // A source that failed leaves the editor's diagram unknown, so the next sync opens it again.
        syncing ??= open(request.source)
          .then(
            () => setShown(request),
            (e) => {
              setShown(null)
              throw e
            }
          )
          .finally(() => (syncing = null))
        await syncing
      }
    } finally {
      isSyncing.value = !!syncing
    }
  }

  /** Marks the diagram saved, in the editor's undo history too. */
  function markClean() {
    send({ command: 'edit', options: { action: 'clean' } })
    isDirty.value = false
  }

  /**
   * Marks the diagram saved as a source, so a dialog reloading after the save keeps it rather than opening it again.
   *
   * @param {{document: string, documentUri: string}} source - The source saved, its document as serialised.
   */
  function markSaved(source) {
    markClean()
    baseline = source.document
    wanted = { source }
    setShown(wanted)
  }

  /**
   * Checks whether the diagram differs from the one opened, by its serialisation.
   *
   * @returns {Promise<{isChanged: boolean, document: string}>}
   */
  async function compareWithBaseline() {
    const document = await serialise()
    return { isChanged: document !== baseline, document }
  }

  /**
   * Shows the editor in a pane, mounting it on first use.
   *
   * @param {HTMLElement} element
   * @param {(event: {type: string, component?: {id: string, annotation?: Object}}) => void} [onEvent] - Hears
   *   the editor's viewer events while the pane holds it.
   */
  function claim(element, onEvent = null) {
    isRequested.value = true
    isEngaged.value = false
    target.value = element
    eventHandler = onEvent
  }

  /**
   * Parks the editor again, if the pane still holds it. The diagram is kept, never closed.
   *
   * @param {HTMLElement} element
   */
  function release(element) {
    if (target.value !== element) return
    target.value = null
    isEngaged.value = false
    eventHandler = null
  }

  /**
   * Passes on the editor's viewer `event` to the claiming pane.
   *
   * @param {Object} event
   */
  function onViewerEvent(event) {
    eventHandler?.(event)
  }

  function onFileEdited() {
    if (isActive.value && !isOpening) isDirty.value = true
  }

  /**
   * Follows where the user works: a pointer press or focus inside the claiming pane engages it, anywhere else
   * disengages it. A context menu, which the editor opens on the body, belongs to wherever it was opened.
   *
   * @param {Event} event
   */
  function onPointerOrFocus(event) {
    if (event.target?.closest?.('.p-contextmenu')) return
    isEngaged.value = !!target.value?.contains(event.target)
  }

  /**
   * Stops the editor's keys reaching its window listeners unless the user works in the claiming pane, so a parked
   * editor never undoes or deletes. It listens on the document, which the window hears after, and leaves the
   * event to every other listener there; PhLynx's own shortcuts listen on the document, or on the window for keys
   * the gate passes.
   *
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    if (isEditorKey(event) && !isEngaged.value) event.stopPropagation()
  }

  /** Listens for the editor's edits, and gates its keys. The host listens while it is mounted. */
  function listen() {
    document.addEventListener('file-edited', onFileEdited)
    document.addEventListener('pointerdown', onPointerOrFocus, true)
    document.addEventListener('focusin', onPointerOrFocus)
    document.addEventListener('keydown', onKeyDown)
  }

  function unlisten() {
    document.removeEventListener('file-edited', onFileEdited)
    document.removeEventListener('pointerdown', onPointerOrFocus, true)
    document.removeEventListener('focusin', onPointerOrFocus)
    document.removeEventListener('keydown', onKeyDown)
  }

  return {
    isRequested,
    target,
    isActive,
    command,
    isReady,
    isDirty,
    error,
    isEngaged,
    isSyncing,
    annotations,
    attach,
    whenReady,
    open,
    prepare,
    sync,
    serialise,
    compareWithBaseline,
    markClean,
    markSaved,
    highlight,
    claim,
    release,
    onEditorData,
    onEditorState,
    onViewerEvent,
    listen,
    unlisten,
  }
}

/**
 * Checks whether two sources open as the same diagram.
 *
 * @param {Object|null} source
 * @param {Object|null} other
 * @returns {boolean}
 */
function isSameSource(source, other) {
  return source?.document === other?.document && source?.documentUri === other?.documentUri
}

let host = null

/**
 * Gets the app's CellDL editor host.
 *
 * @returns {ReturnType<typeof createCelldlEditorHost>}
 */
export function useCelldlEditorHost() {
  host ??= createCelldlEditorHost()
  return host
}
