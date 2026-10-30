// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import BioCell from '../../../../src/components/bio/BioCell.vue'
import BioProtein from '../../../../src/components/bio/BioProtein.vue'
import ProteinGlyph from '../../../../src/components/bio/ProteinGlyph.vue'
import { GLYPHS } from '../../../../src/services/bioView/glyphs.js'

describe('physiological view artwork', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each(GLYPHS)('draws the %s cartoon', (glyph) => {
    const svg = mount(ProteinGlyph, { props: { glyph } }).find('svg')
    expect(svg.attributes('data-glyph')).toBe(glyph)
    expect(svg.findAll('.protein-glyph__body').length).toBeGreaterThan(0)
  })

  it('draws a cartoon it doesn’t know as a generic protein', () => {
    expect(mount(ProteinGlyph, { props: { glyph: 'blob' } }).find('svg').attributes('data-glyph')).toBe('generic')
  })

  it('draws an arrow for each species it carries, one way when a run says which, both ways until then', () => {
    const arrows = [
      { label: 'Na⁺', direction: 'out' },
      { label: 'K⁺', direction: 'in' },
      { label: 'Glc', direction: null },
    ]
    const glyph = mount(ProteinGlyph, { props: { glyph: 'pump', rotation: 180, arrows } })
    const drawn = glyph.findAll('.protein-glyph__arrow')
    expect(drawn.map((a) => [a.attributes('data-species'), a.attributes('data-direction'), a.findAll('polygon').length])).toEqual([
      ['Na⁺', 'out', 1],
      ['K⁺', 'in', 1],
      ['Glc', 'both', 2],
    ])
    // Spread across the body.
    const xs = drawn.map((a) => Number(a.find('line').attributes('x1')))
    expect(new Set(xs).size).toBe(3)
    expect(glyph.find('.protein-glyph__atp-label').attributes('transform')).toBe('rotate(-180 52 34)')
  })

  it('names what a protein carries under its name, in the order its arrows show', () => {
    const arrows = [
      { label: 'Glc', direction: null },
      { label: 'Na⁺', direction: null },
    ]
    const species = (rotation) =>
      mount(BioProtein, { props: { data: { name: 'p', glyph: 'symporter', rotation, arrows } } }).find('[data-testid=bio-protein-species]').text()
    expect(species(0)).toBe('Glc · Na⁺')
    // Turned upside down on the basolateral membrane, its arrows read the other way.
    expect(species(180)).toBe('Na⁺ · Glc')
    expect(mount(BioProtein, { props: { data: { name: 'p' } } }).find('[data-testid=bio-protein-species]').exists()).toBe(false)
  })

  it('draws no arrows for a protein whose annotations say nothing it carries', () => {
    expect(mount(ProteinGlyph, { props: { glyph: 'symporter' } }).findAll('.protein-glyph__arrow')).toHaveLength(0)
  })

  it('runs a channel’s arrow down its pore', () => {
    const channel = mount(ProteinGlyph, { props: { glyph: 'channel', arrows: [{ label: 'K⁺', direction: 'out' }] } })
    expect(channel.find('.protein-glyph__arrow line').attributes('x1')).toBe('32')
  })

  it('turns a protein’s cartoon with its facet and puts its name on the cell’s side', () => {
    const data = { name: 'p', glyph: 'pump', rotation: 180, outward: 'bottom' }
    const protein = mount(BioProtein, { props: { data } })
    expect(protein.find('.bio-protein__glyph').attributes('style')).toContain('rotate(180deg)')
    expect(protein.find('[data-testid=bio-protein]').classes()).toContain('bio-protein--label-top')
    expect(protein.find('.bio-protein__label').text()).toBe('p')
  })

  it('draws a cell’s membrane as a bilayer: two rows of head groups either side of its outline', () => {
    const cell = mount(BioCell, { props: { data: { name: 'c' }, width: 300, height: 200 } })
    const heads = cell.findAll('.bio-cell__heads')
    expect(heads).toHaveLength(2)
    // One leaflet just outside the outline, one just inside.
    expect(heads[0].attributes('d')).toMatch(/^M \d+ -7 /)
    expect(heads[1].attributes('d')).toMatch(/^M \d+ 7 /)
    expect(cell.find('.bio-cell__tails').exists()).toBe(true)
  })
})
