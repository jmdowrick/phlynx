// The CellDL Parameters tab's rows, from the enzyme diagram as the CellDL editor lists it and as bg2cellml converts
// it (fixtures/celldl/enzyme_canonical.*.json, taken from the app).
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildElementTable,
  elementValues,
  findClashes,
  hasOwnNaming,
  isChemicalDomain,
  isDefaultValue,
  linkJunctions,
  sectionOf,
  structureEdits,
  templateLabel,
  typeOptions,
  unsetReasons,
} from '../../../../src/services/celldl/elementTable.js'

const read = (name) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/celldl', name), 'utf8'))
const ELEMENTS = read('enzyme_canonical.elements.json')
const { manifest: MANIFEST, rows: ROWS, defaults: DEFAULTS } = read('enzyme_canonical.module.json')

const CHEMICAL = 'https://bg-rdf.org/ontologies/bondgraph-framework#Chemical'
const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
const byId = (id, elements = ELEMENTS) => elements.find((element) => element.id === id)
const rowsByName = (rows = ROWS) => new Map(rows.map((row) => [row.name, { ...row }]))
const freshRows = () => ROWS.map((row) => ({ ...row }))
const STORE_S = 'ID-00000001'
const JUNCTION_S = 'ID-00000002'
const REACTION_R1 = 'ID-00000006'

/** The element with some fields changed. */
const edit = (id, fields, elements = ELEMENTS) =>
  elements.map((element) => (element.id === id ? { ...element, ...fields } : element))

