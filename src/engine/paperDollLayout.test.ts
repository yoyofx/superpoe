import { describe, expect, it } from 'vitest'
import {
  fitPaperDoll,
  getActivePaperDollSlots,
  getPaperDollSlotsForWeaponSet,
  PAPER_DOLL_DISPLAY_HEIGHT,
  PAPER_DOLL_HEIGHT,
  PAPER_DOLL_SLOTS,
  PAPER_DOLL_WEAPON_SET_CONTROLS,
  PAPER_DOLL_VIEW_BOTTOM,
  PAPER_DOLL_VIEW_TOP,
  PAPER_DOLL_WIDTH,
} from '@/engine/paperDollLayout'

describe('paper doll layout', () => {
  it('keeps the native artboard ratio when width or height constrains it', () => {
    for (const [width, height] of [[900, 900], [600, 400], [400, 900]]) {
      const fitted = fitPaperDoll(width, height)
      expect(fitted.width / fitted.height).toBeCloseTo(PAPER_DOLL_WIDTH / PAPER_DOLL_DISPLAY_HEIGHT, 8)
      expect(fitted.width).toBeLessThanOrEqual(Math.min(width, PAPER_DOLL_WIDTH))
      expect(fitted.height).toBeLessThanOrEqual(height)
    }
  })

  it('scales with the window until reaching the native asset size', () => {
    const medium = fitPaperDoll(1200, 1200)
    const large = fitPaperDoll(2000, 2000)

    expect(medium.width).toBe(1200)
    expect(large.width).toBe(PAPER_DOLL_WIDTH)
    expect(large.height).toBe(PAPER_DOLL_DISPLAY_HEIGHT)
  })

  it('defines unique slots entirely inside the source image', () => {
    expect(new Set(PAPER_DOLL_SLOTS.map((slot) => slot.slotName)).size).toBe(PAPER_DOLL_SLOTS.length)
    for (const slot of PAPER_DOLL_SLOTS) {
      expect(slot.rect.x).toBeGreaterThanOrEqual(0)
      expect(slot.rect.y).toBeGreaterThanOrEqual(PAPER_DOLL_VIEW_TOP)
      expect(slot.rect.x + slot.rect.width).toBeLessThanOrEqual(PAPER_DOLL_WIDTH)
      expect(slot.rect.y + slot.rect.height).toBeLessThanOrEqual(PAPER_DOLL_HEIGHT - PAPER_DOLL_VIEW_BOTTOM)
    }
  })

  it('shows two weapon slots plus thirteen shared slots in either set', () => {
    expect(getActivePaperDollSlots(1)).toHaveLength(15)
    expect(getActivePaperDollSlots(2)).toHaveLength(15)
    expect(PAPER_DOLL_SLOTS.filter((slot) => slot.weaponSet === 1)).toHaveLength(2)
    expect(PAPER_DOLL_SLOTS.filter((slot) => slot.weaponSet === 2)).toHaveLength(2)
  })

  it('maps the active weapon set to the two inner frames and jewelry to its artwork', () => {
    expect(PAPER_DOLL_SLOTS.slice(0, 4).map((slot) => [slot.slotName, slot.weaponSet])).toEqual([
      ['Weapon 1 Swap', 2],
      ['Weapon 1', 1],
      ['Weapon 2', 1],
      ['Weapon 2 Swap', 2],
    ])
    expect(PAPER_DOLL_SLOTS.slice(8, 11).map((slot) => slot.slotName)).toEqual([
      'Ring 1', 'Amulet', 'Ring 2',
    ])
    expect(PAPER_DOLL_SLOTS.find((slot) => slot.slotName === 'Flask 2')?.rect).toEqual({
      x: 1024, y: 883, width: 108, height: 224,
    })
    expect(PAPER_DOLL_SLOTS.find((slot) => slot.slotName === 'Body Armour')?.rect).toEqual({
      x: 654, y: 348, width: 257, height: 350,
    })
    expect(PAPER_DOLL_SLOTS.find((slot) => slot.slotName === 'Belt')?.rect).toEqual({
      x: 654, y: 737, width: 257, height: 109,
    })
    expect(PAPER_DOLL_SLOTS.slice(14, 17).map((slot) => [slot.slotName, slot.rect.x])).toEqual([
      ['Charm 1', 598], ['Charm 2', 722], ['Charm 3', 846],
    ])
  })

  it('maps both native I/II tab pairs to the same weapon set controls', () => {
    expect(PAPER_DOLL_WEAPON_SET_CONTROLS.map(({ side, weaponSet }) => [side, weaponSet])).toEqual([
      ['left', 1], ['left', 2], ['right', 1], ['right', 2],
    ])
    for (const control of PAPER_DOLL_WEAPON_SET_CONTROLS) {
      expect(control.rect.x + control.rect.width).toBeLessThanOrEqual(PAPER_DOLL_WIDTH)
      expect(control.rect.y).toBeGreaterThanOrEqual(PAPER_DOLL_VIEW_TOP)
      expect(control.rect.y + control.rect.height).toBeLessThanOrEqual(PAPER_DOLL_HEIGHT - PAPER_DOLL_VIEW_BOTTOM)
    }
  })

  it('moves the active weapon set into the two inner foreground frames', () => {
    const setOne = getPaperDollSlotsForWeaponSet(1).slice(0, 4)
    const setTwo = getPaperDollSlotsForWeaponSet(2).slice(0, 4)

    expect(setOne.map((slot) => [slot.slotName, slot.rect.x])).toEqual([
      ['Weapon 1 Swap', 61], ['Weapon 1', 192], ['Weapon 2', 1135], ['Weapon 2 Swap', 1390],
    ])
    expect(setTwo.map((slot) => [slot.slotName, slot.rect.x])).toEqual([
      ['Weapon 1 Swap', 192], ['Weapon 1', 61], ['Weapon 2', 1390], ['Weapon 2 Swap', 1135],
    ])
  })
})
