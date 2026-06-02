import type { Point2D, Size } from "./types";

export type CanvasFitMode = "width" | "height";
export type CanvasFitKind = "media" | "text";

const baseWidthPercent = (kind: CanvasFitKind): number => (kind === "media" ? 72 : 78);

export const centerPosition = (): Point2D => ({ x: 0.5, y: 0.5 });

export const calculateCanvasFitScale = (
  mode: CanvasFitMode,
  kind: CanvasFitKind,
  canvas: Size,
  source?: Size
): Point2D => {
  const baseWidth = baseWidthPercent(kind);
  if (mode === "width" || !source) {
    return { x: 100 / baseWidth, y: 1 };
  }

  const canvasAspect = canvas.width / canvas.height;
  const sourceAspect = source.width / source.height;
  return {
    x: 100 / (baseWidth * (canvasAspect / sourceAspect)),
    y: 1
  };
};
