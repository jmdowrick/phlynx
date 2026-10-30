import { existsSync, readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { guessAnnotations } from '../../../../src/services/annotations/guess.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { classifyRows } from '../../../../src/services/math/variableKinds.js'
import { mergeUnitDefinitions } from '../../../../src/utils/units.js'

// Reports how well the guesser recovers hand-written sidecars, each guessed with its own sidecar stripped and the
// others as the workspace. It logs per-axis accuracy and asserts no threshold; the private set runs only where present.
const FIXTURES = resolve(__dirname, '../../fixtures/annotations')
const PRIVATE = resolve(FIXTURES, 'private')
const read = (...path) => readFileSync(resolve(...path), 'utf8')

const TOY_UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="toy_units">
  <units name="mM"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>
  <units name="fmol_per_mm2_per_s"><unit prefix="femto" units="mole"/><unit prefix="milli" units="metre" exponent="-2"/><unit units="second" exponent="-1"/></units>
  <units name="pL"><unit prefix="pico" units="litre"/></units>
  <units name="mm2"><unit prefix="milli" units="metre" exponent="2"/></units>
  <units name="J_per_C"><unit units="joule"/><unit units="coulomb" exponent="-1"/></units>
</model>`

/**
 * Lists a fixture set's modules with their math and sidecar text.
 *
 * @param {string} folder
 * @param {{ maths: string, sidecars: string }} layout - Subfolders, relative to the set.
 * @returns {Array<{ name: string, cellml: string, sidecarText: string }>}
 */
function listModules(folder, layout) {
  return readdirSync(resolve(folder, layout.sidecars))
    .filter((file) => file.endsWith('.ttl') && existsSync(resolve(folder, layout.maths, file.replace(/\.ttl$/, '.cellml'))))
    .map((file) => {
      const name = file.replace(/\.ttl$/, '')
      return { name, cellml: read(folder, layout.maths, `${name}.cellml`), sidecarText: read(folder, layout.sidecars, file) }
    })
}

/**
 * Guesses every module of a set and scores each axis against its sidecar.
 *
 * @param {Array<{ name: string, cellml: string, sidecarText: string }>} modules
 * @param {string[]} unitModels - Units files' XML.
 * @returns {Promise<Object>} Counts per axis, and the misses.
 */
async function scoreModules(modules, unitModels) {
  const parsed = await Promise.all(
    modules.map(async (module) => ({
      ...module,
      sidecar: await parseSidecar(module.sidecarText, { mathRef: `${module.name}.cellml:${module.name}`, cellml: module.cellml }),
    }))
  )
  const score = { kind: [0, 0], suggested: [0, 0], property: [0, 0], species: [0, 0], location: [0, 0], high: [0, 0], restrained: [0, 0] }
  const misses = []
  for (const module of parsed) {
    const analysis = analyzeMathXml(module.cellml)
    const rows = analysis.declared.map(({ name, units }) => ({ name, units }))
    const unitDefinitions = mergeUnitDefinitions([...unitModels, module.cellml])
    const guess = guessAnnotations({
      rows,
      kinds: classifyRows(analysis, rows),
      analysis,
      componentName: analysis.componentName,
      unitDefinitions,
      sidecar: null,
      workspaceSidecars: parsed.filter((other) => other !== module).map((other) => other.sidecar),
    })
    const tally = (axis, isRight, detail) => {
      score[axis][0] += isRight ? 1 : 0
      score[axis][1] += 1
      if (!isRight) misses.push(`${module.name}${detail}: ${axis}`)
    }
    tally('kind', guess.componentKind.kind === module.sidecar.component?.kind, '')
    const annotated = new Set(module.sidecar.variables.map((entry) => entry.variable))
    for (const [name, suggestion] of guess.variables) {
      if (annotated.has(name)) continue
      score.restrained[0] += suggestion.confidence === 'high' ? 0 : 1
      score.restrained[1] += 1
      if (suggestion.confidence === 'high') misses.push(`${module.name}.${name}: confident but unannotated`)
    }
    for (const entry of module.sidecar.variables) {
      const suggestion = guess.variables.get(entry.variable)
      tally('suggested', !!suggestion, `.${entry.variable}`)
      if (!suggestion) continue
      tally('property', suggestion.property === entry.property, `.${entry.variable}`)
      tally('species', JSON.stringify([...suggestion.species].sort()) === JSON.stringify([...entry.species].sort()), `.${entry.variable}`)
      tally('location', suggestion.location === entry.location, `.${entry.variable}`)
      if (suggestion.confidence === 'high') {
        const isRight =
          suggestion.property === entry.property &&
          suggestion.location === entry.location &&
          JSON.stringify([...suggestion.species].sort()) === JSON.stringify([...entry.species].sort())
        tally('high', isRight, `.${entry.variable}`)
      }
    }
  }
  return { score, misses }
}

/**
 * Logs a score as one line per axis.
 *
 * @param {string} title
 * @param {{ score: Object, misses: string[] }} result
 */
function logScore(title, { score, misses }) {
  const lines = Object.entries(score).map(([axis, [right, total]]) => {
    const percent = total ? Math.round((100 * right) / total) : 0
    return `  ${axis.padEnd(10)} ${right}/${total} (${percent}%)`
  })
  console.log([`Guess accuracy, ${title}:`, ...lines, misses.length ? `  misses: ${misses.join(', ')}` : ''].join('\n'))
}

describe('guess accuracy report', () => {
  it('scores the toy sidecars', async () => {
    const result = await scoreModules(listModules(resolve(FIXTURES, 'toy'), { maths: '.', sidecars: '.' }), [TOY_UNITS])
    logScore('toy', result)
    expect(result.score.kind[1]).toBe(3)
  })

  it.skipIf(!existsSync(resolve(PRIVATE, 'sidecars')))('scores the private sidecars', async () => {
    const unitModels = readdirSync(resolve(PRIVATE, 'units')).map((file) => read(PRIVATE, 'units', file))
    const result = await scoreModules(listModules(PRIVATE, { maths: 'maths', sidecars: 'sidecars' }), unitModels)
    logScore('private', result)
    expect(result.score.kind[1]).toBeGreaterThan(0)
  })
})
