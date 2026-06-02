import type { Point2D } from "./types";

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

export const alignHorizontalPosition = (position: Point2D, align: HorizontalAlign): Point2D => ({
  ...position,
  x: align === "left" ? 0 : align === "center" ? 0.5 : 1
});

export const alignVerticalPosition = (position: Point2D, align: VerticalAlign): Point2D => ({
  ...position,
  y: align === "top" ? 0 : align === "middle" ? 0.5 : 1
});
