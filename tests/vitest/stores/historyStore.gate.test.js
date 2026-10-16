import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHistory } from '../../../src/stores/historyStore.js'

/** A command that logs what it does. */
const logged = (log, name, extra = {}) => ({
  type: name,
  redo: () => log.push(`redo ${name}`),
  undo: () => log.push(`undo ${name}`),
  ...extra,
})

describe('a history gate', () => {
  let history, log, decision, gate

  beforeEach(() => {
    vi.useFakeTimers()
    history = createHistory()
    log = []
    decision = null
    gate = {
      holds: vi.fn((command) => !!command.held),
      decide: vi.fn(() => new Promise((resolve) => (decision = resolve))),
      recorded: vi.fn(),
      cleared: vi.fn(),
    }
    history.setGate(gate)
  })
  afterEach(() => vi.useRealTimers())

  /** Lets the held change complete, and the gate be asked. */
  const complete = async () => {
    await vi.advanceTimersByTimeAsync(30)
  }

  it('holds a change from the first command it holds, with the commands not yet committed, as one step on keep', async () => {
    history.addCommand(logged(log, 'move'))
    history.addCommand(logged(log, 'add', { held: true }))
    history.addCommand(logged(log, 'handle'))
    await complete()
    expect(gate.decide).toHaveBeenCalledTimes(1)
    expect(history.canUndo.value).toBe(false)
    // Undo waits for the decision.
    await history.undo()
    expect(log).toEqual([])

    decision('keep')
    await vi.runAllTimersAsync()
    expect(history.pointerIndex.value).toBe(0)
    expect(gate.recorded).toHaveBeenCalledWith([expect.objectContaining({ type: 'move' }), expect.objectContaining({ type: 'add' }), expect.objectContaining({ type: 'handle' })])
    await history.undo()
    expect(log).toEqual(['undo handle', 'undo add', 'undo move'])
  })

  it('undoes a discarded change, leaving no step', async () => {
    await history.executeAndAddCommand(logged(log, 'expose', { held: true }))
    expect(log).toEqual(['redo expose'])
    await complete()
    decision('discard')
    await vi.runAllTimersAsync()
    expect(log).toEqual(['redo expose', 'undo expose'])
    expect(history.canUndo.value).toBe(false)
    expect(gate.recorded).not.toHaveBeenCalled()
  })

  it('puts a command the gate gives first: the change undone, it run, the change redone, one step', async () => {
    history.addCommand(logged(log, 'remove', { held: true }))
    await complete()
    decision(logged(log, 'fork'))
    await vi.runAllTimersAsync()
    expect(log).toEqual(['undo remove', 'redo fork', 'redo remove'])
    log.length = 0
    await history.undo()
    expect(log).toEqual(['undo remove', 'undo fork'])
  })

  it('waits for a manual batch to end before asking', async () => {
    history.startBatch()
    history.addCommand(logged(log, 'add', { held: true }))
    await complete()
    expect(gate.decide).not.toHaveBeenCalled()
    history.addCommand(logged(log, 'edge'))
    history.endBatch()
    await complete()
    expect(gate.decide).toHaveBeenCalledTimes(1)
    decision('keep')
    await vi.runAllTimersAsync()
    expect(history.pointerIndex.value).toBe(0)
  })

  it('drops a held change on a clear, and tells the gate', async () => {
    history.addCommand(logged(log, 'add', { held: true }))
    await complete()
    history.clear()
    expect(gate.cleared).toHaveBeenCalled()
    decision('keep')
    await vi.runAllTimersAsync()
    expect(history.canUndo.value).toBe(false)
  })

  it('records as before what it doesn’t hold', async () => {
    history.addCommand(logged(log, 'move'))
    await complete()
    expect(gate.decide).not.toHaveBeenCalled()
    expect(history.pointerIndex.value).toBe(0)
  })
})
