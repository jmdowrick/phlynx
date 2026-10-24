import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'

// Unpublished enterocyte fixtures, gitignored: the test runs only where they are present.
const PRIVATE = resolve(__dirname, '../../fixtures/annotations/private')
const MODULES = ['compartment', 'membrane', 'SGLT1', 'GLUT2', 'NKA', 'Kir']
const read = (...path) => readFileSync(resolve(PRIVATE, ...path), 'utf8')

describe.skipIf(!existsSync(PRIVATE))('enterocyte fixtures (private)', () => {
  it('parses the enterocyte ApiCoords: nine instances, no warnings', async () => {
    const { instances, warnings } = await parseApiCoords(read('apicoords_Modular_Enterocyte_20261021T200342Z.ttl'))
    expect(warnings).toEqual([])
    expect(instances.map((instance) => instance.name).sort()).toEqual(
      ['GLUT2_api', 'GLUT2_bas', 'Kir', 'Membrane', 'NKA', 'SGLT1', 'capillary', 'enterocyte', 'lumen'].sort()
    )
    const kinds = Object.fromEntries(instances.map((instance) => [instance.name, instance.coord.kind]))
    expect(kinds).toMatchObject({
      lumen: 'layer',
      enterocyte: 'cell',
      Membrane: 'facet-layer',
      capillary: 'lyph',
      NKA: 'deployment',
    })
  })

  it.each(MODULES)('parses the %s sidecar against its math with no warnings', async (name) => {
    const sidecar = await parseSidecar(read('sidecars', `${name}.ttl`), {
      mathRef: `${name}.cellml:${name}`,
      cellml: read('maths', `${name}.cellml`),
    })
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.component.kind).toBe(
      name === 'compartment' ? 'compartment' : name === 'membrane' ? 'membrane' : 'transporter'
    )
    expect(sidecar.variables.length).toBeGreaterThan(0)
    for (const entry of sidecar.variables) {
      expect(entry.property, entry.variable).toMatch(/^OPB:/)
      expect(entry.location, entry.variable).toBeTruthy()
    }
  })
})
