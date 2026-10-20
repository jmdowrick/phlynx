import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODULE_FORMAT,
  MODULE_FORMATS,
  MODULE_FORMAT_SVG_ICONS,
  checkMathSource,
  getModuleFormat,
} from '../../../src/services/moduleFormats.js'

describe('module formats', () => {
  it('treats a missing format as CellML', () => {
    for (const id of [undefined, null, '']) expect(getModuleFormat(id)).toBe(MODULE_FORMATS[DEFAULT_MODULE_FORMAT])
    expect(getModuleFormat('cellml').isMathLocked).toBe(false)
  })

  it('locks the math of a CellDL module, which still exports as CellML', () => {
    const format = getModuleFormat('celldl')
    expect(format).toMatchObject({ id: 'celldl', label: 'CellDL', isMathLocked: true, caModuleFormat: 'cellml' })
  })

  it('gives an unknown format a locked, unavailable fallback named after it', () => {
    const format = getModuleFormat('python')
    expect(format).toMatchObject({ id: 'python', label: 'python', isMathLocked: true, isAvailable: false })
    expect(MODULE_FORMAT_SVG_ICONS[format.icon]).toBe(format.svgPath)
  })

  it('does not look formats up on the object prototype', () => {
    expect(getModuleFormat('toString').isMathLocked).toBe(true)
  })

  it('has an SVG path for every format icon', () => {
    for (const format of Object.values(MODULE_FORMATS)) {
      expect(format.svgPath).toMatch(/^M/)
      expect(MODULE_FORMAT_SVG_ICONS[format.icon]).toBe(format.svgPath)
    }
  })

  it('cannot be changed', () => {
    expect(Object.isFrozen(MODULE_FORMATS)).toBe(true)
    expect(Object.isFrozen(MODULE_FORMATS.cellml)).toBe(true)
  })
})

describe('checking a math source', () => {
  const source = { format: 'celldl', document: '<svg/>', documentUri: 'https://example.org/rc.celldl', elements: {} }

  it('keeps a well-formed source as it is, unknown fields too', () => {
    expect(checkMathSource(source)).toBe(source)
    expect(checkMathSource({ ...source, document: null })).not.toBeNull()
    const newer = { ...source, format: 'python', extra: 1 }
    expect(checkMathSource(newer)).toBe(newer)
  })

  it('drops a malformed source', () => {
    for (const bad of [
      null,
      'celldl',
      [],
      { ...source, format: '' },
      { ...source, format: 3 },
      { ...source, document: 1 },
      { ...source, document: undefined },
      { ...source, documentUri: null },
    ]) {
      expect(checkMathSource(bad)).toBeNull()
    }
  })
})