describe('the CellDL Parameters table', () => {
  describe('grouping', () => {
    it('puts stores, reactions and junctions in their sections', () => {
      expect(sectionOf(byId(STORE_S))).toBe('stores')
      expect(sectionOf(byId(REACTION_R1))).toBe('reactions')
      expect(sectionOf(byId(JUNCTION_S))).toBe('junctions')
      expect(sectionOf(byId('ID-00000005'))).toBe('junctions')
      // Before its type is chosen, a store has no initial value, but its kind says what it is.
      const untyped = { ...byId(STORE_S), template: undefined, value: undefined, parameters: [] }
      expect(sectionOf(untyped)).toBe('stores')
      expect(linkJunctions(ELEMENTS.map((element) => (element.id === STORE_S ? untyped : element))).get(STORE_S)).toBe(JUNCTION_S)
    })

    it("links each store to the 0-junction it alone is bonded to, and lists it under the store", () => {
      const links = linkJunctions(ELEMENTS)
      expect(links.get(STORE_S)).toBe(JUNCTION_S)
      expect(links.get('ID-00000003')).toBe('ID-00000004')
      expect(links.get('ID-00000014')).toBe('ID-00000013')
      expect(links.size).toBe(4)

      const table = buildElementTable({ elements: ELEMENTS, manifest: MANIFEST, rows: ROWS })
      const stores = table.sections.find((section) => section.key === 'stores')
      expect(stores.rows.map((row) => [row.id, row.depth])).toEqual([
        [STORE_S, 0],
        [JUNCTION_S, 1],
        ['ID-00000003', 0],
        ['ID-00000004', 1],
        ['ID-00000008', 0],
        ['ID-00000009', 1],
        ['ID-00000014', 0],
        ['ID-00000013', 1],
      ])
      const junctions = table.sections.find((section) => section.key === 'junctions')
      expect(junctions.rows.map((row) => row.id)).toEqual(['ID-00000005', 'ID-00000007', 'ID-00000010', 'ID-00000012'])
    })

    it("doesn't link a 0-junction bonded to two stores", () => {
      const elements = edit(JUNCTION_S, { neighbours: [STORE_S, 'ID-00000003'] })
      expect(linkJunctions(elements).has(STORE_S)).toBe(false)
    })

    it("lists the model's own constants, but not a renamed element's old rows", () => {
      const table = buildElementTable({
        elements: edit(STORE_S, { species: 'Glc' }),
        manifest: null,
        namesManifest: renamedManifest(),
        rows: ROWS,
        savedDefaults: new Map(DEFAULTS),
        savedManifest: MANIFEST,
      })
      const constants = table.sections.find((section) => section.key === 'constants')
      expect(constants.rows.map((row) => row.names[0])).toEqual(['RT', 'F'])
      expect(constants.rows[1].values[0]).toMatchObject({ name: 'F', defaultValue: '96485', units: 'C_per_mol' })
    })
  })

  describe('types', () => {
    it("offers chemistry's templates only, and all with the filter off, without IRIs", () => {
      const reaction = byId(REACTION_R1)
      const unfiltered = { ...reaction, templates: [...reaction.templates, { type: `${BGF}Resistor`, name: 'Resistor', domain: `${BGF}Electrical` }] }

      const chemistry = typeOptions(unfiltered)
      expect(chemistry.options.map((option) => option.label)).toEqual(['Reaction element', 'NKETransporter', 'Chemical reaction'])
      expect(chemistry.value).toBe(`${BGF}ChemicalReaction`)
      expect(chemistry.isHidingSome).toBe(true)

      const all = typeOptions(unfiltered, { chemistryOnly: false })
      expect(all.options.map((option) => option.label)).toContain('Resistor')
      expect(all.isHidingSome).toBe(false)
      expect(isChemicalDomain(CHEMICAL)).toBe(true)
      expect(isChemicalDomain(`${BGF}Electrical`)).toBe(false)
      expect(templateLabel({ type: `${BGF}X`, name: `${BGF}NKETransporter` })).toBe('NKETransporter')
    })

    it('asks for a type while an element has none', () => {
      const untyped = { ...byId(STORE_S), template: undefined, templateName: undefined }
      const { options, value } = typeOptions(untyped)
      expect(options[0]).toEqual({ value: untyped.kind, label: 'Choose a type' })
      expect(value).toBe(untyped.kind)
      expect(unsetReasons(untyped, [])).toContain('No type chosen')
    })
  })

  describe('values', () => {
    it("maps an element's initial value and parameters to the instance's rows by their generated names", () => {
      const rows = rowsByName()
      const [initial, K] = elementValues(byId(STORE_S), MANIFEST[STORE_S], rows)
      expect(initial).toMatchObject({ key: 'value', name: 'q_S_c_init', defaultValue: '1', units: 'mole' })
      expect(initial.row).toBe(rows.get('q_S_c_init'))
      expect(K).toMatchObject({ key: 'parameter:K', label: 'K', name: 'K_q_S_c', defaultValue: '1', units: 'per_mol' })

      const [kappa] = elementValues(byId(REACTION_R1), MANIFEST[REACTION_R1], rows)
      expect(kappa).toMatchObject({ key: 'parameter:kappa', name: 'kappa_Rx_r1_c', defaultValue: '10' })
      expect(elementValues(byId(JUNCTION_S), MANIFEST[JUNCTION_S], rows)).toEqual([])
    })

    it("names a renamed element's variables from the manifest, with no row until the diagram is saved", () => {
      const [, K] = elementValues({ ...byId(STORE_S), species: 'Glc' }, renamedManifest()[STORE_S], rowsByName())
      expect(K).toMatchObject({ name: 'K_q_Glc_c', row: null, defaultValue: '1', units: 'mol-1' })
    })

    it('counts a value as the default while blank, or on the diagram or saved value', () => {
      const cell = { name: 'kappa_Rx_r1_c', defaultValue: '10', row: { value: '' } }
      const saved = new Map([['kappa_Rx_r1_c', '5']])
      expect(isDefaultValue(cell, saved)).toBe(true)
      expect(isDefaultValue({ ...cell, row: { value: '10.0' } }, saved)).toBe(true)
      // The diagram's value changed in its Properties panel since the save, and the row is on the saved one.
      expect(isDefaultValue({ ...cell, row: { value: '5' } }, saved)).toBe(true)
      expect(isDefaultValue({ ...cell, row: { value: '2' } }, saved)).toBe(false)
    })

    it('flags a value with neither its own nor a default', () => {
      const element = byId(REACTION_R1)
      const values = [{ label: 'kappa', name: 'kappa_Rx_r1_c', row: { value: '' }, defaultValue: '' }]
      expect(unsetReasons(element, values)).toEqual(['No value for kappa'])
      expect(unsetReasons(element, [{ ...values[0], defaultValue: '10' }])).toEqual([])
    })
  })

  describe('flags', () => {
    it("flags the default species and location", () => {
      const fresh = { ...byId(STORE_S), species: 'i', location: 'j' }
      expect(unsetReasons(fresh, [])).toEqual(['Species is still the default, i', 'Location is still the default, j'])
      const table = buildElementTable({ elements: edit(STORE_S, { species: 'i' }), manifest: MANIFEST, rows: ROWS })
      expect(table.unsetCount).toBe(1)
      expect(table.rowsById.get(STORE_S).unset).toHaveLength(1)
    })

    it("flags elements the manifest gives the same names, junctions too, and clears once fixed", () => {
      const manifest = renamedManifest({ [STORE_S]: 'E', [JUNCTION_S]: 'E' })
      const clashes = findClashes(ELEMENTS, manifest)
      expect([...clashes.keys()].sort()).toEqual([STORE_S, JUNCTION_S, 'ID-00000003', 'ID-00000004'].sort())
      expect(clashes.get(STORE_S)).toEqual({ otherIds: ['ID-00000003'], name: 'q_E_c' })
      expect(clashes.get(JUNCTION_S)).toEqual({ otherIds: ['ID-00000004'], name: 'u_E_c' })
      expect(findClashes(ELEMENTS, MANIFEST).size).toBe(0)
    })

    it('flags two of a kind with the same symbol, species and location before any manifest', () => {
      const elements = edit(STORE_S, { species: 'E' })
      const clashes = findClashes(elements, null)
      expect([...clashes.keys()].sort()).toEqual([STORE_S, 'ID-00000003'])
      expect(clashes.get(STORE_S).name).toBe('q_E_c')
      // A store and its junction share species and location, but not a kind.
      expect(findClashes(ELEMENTS, null).size).toBe(0)
    })
  })

  describe('junctions following their store', () => {
    const store = byId(STORE_S)
    const junction = byId(JUNCTION_S)

    it("renames the junction with its store when it is on the store's old name or the default", () => {
      expect(structureEdits(store, 'species', 'Glc', { junction })).toEqual([
        { id: STORE_S, field: 'species', value: 'Glc' },
        { id: JUNCTION_S, field: 'species', value: 'Glc' },
      ])
      expect(structureEdits(store, 'location', 'm', { junction: { ...junction, location: 'j' } })).toEqual([
        { id: STORE_S, field: 'location', value: 'm' },
        { id: JUNCTION_S, field: 'location', value: 'm' },
      ])
    })

    it('leaves a junction with its own name, or with following off, and sends nothing for no change', () => {
      const own = { ...junction, species: 'Sx' }
      expect(structureEdits(store, 'species', 'Glc', { junction: own })).toEqual([{ id: STORE_S, field: 'species', value: 'Glc' }])
      expect(hasOwnNaming(own, store)).toBe(true)
      expect(hasOwnNaming(junction, store)).toBe(false)
      expect(structureEdits(store, 'species', 'Glc', { junction, follow: false })).toHaveLength(1)
      expect(structureEdits(store, 'species', 'S', { junction })).toEqual([])
    })
  })
})

/**
 * The manifest as bg2cellml would give it with elements' species changed.
 *
 * @param {Object<string, string>} [species] - New species by element id; S becomes Glc by default.
 */
function renamedManifest(species = { [STORE_S]: 'Glc', [JUNCTION_S]: 'Glc' }) {
  const manifest = structuredClone(MANIFEST)
  for (const [id, name] of Object.entries(species)) {
    const entry = manifest[id]
    const rename = (text) => text.replace(/_S_c$/, `_${name}_c`)
    entry.symbol = rename(entry.symbol)
    entry.primary = rename(entry.primary)
    entry.variables = entry.variables.map((variable) => ({
      ...variable,
      name: rename(variable.name),
      units: variable.role === 'parameter' ? 'mol-1' : variable.units,
    }))
  }
  return manifest
}
