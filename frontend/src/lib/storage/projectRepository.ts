import type { LocalProject } from "../../types";
import { restoreProjects } from "../projects";

const STORAGE_KEY = "h3-local-projects-v1";

export function readProjects(): LocalProject[] {
  try {
    return restoreProjects(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function writeProjects(projects: LocalProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}
