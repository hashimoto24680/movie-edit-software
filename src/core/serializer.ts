import { migrateProject } from "./migrations";
import type { ProjectAst, ProjectFile } from "./types";

const stableSortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableSortObject(nested)])
    );
  }

  return value;
};

export const serializeProject = (project: ProjectAst): string =>
  JSON.stringify(stableSortObject(project), null, 2);

export const parseProjectJson = (json: string): ProjectAst => migrateProject(JSON.parse(json));

export const createProjectFile = (project: ProjectAst): ProjectFile => ({
  fileType: "movie-edit-software.project",
  fileVersion: 1,
  project
});

export const serializeProjectFile = (project: ProjectAst): string =>
  JSON.stringify(stableSortObject(createProjectFile(project)), null, 2);

export const parseProjectFileJson = (json: string): ProjectAst => {
  const raw = JSON.parse(json) as Partial<ProjectFile> | ProjectAst;
  if ("fileType" in raw && raw.fileType === "movie-edit-software.project") {
    return migrateProject(raw.project);
  }
  return migrateProject(raw);
};
