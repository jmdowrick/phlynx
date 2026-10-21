import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'

import { createCelldlEditorHost, isEditorKey } from '../../../src/composables/useCelldlEditorHost.js'

const SOURCE = { format: 'celldl', document: '<svg>rc</svg>', documentUri: 'https://phlynx.example/rc.celldl' }

/**
 * Stands in for the CellDL editor: it draws a diagram into the host's root once mounted, and answers commands
 * as the editor does.
 */
function mountFakeEditor(host, { failOpen = false } = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const container = document.createElement('div')
  container.id = 'svg-container'
  root.appendChild(container)
  let diagram = 'blank'
  const draw = () => container.replaceChildren(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
  const commands = []
  watch(host.command, (command) => {
    commands.push(command)
    const { action, data, kind } = command.options
    if (command.command !== 'file') return
    if (action === 'open') {
      if (failOpen) return host.onEditorState({ error: 'Cannot open' })
      diagram = data
      draw()
    } else if (action === 'close') {
      diagram = 'blank'
      draw()
    } else if (action === 'data') {
      queueMicrotask(() => host.onEditorData({ data: diagram, kind }))
    }
  })
  host.attach(root)
  return { root, commands, draw, edit: (next) => (diagram = next) }
}

describe('useCelldlEditorHost', () => {
  let host

  beforeEach(() => {
    host = createCelldlEditorHost({ readyTimeout: 500, commandTimeout: 200 })
    host.listen()
  })

  afterEach(() => {
    host.unlisten()
    document.body.replaceChildren()
  })

  it('is ready once the editor has drawn its first diagram', async () => {
    const editor = mountFakeEditor(host)
    const ready = host.whenReady()
    expect(host.isReady.value).toBe(false)
    editor.draw()
    await ready
    expect(host.isReady.value).toBe(true)
  })

  it("gives up waiting for an editor that doesn't start", async () => {
    mountFakeEditor(host)
    await expect(host.whenReady()).rejects.toThrow("didn't start")
  })

  it('opens the prepared source under its documentUri as a pane claims it, once', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    const pane = document.createElement('div')
    host.claim(pane)
    await host.sync()

    expect(host.isActive.value).toBe(true)
    expect(editor.commands[0]).toEqual({
      command: 'file',
      options: { action: 'open', data: SOURCE.document, name: SOURCE.documentUri },
    })
    expect(editor.commands[1].options.action).toBe('data')

    // Shown again without reopening.
    host.release(pane)
    expect(host.isActive.value).toBe(false)
    host.claim(pane)
    await host.sync()
    expect(editor.commands).toHaveLength(2)
  })

  it('closes the diagram for a source with no document', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare({ ...SOURCE, document: null })
    host.claim(document.createElement('div'))
    await host.sync()
    expect(editor.commands[0]).toEqual({ command: 'file', options: { action: 'close' } })
  })

  it("keeps the editor's error for a document it can't open", async () => {
    const editor = mountFakeEditor(host, { failOpen: true })
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await expect(host.sync()).rejects.toThrow('Cannot open')
    expect(host.error.value).toBe('Cannot open')
  })

  it('opens a source prepared while a pane holds the editor at once, saying it is opening', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()

    const next = { ...SOURCE, document: '<svg>rlc</svg>' }
    host.prepare(next)
    expect(host.isSyncing.value).toBe(true)
    await vi.waitFor(() => expect(host.isSyncing.value).toBe(false))
    expect(editor.commands.filter(({ options }) => options.action === 'open').map(({ options }) => options.data)).toEqual([
      SOURCE.document,
      next.document,
    ])
  })

  it('opens a source again after failing to', async () => {
    const editor = mountFakeEditor(host, { failOpen: true })
    editor.draw()
    host.prepare(SOURCE)
    const pane = document.createElement('div')
    host.claim(pane)
    await expect(host.sync()).rejects.toThrow('Cannot open')
    expect(host.isSyncing.value).toBe(false)

    host.release(pane)
    host.claim(pane)
    await expect(host.sync()).rejects.toThrow('Cannot open')
    expect(editor.commands.filter(({ options }) => options.action === 'open')).toHaveLength(2)
  })

  it('serialises the diagram, and compares it with the one opened', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    host.prepare(SOURCE)
    host.claim(document.createElement('div'))
    await host.sync()

    expect(await host.compareWithBaseline()).toEqual({ isChanged: false, document: SOURCE.document })
    editor.edit('<svg>rlc</svg>')
    expect(await host.compareWithBaseline()).toEqual({ isChanged: true, document: '<svg>rlc</svg>' })
  })

  it("gives up on a diagram the editor doesn't return", async () => {
    const root = document.createElement('div')
    root.innerHTML = '<div id="svg-container"><svg></svg></div>'
    host.attach(root)
    host.onEditorData({ data: 'stray', kind: 'other' })
    await expect(host.serialise()).rejects.toThrow("didn't return its diagram")
  })

  it('takes edits as a dirty hint only while a pane shows the editor, and marks the diagram clean', async () => {
    const editor = mountFakeEditor(host)
    editor.draw()
    document.dispatchEvent(new CustomEvent('file-edited'))
    expect(host.isDirty.value).toBe(false)

    const pane = document.createElement('div')
    host.claim(pane)
    document.dispatchEvent(new CustomEvent('file-edited'))
    expect(host.isDirty.value).toBe(true)

    host.markClean()
    await nextTick()
    expect(host.isDirty.value).toBe(false)
    expect(editor.commands.at(-1)).toEqual({ command: 'edit', options: { action: 'clean' } })

    document.dispatchEvent(new CustomEvent('file-edited'))
    host.prepare(SOURCE)
    expect(host.isDirty.value).toBe(false)
  })

  it("passes the editor's viewer events to the pane holding it", () => {
    const onEvent = vi.fn()
    const pane = document.createElement('div')
    host.claim(pane, onEvent)
    host.onViewerEvent({ type: 'select', component: { id: 'ID-1' } })
    expect(onEvent).toHaveBeenCalledWith({ type: 'select', component: { id: 'ID-1' } })

    host.release(pane)
    host.onViewerEvent({ type: 'unselect' })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it("doesn't park the editor for a pane that no longer holds it", () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    host.claim(first)
    host.claim(second)
    host.release(first)
    expect(host.target.value).toBe(second)
  })
})

