export type KeyboardShortcutAction =
  | "undo"
  | "redo"
  | "duplicate"
  | "split"
  | "remove"
  | "rippleRemove"
  | "jumpSelectedStart"
  | "jumpSelectedEnd"
  | "jumpPreviousBoundary"
  | "jumpNextBoundary"
  | "stepLeft"
  | "stepRight"
  | "nudgeSelectedLeft"
  | "nudgeSelectedRight";

export interface KeyboardShortcutInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const hasCommandModifier = (input: KeyboardShortcutInput): boolean => Boolean(input.ctrlKey || input.metaKey);

export const resolveKeyboardShortcut = (input: KeyboardShortcutInput): KeyboardShortcutAction | null => {
  const key = input.key.toLowerCase();
  const command = hasCommandModifier(input);

  if (input.altKey) return null;

  if (command && key === "z" && !input.shiftKey) return "undo";
  if (command && (key === "y" || (key === "z" && input.shiftKey))) return "redo";
  if (command && key === "d" && !input.shiftKey) return "duplicate";
  if (command && key === "k" && !input.shiftKey) return "split";
  if (!command && key === "delete" && input.shiftKey) return "rippleRemove";
  if (!command && (key === "delete" || key === "backspace") && !input.shiftKey) return "remove";
  if (!command && key === "[" && !input.shiftKey) return "jumpSelectedStart";
  if (!command && key === "]" && !input.shiftKey) return "jumpSelectedEnd";
  if (!command && key === "," && !input.shiftKey) return "jumpPreviousBoundary";
  if (!command && key === "." && !input.shiftKey) return "jumpNextBoundary";
  if (!command && key === "arrowleft" && input.shiftKey) return "nudgeSelectedLeft";
  if (!command && key === "arrowright" && input.shiftKey) return "nudgeSelectedRight";
  if (!command && key === "arrowleft" && !input.shiftKey) return "stepLeft";
  if (!command && key === "arrowright" && !input.shiftKey) return "stepRight";

  return null;
};
