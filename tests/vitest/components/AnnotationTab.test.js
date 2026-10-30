// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AutoComplete from 'primevue/autocomplete'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AnnotationTab from '../../../src/components/annotations/AnnotationTab.vue'
import AnnotationChips from '../../../src/components/AnnotationChips.vue'
import { createAnnotationDraft } from '../../../src/services/annotations/draft.js'
import { parseSidecar } from '../../../src/services/annotations/sidecar.js'
import { LookupUnavailableError } from '../../../src/services/ontology/ols.js'
import { mergeUnitDefinitions } from '../../../src/utils/units.js'
import { resetTermCache } from '../../../src/services/ontology/termCache.js'
import { createMemoryStorage } from '../helpers/memoryStorage.js'

const MATH_REF = 'file:decay'
const SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix opb: <http://identifiers.org/opb/OPB_> .
@prefix chebi: <http://purl.obolibrary.org/obo/CHEBI_> .
@prefix go: <http://purl.obolibrary.org/obo/GO_> .
@prefix sbo: <http://purl.obolibrary.org/obo/SBO_> .
@prefix m: <./file#> .
m:decay bqbiol:is sbo:0000290 ; dcterms:description "A pool" .
m:decay.x bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 , go:0005737 ] .
`
const ROWS = [
  { name: 't', units: 'second' },
  { name: 'x', units: 'mM' },
  { name: 'k', units: 'per_second', type: 'constant' },
  { name: 'J', units: 'mol_per_s' },
]
const KINDS = new Map([
  ['t', 'voi'],
  ['x', 'state'],
  ['k', 'constant'],
  ['J', 'algebraic'],
])

let wrapper
beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('No network in tests')
    })
  )
  resetTermCache()
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * Mounts the tab on the test sidecar, keeping its draft in step with what it emits.
 *
 * @param {Object} [props]
 * @returns {Promise<import('@vue/test-utils').VueWrapper>}
 */
async function mountTab(props = {}) {
  const sidecar = await parseSidecar(SIDECAR, { mathRef: MATH_REF })
  wrapper = mount(AnnotationTab, {
    props: {
      rows: ROWS,
      variableKinds: KINDS,
      sidecar,
      sidecarText: SIDECAR,
      draft: createAnnotationDraft(),
      mathRef: MATH_REF,
      'onUpdate:draft': (draft) => wrapper.setProps({ draft }),
      ...props,
    },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  return wrapper
}

const shownVariables = () => wrapper.findAll('.annotation-row').map((row) => row.attributes('data-variable'))
const rowOf = (name) => wrapper.find(`.annotation-row[data-variable="${name}"]`)

describe('AnnotationTab', () => {
  it('lists variables but not the VoI, and constants only when asked', async () => {
    await mountTab()
    expect(shownVariables()).toEqual(['x', 'J'])

    await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)
    expect(shownVariables()).toEqual(['x', 'k', 'J'])
  })

  it('shows an annotated variable as chips, and the others as Annotate…', async () => {
    await mountTab()
    expect(rowOf('x').findComponent(AnnotationChips).exists()).toBe(true)
    expect(rowOf('J').find('[data-test="annotate"]').exists()).toBe(true)
  })

  it('filters the rows by whether they are annotated', async () => {
    await mountTab()
    await wrapper.findComponent('[data-test="filter"]').vm.$emit('update:modelValue', 'unannotated')
    expect(shownVariables()).toEqual(['J'])
  })

  it('reads the module kind from the sidecar and drafts a change of it', async () => {
    await mountTab()
    const kind = wrapper.findComponent('[data-test="module-kind"]')
    expect(kind.props('modelValue')).toBe('compartment')

    await kind.vm.$emit('update:modelValue', 'membrane')
    expect(wrapper.props('draft').componentKind).toBe('membrane')

    await kind.vm.$emit('update:modelValue', 'compartment')
    expect(wrapper.props('draft').componentKind).toBeUndefined()
  })

  it('takes a transporter’s UniProt accession only once it is valid', async () => {
    await mountTab()
    await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
    const accession = () => wrapper.find('[data-test="uniprot-accession"]')
    expect(accession().classes()).toContain('p-invalid')

    await accession().find('input').setValue('not an accession')
    expect(wrapper.props('draft').transporter).toBeUndefined()
    expect(accession().classes()).toContain('p-invalid')

    await accession().find('input').setValue('p11168')
    expect(wrapper.props('draft')).toMatchObject({ componentKind: 'transporter', transporter: 'uniprot:P11168' })
  })

  it('drafts an annotation from the inline editor, and derives its role and port', async () => {
    await mountTab({ portStatus: new Map() })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const editor = wrapper.find('[data-test="annotation-editor"]')

    await editor.findComponent(Select).vm.$emit('update:modelValue', 'OPB:00592')
    await editor.findComponent('[data-test="location"]').vm.$emit('update:modelValue', 'GO:0005737')
    await editor.findComponent(AutoComplete).vm.$emit('update:modelValue', [{ curie: 'CHEBI:29101', label: 'Na⁺' }])
    expect(editor.find('[data-test="derived"]').text()).toMatch(/contributor · basicport · port will be created/)

    await editor.find('[data-test="done"]').trigger('click')
    expect(wrapper.props('draft').variables.get('J')).toEqual({
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
    })
    expect(rowOf('J').findComponent(AnnotationChips).exists()).toBe(true)
  })

  it('reads typed species text as a pasted ChEBI term, and drops text that is not one', async () => {
    await mountTab()
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    await species.vm.$emit('update:modelValue', ['chebi_29101', 'sodium'])
    expect(species.props('modelValue').map((item) => item.curie)).toEqual(['CHEBI:29101'])
  })

  it('offers only the six coupling properties and the five places', async () => {
    await mountTab()
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const editor = wrapper.find('[data-test="annotation-editor"]')
    expect(editor.findComponent(Select).props('options').map((option) => option.value)).toEqual([
      'OPB:00340',
      'OPB:00592',
      'OPB:00154',
      'OPB:00295',
      'OPB:00506',
      'OPB:00318',
    ])
    expect(editor.findComponent('[data-test="location"]').props('options').map((option) => option.value)).toEqual([
      'self',
      'self+GO:0005886',
      'GO:0005737',
      'GO:0005576',
      'GO:0005886',
    ])
  })

  it('finds species in the workspace and the table, and takes a pasted ChEBI IRI', async () => {
    await mountTab({ workspaceTerms: ['CHEBI:29108'] })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    await species.vm.$emit('complete', { query: '' })
    await flushPromises()
    expect(species.props('suggestions')[0]).toMatchObject({ curie: 'CHEBI:29108', source: 'workspace' })

    await species.vm.$emit('complete', { query: 'http://purl.obolibrary.org/obo/CHEBI_17996' })
    await flushPromises()
    expect(species.props('suggestions')[0]).toMatchObject({ curie: 'CHEBI:17996', source: 'pasted' })

    await species.vm.$emit('complete', { query: 'GO:0005737' })
    await flushPromises()
    expect(species.props('suggestions')).toEqual([])
  })

  it('searches species with the search it is given', async () => {
    const findSpeciesTerms = async (query) => [{ curie: 'CHEBI:1', label: query }]
    await mountTab({ findSpeciesTerms })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    await species.vm.$emit('complete', { query: 'remote' })
    await flushPromises()
    expect(species.props('suggestions')).toEqual([{ curie: 'CHEBI:1', label: 'remote' }])
  })

  it('adds ChEBI results after the local ones, with an obsolete badge', async () => {
    vi.useFakeTimers()
    const searchRemoteSpecies = vi.fn(async () => [
      { curie: 'CHEBI:29101', label: 'sodium(1+)' },
      { curie: 'CHEBI:26708', label: 'sodium atom', isObsolete: true },
    ])
    await mountTab({ searchRemoteSpecies })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    species.vm.$emit('complete', { query: 'sodium' })
    await vi.advanceTimersByTimeAsync(0)
    expect(species.props('suggestions').map((item) => item.curie)).toEqual(['CHEBI:29101'])

    await vi.advanceTimersByTimeAsync(300)
    expect(searchRemoteSpecies).toHaveBeenCalledTimes(1)
    expect(searchRemoteSpecies.mock.calls[0][0]).toBe('sodium')
    expect(species.props('suggestions')).toEqual([
      expect.objectContaining({ curie: 'CHEBI:29101', source: 'table' }),
      { curie: 'CHEBI:26708', label: 'sodium atom', isObsolete: true, source: 'chebi' },
    ])
  })

  it('searches online only for typed words, not pasted terms or short text', async () => {
    vi.useFakeTimers()
    const searchRemoteSpecies = vi.fn(async () => [])
    await mountTab({ searchRemoteSpecies, lookupSpeciesTerm: async () => null })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    species.vm.$emit('complete', { query: 'na' })
    species.vm.$emit('complete', { query: 'CHEBI:29101' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(searchRemoteSpecies).not.toHaveBeenCalled()
  })

  it('says the online lookup is unavailable but keeps the local species', async () => {
    vi.useFakeTimers()
    const searchRemoteSpecies = async () => {
      throw new LookupUnavailableError('Offline')
    }
    await mountTab({ searchRemoteSpecies })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    species.vm.$emit('complete', { query: 'potassium' })
    await vi.advanceTimersByTimeAsync(300)
    expect(species.props('suggestions').map((item) => item.curie)).toEqual(['CHEBI:29103'])
    expect(wrapper.vm.$.setupState.speciesLookup).toBe('unavailable')
  })

  it('labels a pasted species from its online lookup', async () => {
    const lookupSpeciesTerm = vi.fn(async () => ({ label: 'remote label', isObsolete: true }))
    await mountTab({ lookupSpeciesTerm })
    await rowOf('J').find('[data-test="annotate"]').trigger('click')
    const species = wrapper.findComponent(AutoComplete)

    await species.vm.$emit('complete', { query: 'CHEBI:4167' })
    await flushPromises()
    expect(lookupSpeciesTerm).toHaveBeenCalledWith('CHEBI:4167')
    expect(species.props('suggestions')[0]).toMatchObject({ curie: 'CHEBI:4167', label: 'remote label', isObsolete: true })
  })

  it('offers reviewed UniProt entries for the transporter and takes the chosen accession', async () => {
    vi.useFakeTimers()
    const searchProteins = vi.fn(async () => [
      { curie: 'uniprot:P13866', accession: 'P13866', label: 'Sodium/glucose cotransporter 1', gene: 'SLC5A1', organism: 'Homo sapiens' },
    ])
    await mountTab({ searchProteins })
    await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
    const accession = wrapper.findComponent('[data-test="uniprot-accession"]')

    accession.vm.$emit('complete', { query: 'sglt1' })
    await vi.advanceTimersByTimeAsync(300)
    expect(accession.props('suggestions').map((entry) => entry.accession)).toEqual(['P13866'])

    await accession.vm.$emit('update:modelValue', accession.props('suggestions')[0])
    expect(wrapper.props('draft')).toMatchObject({ componentKind: 'transporter', transporter: 'uniprot:P13866' })
  })

  it('keeps a typed accession when UniProt is unavailable', async () => {
    vi.useFakeTimers()
    const searchProteins = async () => {
      throw new LookupUnavailableError('Timed out')
    }
    await mountTab({ searchProteins })
    await wrapper.findComponent('[data-test="module-kind"]').vm.$emit('update:modelValue', 'transporter')
    const accession = wrapper.findComponent('[data-test="uniprot-accession"]')

    accession.vm.$emit('complete', { query: 'P11168' })
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.vm.$.setupState.proteinLookup).toBe('unavailable')

    await accession.vm.$emit('update:modelValue', 'P11168')
    expect(wrapper.props('draft').transporter).toBe('uniprot:P11168')
  })

  it('clears an annotation in the draft', async () => {
    await mountTab()
    await rowOf('x').find('[data-test="clear-annotation"]').trigger('click')
    expect(wrapper.props('draft').variables.get('x')).toBeNull()
    expect(rowOf('x').find('[data-test="annotate"]').exists()).toBe(true)
  })

  it('lists the triples it does not edit as other annotations', async () => {
    await mountTab()
    await flushPromises()
    const other = wrapper.find('[data-test="other-annotations"]')
    expect(other.find('summary').text()).toBe('Other annotations (1)')
    expect(other.text()).toContain('dcterms:description "A pool"')
  })

  it('shows the shared banner and the unbound hint only when they apply', async () => {
    await mountTab({ sharedCount: 3 })
    expect(wrapper.find('[data-test="shared-banner"]').text()).toContain('Shared by 3 instances')
    expect(wrapper.find('[data-test="unbound-hint"]').exists()).toBe(true)

    await wrapper.setProps({ sharedCount: 1, isBound: true })
    expect(wrapper.find('[data-test="shared-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="unbound-hint"]').exists()).toBe(false)
  })
})

describe('AnnotationTab suggestions', () => {
  const UNIT_DEFINITIONS = mergeUnitDefinitions([
    `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
      <units name="mM"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>
      <units name="mol_per_s"><unit units="mole"/><unit units="second" exponent="-1"/></units>
    </model>`,
  ])
  const PORTER_ROWS = [
    { name: 't', units: 'second' },
    { name: 'c_Na_i', units: 'mM' },
    { name: 'c_Na_o', units: 'mM' },
    { name: 'J_Na_i', units: 'mol_per_s' },
    { name: 'J_Na_o', units: 'mol_per_s' },
    { name: 'c_ATP', units: 'mM' },
    { name: 'k', units: 'per_second', type: 'constant' },
  ]
  const PORTER_KINDS = new Map([
    ['t', 'voi'],
    ['c_Na_i', 'external'],
    ['c_Na_o', 'external'],
    ['J_Na_i', 'algebraic'],
    ['J_Na_o', 'algebraic'],
    ['c_ATP', 'external'],
    ['k', 'constant'],
  ])

  /**
   * Mounts the tab on a transporter's math with no sidecar yet.
   *
   * @param {Object} [props]
   * @returns {import('@vue/test-utils').VueWrapper}
   */
  async function mountPorter(props = {}) {
    wrapper = mount(AnnotationTab, {
      props: {
        rows: PORTER_ROWS,
        variableKinds: PORTER_KINDS,
        sidecar: null,
        draft: createAnnotationDraft(),
        mathRef: 'file:porter',
        unitDefinitions: UNIT_DEFINITIONS,
        'onUpdate:draft': (draft) => wrapper.setProps({ draft }),
        ...props,
      },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
    })
    await flushPromises()
    return wrapper
  }

  const ghostChips = (name) => rowOf(name).findAll('[data-test="ghost-chip"]').map((chip) => chip.attributes('data-slot'))

  it('shows each guess as ghost chips with its confidence, in place of Annotate…', async () => {
    await mountPorter()
    expect(ghostChips('J_Na_i')).toEqual(['species', 'property', 'location'])
    expect(rowOf('J_Na_i').find('[data-test="confidence"]').classes()).toContain('annotation-confidence--high')
    expect(rowOf('J_Na_i').find('[data-test="annotate"]').exists()).toBe(false)
    expect(rowOf('c_ATP').find('[data-test="confidence"]').classes()).toContain('annotation-confidence--medium')
    expect(ghostChips('c_ATP')).toEqual(['species', 'property'])
  })

  it('suggests the module kind with its reason, and drafts it when accepted', async () => {
    await mountPorter()
    expect(wrapper.find('[data-test="kind-suggestion"]').text()).toContain('Suggested: Transporter')
    await wrapper.find('[data-test="accept-kind"]').trigger('click')
    expect(wrapper.props('draft').componentKind).toBe('transporter')
    expect(wrapper.find('[data-test="kind-suggestion"]').exists()).toBe(false)
  })

  it('accepts a whole suggestion, or one slot by its chip', async () => {
    await mountPorter()
    await rowOf('J_Na_i').find('[data-test="accept-suggestion"]').trigger('click')
    expect(wrapper.props('draft').variables.get('J_Na_i')).toEqual({
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
    })

    await rowOf('c_Na_o').find('[data-slot="property"]').trigger('click')
    expect(wrapper.props('draft').variables.get('c_Na_o')).toEqual({ property: 'OPB:00340', species: [], location: null })
    expect(rowOf('c_Na_o').findComponent(AnnotationChips).exists()).toBe(true)
    expect(ghostChips('c_Na_o')).toEqual(['species', 'location'])
  })

  it('dismisses a suggestion until the tab opens on another math', async () => {
    await mountPorter()
    await rowOf('c_ATP').find('[data-test="dismiss-suggestion"]').trigger('click')
    expect(rowOf('c_ATP').find('[data-test="suggestion"]').exists()).toBe(false)
    expect(rowOf('c_ATP').find('[data-test="annotate"]').exists()).toBe(true)
    expect(wrapper.props('draft').variables.size).toBe(0)
  })

  it('accepts every confident suggestion at once, and only those', async () => {
    await mountPorter()
    const acceptAll = wrapper.find('[data-test="accept-all"]')
    expect(acceptAll.text()).toBe('Accept 4 confident suggestions')

    await acceptAll.trigger('click')
    expect([...wrapper.props('draft').variables.keys()].sort()).toEqual(['J_Na_i', 'J_Na_o', 'c_Na_i', 'c_Na_o'])
    expect(wrapper.props('draft').variables.get('c_Na_o').location).toBe('GO:0005576')
    expect(wrapper.find('[data-test="accept-all"]').exists()).toBe(false)
  })

  it('filters to the suggested rows', async () => {
    await mountPorter()
    await wrapper.findComponent('[data-test="filter"]').vm.$emit('update:modelValue', 'suggested')
    expect(shownVariables()).toEqual(['c_Na_i', 'c_Na_o', 'J_Na_i', 'J_Na_o', 'c_ATP'])
  })

  it('opens the editor filled from the suggestion', async () => {
    await mountPorter()
    await rowOf('J_Na_o').find('[data-test="edit-annotation"]').trigger('click')
    const editor = wrapper.find('[data-test="annotation-editor"]')
    expect(editor.findComponent(Select).props('modelValue')).toBe('OPB:00592')
    expect(editor.findComponent('[data-test="location"]').props('modelValue')).toBe('GO:0005576')
  })

  it('warns when a property disagrees with the units, in the editor and on the row', async () => {
    await mountPorter()
    await rowOf('J_Na_i').find('[data-test="edit-annotation"]').trigger('click')
    const editor = wrapper.find('[data-test="annotation-editor"]')
    expect(editor.find('[data-test="form-units-lint"]').exists()).toBe(false)

    await editor.findComponent(Select).vm.$emit('update:modelValue', 'OPB:00340')
    expect(editor.find('[data-test="form-units-lint"]').text()).toContain('mol_per_s is not, which is an amount flow')

    await editor.find('[data-test="done"]').trigger('click')
    expect(rowOf('J_Na_i').find('[data-test="units-lint"]').exists()).toBe(true)
  })
})
