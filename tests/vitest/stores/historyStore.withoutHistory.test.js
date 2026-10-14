import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHistory } from '../../../src/stores/historyStore.js'

/**
 * Creates a command that logs its undo and redo calls.
 *
 * @param {string} name
 * @param {Array<string>} log
 * @returns {Object}
 */
function loggedCommand(name, log) {
  return {
    type: name,
    undo: vi.fn(() => log.push(`undo ${name}`)),
    redo: vi.fn(() => log.push(`redo ${name}`)),
  }
}

describe('createHistory withoutHistory', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('commits pending commands first, as their own step', async () => {
    vi.useFakeTimers()
    const log = []
    const history = reactive(createHistory())
    history.addCommand(loggedCommand('a', log))

    history.withoutHistory(() => {})
    expect(history.canUndo).toBe(true)

    history.addCommand(loggedCommand('b', log))
    vi.advanceTimersByTime(25)
    await history.undo()
    expect(log).toEqual(['undo b'])
    await history.undo()
    expect(log).toEqual(['undo b', 'undo a'])
  })

  it('leaves an open manual batch to end as one step', async () => {
    const log = []
    const history = reactive(createHistory())
    history.startBatch()
    history.addCommand(loggedCommand('a', log))

    history.withoutHistory(() => history.addCommand(loggedCommand('skipped', log)))
    expect(history.canUndo).toBe(false)

    history.addCommand(loggedCommand('b', log))
    history.endBatch()
    await history.undo()
    expect(log).toEqual(['undo b', 'undo a'])
    expect(history.canUndo).toBe(false)
  })

  it('records nothing added or executed inside it, and reports itself as undoing', async () => {
    const log = []
    const history = reactive(createHistory())
    let wasUndoRedoing

    await history.withoutHistory(async () => {
      wasUndoRedoing = history.isUndoRedoing
      history.addCommand(loggedCommand('a', log))
      await history.executeAndAddCommand(loggedCommand('b', log))
      history.addCommand(loggedCommand('c', log))
    })
    history.startBatch()
    history.endBatch()

    expect(wasUndoRedoing).toBe(true)
    expect(log).toEqual(['redo b'])
    expect(history.canUndo).toBe(false)
    expect(history.isUndoRedoing).toBe(false)
  })

  it('returns what a sync callback returns and records again straight after', async () => {
    const log = []
    const history = reactive(createHistory())

    expect(history.withoutHistory(() => 7)).toBe(7)
    await history.executeAndAddCommand(loggedCommand('a', log))
    expect(history.canUndo).toBe(true)
  })

  it('keeps suppressing until the outermost call settles', async () => {
    const history = reactive(createHistory())

    await history.withoutHistory(async () => {
      await history.withoutHistory(async () => {})
      history.addCommand(loggedCommand('a', []))
    })
    history.startBatch()
    history.endBatch()

    expect(history.canUndo).toBe(false)
  })

  it('records again after the callback throws', async () => {
    const history = reactive(createHistory())

    expect(() =>
      history.withoutHistory(() => {
        throw new Error('sync')
      }),
    ).toThrow('sync')
    await expect(history.withoutHistory(async () => Promise.reject(new Error('async')))).rejects.toThrow('async')

    expect(history.isUndoRedoing).toBe(false)
    await history.executeAndAddCommand(loggedCommand('a', []))
    expect(history.canUndo).toBe(true)
  })

  it('clears a pending add so a later measurement does not rewrite it', () => {
    const history = reactive(createHistory())
    history.lastChangeWasAddSetter(true)

    history.withoutHistory(() => {})
    expect(history.lastChangeWasAdd).toBe(false)
  })
})
