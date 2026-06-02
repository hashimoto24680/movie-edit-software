import type { Point2D } from "./types";

export const angleFromCenter = (center: Point2D, pointer: Point2D): number =>
  (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI;

export const normalizeRotation = (degrees: number): number => {
  const normalized = ((degrees + 180) % 360) - 180;
  return normalized < -180 ? normalized + 360 : normalized;
};

export const calculateRotation = (
  startRotation: number,
  center: Point2D,
  startPointer: Point2D,
  currentPointer: Point2D,
  snapTo15Degrees: boolean
): number => {
  const delta = angleFromCenter(center, currentPointer) - angleFromCenter(center, startPointer);
  const rotation = normalizeRotation(startRotation + delta);
  return snapTo15Degrees ? Math.round(rotation / 15) * 15 : rotation;
};
