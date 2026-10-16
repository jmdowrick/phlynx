import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createHistory } from '../../../src/stores/historyStore.js'

/** A command that logs its undo and redo calls, with where the canvas was then. */
const command = (name, log, where) => ({
  type: name,
  undo: () => log.push(`undo ${name} at ${where.at}`),
  redo: () => log.push(`redo ${name} at ${where.at}`),
})

/** A history whose context is `where.at`, and whose restore moves it back there. */
function setup() {
  const log = []
  const where = { at: 'root' }
  const history = reactive(createHistory())
  const restore = vi.fn((context) => (where.at = context))
  history.setContextHandlers({ capture: () => where.at, restore })
  return { history, log, where, restore }
}

describe('createHistory contexts', () => {
  it('goes back to where a step was recorded before undoing and redoing it', async () => {
    const { history, log, where } = setup()
    where.at = 'heart'
    history.startBatch()
    history.addCommand(command('add', log, where))
    history.endBatch()
    where.at = 'root'

    await history.undo()
    where.at = 'root'
    await history.redo()
    expect(log).toEqual(['undo add at heart', 'redo add at heart'])
  })

  it('records a batch where its first command was', async () => {
    const { history, log, where } = setup()
    where.at = 'heart'
    history.startBatch()
    history.addCommand(command('a', log, where))
    where.at = 'lung'
    history.addCommand(command('b', log, where))
    history.endBatch()

    await history.undo()
    expect(log).toEqual(['undo b at heart', 'undo a at heart'])
  })

  it('keeps a command’s context when it is replaced', async () => {
    const { history, log, where } = setup()
    where.at = 'heart'
    history.startBatch()
    history.addCommand(command('a', log, where))
    where.at = 'root'
    history.replaceLastCommand(command('a2', log, where))
    history.endBatch()

    await history.undo()
    expect(log).toEqual(['undo a2 at heart'])
  })

  it('records commands executed at once with their context, and none made without history', async () => {
    const { history, log, where, restore } = setup()
    where.at = 'heart'
    await history.executeAndAddCommand(command('clear', log, where))
    history.withoutHistory(() => history.addCommand(command('ignored', log, where)))
    where.at = 'root'
    await history.undo()
    expect(log).toEqual(['redo clear at heart', 'undo clear at heart'])
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('records no context without handlers', async () => {
    const log = []
    const history = reactive(createHistory())
    history.startBatch()
    history.addCommand(command('a', log, { at: 'root' }))
    history.endBatch()
    await history.undo()
    expect(log).toEqual(['undo a at root'])
  })
})
