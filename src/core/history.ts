import { applyCommands } from "./commands";
import type { CommandGroup, ProjectAst } from "./types";

const checkpointInterval = 20;

export interface HistoryCheckpoint {
  cursor: number;
  project: ProjectAst;
}

export interface HistoryState {
  initialProject: ProjectAst;
  entries: CommandGroup[];
  cursor: number;
  checkpoints: HistoryCheckpoint[];
}

export const createHistory = (initialProject: ProjectAst): HistoryState => ({
  initialProject,
  entries: [],
  cursor: 0,
  checkpoints: [{ cursor: 0, project: initialProject }]
});

const latestCheckpoint = (history: HistoryState): HistoryCheckpoint =>
  history.checkpoints
    .filter((checkpoint) => checkpoint.cursor <= history.cursor)
    .sort((a, b) => b.cursor - a.cursor)[0] ?? { cursor: 0, project: history.initialProject };

export const currentProjectFromHistory = (history: HistoryState): ProjectAst => {
  const checkpoint = latestCheckpoint(history);
  const entriesToReplay = history.entries.slice(checkpoint.cursor, history.cursor);
  return entriesToReplay.reduce(
    (project, entry) => applyCommands(project, entry.commands),
    checkpoint.project
  );
};

export const commitHistory = (history: HistoryState, entry: CommandGroup): HistoryState => {
  const activeEntries = history.entries.slice(0, history.cursor);
  const nextEntries = [...activeEntries, entry];
  const nextCursor = nextEntries.length;
  const nextHistory: HistoryState = {
    ...history,
    entries: nextEntries,
    cursor: nextCursor,
    checkpoints: history.checkpoints.filter((checkpoint) => checkpoint.cursor <= history.cursor)
  };

  if (nextCursor % checkpointInterval === 0) {
    nextHistory.checkpoints.push({
      cursor: nextCursor,
      project: currentProjectFromHistory(nextHistory)
    });
  }

  return nextHistory;
};

export const undoHistory = (history: HistoryState): HistoryState => ({
  ...history,
  cursor: Math.max(0, history.cursor - 1)
});

export const redoHistory = (history: HistoryState): HistoryState => ({
  ...history,
  cursor: Math.min(history.entries.length, history.cursor + 1)
});
