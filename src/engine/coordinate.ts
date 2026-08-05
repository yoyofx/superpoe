/**
 * Canvas 坐标系变换
 *
 * 层级关系：
 *   树坐标 (tree-space) → 相机变换 → 屏幕像素 (screen-space)
 *
 * tree-space:   跟 PoB2 源码一致，节点坐标由 gen_tree_data.py 预计算
 *               x 范围约 min_x ~ max_x (如 -11k ~ +11k)
 * screen-space: Canvas 像素坐标，左上角 (0,0)
 *
 * 变换公式：
 *   screenX = (treeX + offsetX) * zoom + canvasWidth / 2
 *   screenY = (treeY + offsetY) * zoom + canvasHeight / 2
 *
 * 逆变换：
 *   treeX = (screenX - canvasWidth / 2) / zoom - offsetX
 *   treeY = (screenY - canvasHeight / 2) / zoom - offsetY
 */

export interface Camera {
  offsetX: number
  offsetY: number
  zoom: number
}

/** 树坐标 → 屏幕坐标 */
export function treeToScreen(
  treeX: number,
  treeY: number,
  cam: Camera,
  canvasW: number,
  canvasH: number,
): [number, number] {
  return [
    (treeX + cam.offsetX) * cam.zoom + canvasW / 2,
    (treeY + cam.offsetY) * cam.zoom + canvasH / 2,
  ]
}

/** 屏幕坐标 → 树坐标 */
export function screenToTree(
  screenX: number,
  screenY: number,
  cam: Camera,
  canvasW: number,
  canvasH: number,
): [number, number] {
  return [
    (screenX - canvasW / 2) / cam.zoom - cam.offsetX,
    (screenY - canvasH / 2) / cam.zoom - cam.offsetY,
  ]
}

/** 获取当前视口边界 (树坐标) */
export function getViewportBounds(
  cam: Camera,
  canvasW: number,
  canvasH: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const [minX, minY] = screenToTree(0, 0, cam, canvasW, canvasH)
  const [maxX, maxY] = screenToTree(canvasW, canvasH, cam, canvasW, canvasH)
  return { minX, minY, maxX, maxY }
}
