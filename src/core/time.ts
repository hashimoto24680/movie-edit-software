import type { Fps } from "./types";

const timecodePattern = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

export const fpsToNumber = (fps: Fps): number => fps.num / fps.den;

export const secondsToFrames = (seconds: number, fps: Fps): number =>
  Math.round(seconds * fpsToNumber(fps));

export const framesToSeconds = (frames: number, fps: Fps): number => frames / fpsToNumber(fps);

export const millisecondsToFrames = (ms: number, fps: Fps): number => secondsToFrames(ms / 1000, fps);

export const framesToMilliseconds = (frames: number, fps: Fps): number =>
  Math.round(framesToSeconds(frames, fps) * 1000);

export const timecodeToFrames = (timecode: string, fps: Fps): number => {
  const match = timecode.match(timecodePattern);
  if (!match) {
    throw new Error(`Invalid timecode: ${timecode}`);
  }

  const [, hours, minutes, seconds, fraction = "0"] = match;
  const ms = Number(fraction.padEnd(3, "0"));
  const totalMs =
    Number(hours) * 60 * 60 * 1000 + Number(minutes) * 60 * 1000 + Number(seconds) * 1000 + ms;

  return millisecondsToFrames(totalMs, fps);
};

export const framesToTimecode = (frames: number, fps: Fps): string => {
  const totalMs = framesToMilliseconds(frames, fps);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

export const frameRangeEnd = (startFrame: number, durationFrames: number): number =>
  startFrame + durationFrames;
