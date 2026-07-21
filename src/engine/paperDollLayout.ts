export const PAPER_DOLL_WIDTH = 1548
export const PAPER_DOLL_HEIGHT = 1200
export const PAPER_DOLL_MAX_WIDTH = 820

export interface PaperDollRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PaperDollSlotLayout {
  slotName: string
  weaponSet?: 1 | 2
  rect: PaperDollRect
}

export interface PaperDollWeaponSetControl {
  side: 'left' | 'right'
  weaponSet: 1 | 2
  rect: PaperDollRect
}

// Coordinates use the native equip-bg-D8S81SLb.png 1548 x 1200 artboard.
export const PAPER_DOLL_SLOTS: readonly PaperDollSlotLayout[] = [
  { slotName: 'Weapon 1 Swap', weaponSet: 2, rect: { x: 61, y: 105, width: 112, height: 230 } },
  { slotName: 'Weapon 1', weaponSet: 1, rect: { x: 192, y: 106, width: 243, height: 476 } },
  { slotName: 'Weapon 2', weaponSet: 1, rect: { x: 1135, y: 106, width: 239, height: 476 } },
  { slotName: 'Weapon 2 Swap', weaponSet: 2, rect: { x: 1390, y: 105, width: 101, height: 230 } },
  { slotName: 'Helmet', rect: { x: 663, y: 73, width: 240, height: 240 } },
  { slotName: 'Body Armour', rect: { x: 697, y: 348, width: 204, height: 350 } },
  { slotName: 'Gloves', rect: { x: 371, y: 614, width: 237, height: 232 } },
  { slotName: 'Boots', rect: { x: 958, y: 614, width: 235, height: 232 } },
  { slotName: 'Ring 1', rect: { x: 488, y: 465, width: 120, height: 116 } },
  { slotName: 'Amulet', rect: { x: 957, y: 313, width: 119, height: 119 } },
  { slotName: 'Ring 2', rect: { x: 957, y: 465, width: 119, height: 116 } },
  { slotName: 'Belt', rect: { x: 697, y: 737, width: 204, height: 109 } },
  { slotName: 'Flask 1', rect: { x: 434, y: 883, width: 108, height: 224 } },
  { slotName: 'Flask 2', rect: { x: 1024, y: 883, width: 108, height: 224 } },
  { slotName: 'Charm 1', rect: { x: 598, y: 940, width: 124, height: 112 } },
  { slotName: 'Charm 2', rect: { x: 722, y: 940, width: 124, height: 112 } },
  { slotName: 'Charm 3', rect: { x: 846, y: 940, width: 124, height: 112 } },
]

export function getPaperDollSlotsForWeaponSet(activeWeaponSet: 1 | 2): readonly PaperDollSlotLayout[] {
  if (activeWeaponSet === 1) return PAPER_DOLL_SLOTS

  const [leftOuter, leftInner, rightInner, rightOuter, ...sharedSlots] = PAPER_DOLL_SLOTS
  return [
    { ...leftInner, slotName: leftOuter.slotName, weaponSet: leftOuter.weaponSet },
    { ...leftOuter, slotName: leftInner.slotName, weaponSet: leftInner.weaponSet },
    { ...rightOuter, slotName: rightInner.slotName, weaponSet: rightInner.weaponSet },
    { ...rightInner, slotName: rightOuter.slotName, weaponSet: rightOuter.weaponSet },
    ...sharedSlots,
  ]
}

// Both weapon frames repeat the native I/II tabs. Each pair controls the same active weapon set.
export const PAPER_DOLL_WEAPON_SET_CONTROLS: readonly PaperDollWeaponSetControl[] = [
  { side: 'left', weaponSet: 1, rect: { x: 241, y: 63, width: 63, height: 45 } },
  { side: 'left', weaponSet: 2, rect: { x: 316, y: 63, width: 63, height: 45 } },
  { side: 'right', weaponSet: 1, rect: { x: 1183, y: 63, width: 63, height: 45 } },
  { side: 'right', weaponSet: 2, rect: { x: 1259, y: 63, width: 63, height: 45 } },
]

export interface PaperDollSize {
  width: number
  height: number
  scale: number
}

export function fitPaperDoll(width: number, height: number, maxWidth = PAPER_DOLL_MAX_WIDTH): PaperDollSize {
  const scale = Math.max(0, Math.min(
    width / PAPER_DOLL_WIDTH,
    height / PAPER_DOLL_HEIGHT,
    maxWidth / PAPER_DOLL_WIDTH,
  ))
  return {
    width: PAPER_DOLL_WIDTH * scale,
    height: PAPER_DOLL_HEIGHT * scale,
    scale,
  }
}

export function getActivePaperDollSlots(weaponSet: 1 | 2): readonly PaperDollSlotLayout[] {
  return PAPER_DOLL_SLOTS.filter((slot) => !slot.weaponSet || slot.weaponSet === weaponSet)
}

export function paperDollRectStyle(rect: PaperDollRect): Record<'left' | 'top' | 'width' | 'height', string> {
  return {
    left: `${rect.x / PAPER_DOLL_WIDTH * 100}%`,
    top: `${rect.y / PAPER_DOLL_HEIGHT * 100}%`,
    width: `${rect.width / PAPER_DOLL_WIDTH * 100}%`,
    height: `${rect.height / PAPER_DOLL_HEIGHT * 100}%`,
  }
}
