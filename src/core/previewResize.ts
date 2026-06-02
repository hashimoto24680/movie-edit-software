import type { Point2D } from "./types";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const calculateResizeScale = (
  startScale: Point2D,
  pointerDelta: Point2D,
  direction: Point2D,
  keepAspect: boolean
): Point2D => {
  const signedDx = pointerDelta.x * direction.x;
  const signedDy = pointerDelta.y * direction.y;
  const delta = Math.max(signedDx, signedDy);
  return {
    x: clamp(startScale.x + (keepAspect ? delta : signedDx) * 2, 0.1, 3),
    y: clamp(startScale.y + (keepAspect ? delta : signedDy) * 2, 0.1, 3)
  };
};
