import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readProtocolInfo, readShapeForm } from '../../../../src/services/protocol/protocolModel.js'
import { normaliseShape } from '../../../../src/services/protocol/protocolShapes.js'
import { validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'

const RESOURCES = join(__dirname, '../../../resources/protocols')
const SOURCE = join(__dirname, '../../../../src/services/protocol')

/**
 * Reads a fixture's protocol as PhLynx runs it.
 *
 * @param {string} fileName
 * @returns {Object}
 */
function readFixture(fileName) {
  const { errors, protocolInfo } = validateProtocolInfo(JSON.parse(readFileSync(join(RESOURCES, fileName), 'utf8')).protocol_info)
  expect(errors).toEqual([])
  return readProtocolInfo(protocolInfo)
}

describe('readProtocolInfo', () => {
  it('reads experiments of sub-experiments, timed from the end of the warm-up', () => {
    const { experiments, controls } = readFixture('SN_simple_obs_data.json')
    expect(experiments.map(({ label, colour, preTime, duration }) => ({ label, colour, preTime, duration }))).toEqual([
      { label: 'SHR', colour: 'r', preTime: 1, duration: 3 },
      { label: 'SHR M-activation', colour: 'b', preTime: 1, duration: 3 },
      { label: 'I_ramp', colour: 'g', preTime: 1, duration: 2 },
    ])
    expect(experiments[0].subs).toEqual([
      { start: 0, duration: 1 },
      { start: 1, duration: 2 },
    ])
    expect(controls.map(({ parameter }) => parameter)).toEqual(['soma_SN/I_in', 'soma_SN/g_M'])
    expect(controls[0].cells[0]).toEqual([
      { kind: 'constant', value: 0 },
      { kind: 'constant', value: -0.15 },
    ])
    expect(controls[0].cells[2][1]).toMatchObject({ kind: 'trace', name: 'ramp_port', trace: { t: expect.any(Array) } })
  })

  it('reads a shape as the form it was written in', () => {
    const { controls } = readFixture('br-1977_obs_data.json')
    expect(controls[0].cells[0][0]).toMatchObject({
      kind: 'shape',
      name: 'engine_pace',
      form: { type: 'pacing', baseline: 0, level: 1, start: 100, length: 2, period: 1000, multiplier: 0 },
    })
  })

  it('leaves labels and colours out where the file gives none', () => {
    const { experiments } = readFixture('NKE_pump_obs_data.json')
    expect(experiments).toMatchObject([{ label: 'exp_0', colour: null, id: null, preTime: 1, duration: 280 }])
  })
})

describe('readShapeForm', () => {
  const form = (shape, duration) => readShapeForm(normaliseShape(shape, 's'), duration)

  it('tells steps, pulses, pacing and ramps apart, as CUFLynx offers them', () => {
    expect(form({ baseline: 1, events: [{ level: 2, start: 3, length: 7 }] }, 10)).toEqual({ type: 'step', baseline: 1, level: 2, start: 3 })
    expect(form({ events: [{ level: 2, start: 3, length: 2 }] }, 10)).toEqual({ type: 'pulse', baseline: 0, level: 2, start: 3, end: 5 })
    expect(form({ type: 'ramp', from: 1, to: 2 }, 10)).toEqual({ type: 'ramp', from: 1, to: 2 })
    expect(form({ events: [{ level: 1, length: 1 }, { level: 2, start: 5, length: 1 }] }, 10)).toBeNull()
  })
})

describe('src/services/protocol', () => {
  it('imports nothing from the rest of PhLynx, so it can move to a shared library', () => {
    // Every module specifier: static imports and re-exports (over several lines too), bare imports and dynamic ones.
    const SPECIFIERS = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g
    const files = readdirSync(SOURCE, { recursive: true }).filter((name) => name.endsWith('.js'))
    const imports = files.flatMap((name) =>
      [...readFileSync(join(SOURCE, name), 'utf8').matchAll(SPECIFIERS)].map((match) => [name, match[1] ?? match[2] ?? match[3]])
    )
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter(([, from]) => !/^\.\/[\w/]+\.js$/.test(from))).toEqual([])
    expect(files.some((name) => /\bimport\s*\(\s*[^'"`\s]/.test(readFileSync(join(SOURCE, name), 'utf8')))).toBe(false)
  })
})
