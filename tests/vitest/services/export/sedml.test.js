import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateSedmlData } from '../../../../src/services/export/sedml.js'

const golden = (name) => fs.readFileSync(path.resolve(process.cwd(), 'tests/resources/sedml', name), 'utf8')

describe('generateSedmlData', () => {
  // Written by the export before its settings moved to sedParameters.js; web OpenCOR reads these.
  it.each([
    ['baseline.sedml', { pointInterval: 0.01, startingPoint: 0, endingPoint: 10, initialPoint: 0 }, 'model.cellml'],
    ['custom.sedml', { pointInterval: 0.25, startingPoint: 2, endingPoint: 7.1, initialPoint: 1 }, 'circulation.cellml'],
    // A time field cleared in Simulation Settings is null.
    ['cleared.sedml', { pointInterval: 0.5, startingPoint: null, endingPoint: 4, initialPoint: null }, 'model.cellml'],
  ])('writes %s as it always has', (file, settings, cellmlFileName) => {
    expect(generateSedmlData(settings, cellmlFileName)).toBe(golden(file))
  })
})
