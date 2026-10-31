import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILT_IN_TEMPLATES, getBuiltInTemplate } from '../../../src/services/bioView/builtInTemplates.js'
import { parseTemplateText, templateFile } from '../../../src/services/bioView/templateFiles.js'
import { LOCAL_TEMPLATES_KEY, useBioTemplateStore } from '../../../src/stores/bioTemplateStore.js'

const plain = (value) => JSON.parse(JSON.stringify(value))

/** A user's own template: the epithelial cell under another id and name. */
const tubule = (extra = {}) => ({
  ...plain(getBuiltInTemplate('epithelial-cell')),
  id: 'proximal-tubule',
  name: 'Renal proximal tubule',
  ...extra,
})

/** A fresh store, as the app makes on start, reading whatever localStorage holds. */
function freshStore() {
  setActivePinia(createPinia())
  return useBioTemplateStore()
}

const stored = () => JSON.parse(window.localStorage.getItem(LOCAL_TEMPLATES_KEY))

describe('bioTemplateStore local library', () => {
  let warn

  beforeEach(() => {
    window.localStorage.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    vi.restoreAllMocks()
  })

  it('adds a template under a local id, after the built-ins, and keeps it in localStorage', () => {
    const store = freshStore()
    const { template, errors, warnings } = store.addLocalTemplate(tubule())

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(template.id).toBe('local:proximal-tubule')
    expect(Object.isFrozen(template)).toBe(true)
    expect(store.library.map((t) => t.id)).toEqual([...BUILT_IN_TEMPLATES.map((t) => t.id), 'local:proximal-tubule'])
    expect(stored().map((t) => t.id)).toEqual(['local:proximal-tubule'])

    const again = freshStore()
    expect(again.localTemplates).toEqual([template])
    expect(again.getDefinition('local:proximal-tubule')).toEqual(template)
  })

  it('never takes a built-in id, even from a file that names one', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate({ ...tubule(), id: 'epithelial-cell' })
    expect(template.id).toBe('local:epithelial-cell')
    expect(store.getDefinition('epithelial-cell')).toBe(getBuiltInTemplate('epithelial-cell'))
  })

  it('reads a file id that already has the local prefix', () => {
    expect(freshStore().addLocalTemplate(tubule({ id: 'local:proximal-tubule' })).template.id).toBe(
      'local:proximal-tubule'
    )
  })

  it('numbers a different template with a taken id, and does not add the same one twice', () => {
    const store = freshStore()
    const first = store.addLocalTemplate(tubule()).template
    expect(store.addLocalTemplate(tubule()).template).toBe(first)
    expect(store.addLocalTemplate(tubule({ name: 'Distal tubule' })).template.id).toBe('local:proximal-tubule-2')
    expect(store.localTemplates).toHaveLength(2)
  })

  it('returns the errors and adds nothing for an invalid template', () => {
    const store = freshStore()
    const { template, errors } = store.addLocalTemplate({ ...tubule(), schemaVersion: 2 })
    expect(template).toBeNull()
    expect(errors).toEqual(['Template: "schemaVersion" must be 1.'])
    expect(store.localTemplates).toEqual([])
    expect(window.localStorage.getItem(LOCAL_TEMPLATES_KEY)).toBeNull()
  })

  it('passes on warnings for keys it ignores', () => {
    const { template, warnings } = freshStore().addLocalTemplate(tubule({ colour: 'red' }))
    expect(template).not.toBeNull()
    expect(warnings).toEqual(['Template: unknown key "colour" was ignored.'])
  })

  it('removes a local template, and leaves placed ones with their workspace copy', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    const instance = store.addInstance(template.id, { x: 0, y: 0 })

    expect(store.removeLocalTemplate(template.id)).toBe(true)
    expect(store.removeLocalTemplate(template.id)).toBe(false)
    expect(store.removeLocalTemplate('epithelial-cell')).toBe(false)
    expect(store.localTemplates).toEqual([])
    expect(stored()).toEqual([])
    expect(store.getDefinition(instance.template)).toBe(template)
  })

  it('skips stored templates that are invalid or have no local id', () => {
    window.localStorage.setItem(
      LOCAL_TEMPLATES_KEY,
      JSON.stringify([tubule({ id: 'local:good' }), tubule({ id: 'not-local' }), { id: 'local:bad' }])
    )
    expect(freshStore().localTemplates.map((t) => t.id)).toEqual(['local:good'])
  })

  it('starts empty when localStorage is unreadable or unavailable', () => {
    window.localStorage.setItem(LOCAL_TEMPLATES_KEY, '{not json')
    expect(freshStore().localTemplates).toEqual([])

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const store = freshStore()
    expect(store.localTemplates).toEqual([])
    expect(store.addLocalTemplate(tubule()).template.id).toBe('local:proximal-tubule')
  })

  it('saves a workspace that embeds a local template, which opens without it', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    store.addInstance(template.id, { x: 5, y: 6 })
    const state = plain(store.getState())
    expect(Object.keys(state.templates)).toEqual(['local:proximal-tubule'])

    window.localStorage.clear()
    const elsewhere = freshStore()
    expect(elsewhere.localTemplates).toEqual([])
    elsewhere.loadState(state)
    expect(elsewhere.instances).toHaveLength(1)
    expect(elsewhere.getDefinition('local:proximal-tubule')).toEqual(template)
    expect(warn).not.toHaveBeenCalled()

    // Loading its file there adds the workspace's copy to the library under the same id.
    const { raw } = parseTemplateText(templateFile(template).text)
    expect(elsewhere.addLocalTemplate(raw).template).toBe(elsewhere.getDefinition('local:proximal-tubule'))
  })

  it('round trips a template through Save Template As File and Load Template File', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    const file = templateFile(template)
    expect(file.filename).toBe('proximal-tubule.template.json')

    const { raw, errors } = parseTemplateText(file.text)
    expect(errors).toEqual([])
    store.removeLocalTemplate(template.id)
    expect(store.addLocalTemplate(raw).template).toEqual(template)
  })

  it('round trips a built-in through a file into the local library', () => {
    const store = freshStore()
    const builtIn = getBuiltInTemplate('epithelial-cell')
    const { raw } = parseTemplateText(templateFile(builtIn).text)
    const { template } = store.addLocalTemplate(raw)
    expect({ ...template, id: 'epithelial-cell' }).toEqual(builtIn)
  })
})