describe('the CellDL key gate', () => {
  let host
  let pane
  let outside
  let reached

  const press = (key, init = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
  }
  const pressOn = (element) => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

  beforeEach(() => {
    host = createCelldlEditorHost()
    host.listen()
    pane = document.createElement('div')
    pane.innerHTML = '<input class="in-pane">'
    outside = document.createElement('div')
    outside.innerHTML = '<input class="outside">'
    document.body.append(pane, outside)
    reached = []
    // The editor's own listeners are on the window.
    window.addEventListener('keydown', record)
  })

  function record(event) {
    reached.push(event.key)
  }

  afterEach(() => {
    window.removeEventListener('keydown', record)
    host.unlisten()
    document.body.replaceChildren()
  })

  it('knows the keys the editor acts on wherever focus is', () => {
    for (const key of ['Backspace', 'Delete', 'Escape']) expect(isEditorKey({ key })).toBe(true)
    expect(isEditorKey({ key: 'z', metaKey: true })).toBe(true)
    expect(isEditorKey({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(isEditorKey({ key: 'y', ctrlKey: true })).toBe(true)
    expect(isEditorKey({ key: 'z' })).toBe(false)
    expect(isEditorKey({ key: 's', metaKey: true })).toBe(false)
  })

  it("keeps the editor's keys from a parked editor", () => {
    press('z', { metaKey: true })
    press('Backspace')
    press('Escape')
    expect(reached).toEqual([])
  })

  it('lets other keys through, and leaves document listeners hearing every key', () => {
    const heard = []
    const onDocument = (event) => heard.push(event.key)
    document.addEventListener('keydown', onDocument)
    press('a')
    press('Enter', { metaKey: true })
    press('z', { metaKey: true })
    document.removeEventListener('keydown', onDocument)
    expect(reached).toEqual(['a', 'Enter'])
    expect(heard).toEqual(['a', 'Enter', 'z'])
  })

  it('passes them to the editor while the user works in its pane', () => {
    host.claim(pane)
    pressOn(pane)
    press('z', { metaKey: true })
    press('Delete')
    expect(reached).toEqual(['z', 'Delete'])
    expect(host.isEngaged.value).toBe(true)
  })

  it('stops them once the user moves out of the pane, by pointer or by focus', () => {
    host.claim(pane)
    pressOn(pane)
    pressOn(outside)
    press('z', { metaKey: true })
    expect(host.isEngaged.value).toBe(false)

    pane.querySelector('input').focus()
    expect(host.isEngaged.value).toBe(true)
    outside.querySelector('input').focus()
    press('Backspace')
    expect(reached).toEqual([])
  })

  it("counts the editor's context menu as where it was opened", () => {
    host.claim(pane)
    pressOn(pane)
    const menu = document.createElement('ul')
    menu.className = 'p-contextmenu'
    document.body.appendChild(menu)
    pressOn(menu)
    press('Escape')
    expect(reached).toEqual(['Escape'])
  })

  it('disengages as the pane parks the editor', () => {
    host.claim(pane)
    pressOn(pane)
    host.release(pane)
    expect(host.isEngaged.value).toBe(false)
    press('z', { metaKey: true })
    expect(reached).toEqual([])
  })
})
