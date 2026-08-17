import { useCallback, useEffect, useMemo, useState } from "react";
import { makeProject, makeProjectClip, moveProjectClip, normalizeClip, reorderProjectClips, replaceProjectClip } from "../lib/projects";
import { readProjects, writeProjects } from "../lib/storage/projectRepository";
import type { AspectId, Job, LocalProject, ProjectClip } from "../types";

export function useProjects() {
  const [projects, setProjects] = useState<LocalProject[]>(readProjects);
  useEffect(() => writeProjects(projects), [projects]);

  const createProject = useCallback((name?: string) => {
    const project = makeProject(name);
    setProjects((current) => [project, ...current]);
    return project;
  }, []);

  const updateProject = useCallback((id: string, update: (project: LocalProject) => LocalProject) => {
    setProjects((current) => current.map((project) => (
      project.id === id ? { ...update(project), updatedAt: Date.now() } : project
    )).sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    updateProject(id, (project) => ({ ...project, name: name.trim() || "Untitled project" }));
  }, [updateProject]);

  const setProjectAspect = useCallback((id: string, aspect: AspectId) => {
    updateProject(id, (project) => ({ ...project, aspect }));
  }, [updateProject]);

  const deleteProject = useCallback((id: string) => {
    setProjects((current) => current.filter((project) => project.id !== id));
  }, []);

  const addJob = useCallback((projectId: string, job: Job) => {
    updateProject(projectId, (project) => {
      if (project.clips.some((clip) => clip.jobId === job.id)) return project;
      return { ...project, clips: [...project.clips, makeProjectClip(job, project.clips.length)] };
    });
  }, [updateProject]);

  const updateClip = useCallback((projectId: string, clipId: string, patch: Partial<ProjectClip>) => {
    updateProject(projectId, (project) => ({
      ...project,
      clips: project.clips.map((clip) => clip.id === clipId ? normalizeClip({ ...clip, ...patch }) : clip),
    }));
  }, [updateProject]);

  const replaceClip = useCallback((projectId: string, clipId: string, job: Job) => {
    updateProject(projectId, (project) => ({
      ...project,
      clips: project.clips.map((clip) => clip.id === clipId && clip.jobId !== job.id ? replaceProjectClip(clip, job) : clip),
    }));
  }, [updateProject]);

  const removeClip = useCallback((projectId: string, clipId: string) => {
    updateProject(projectId, (project) => ({
      ...project,
      clips: project.clips.filter((clip) => clip.id !== clipId).sort((a, b) => a.order - b.order).map((clip, order) => ({ ...clip, order })),
    }));
  }, [updateProject]);

  const reorderClips = useCallback((projectId: string, fromId: string, toId: string) => {
    updateProject(projectId, (project) => ({ ...project, clips: reorderProjectClips(project.clips, fromId, toId) }));
  }, [updateProject]);

  const moveClip = useCallback((projectId: string, clipId: string, delta: number) => {
    updateProject(projectId, (project) => ({ ...project, clips: moveProjectClip(project.clips, clipId, delta) }));
  }, [updateProject]);

  const referencedJobIds = useMemo(() => new Set(projects.flatMap((project) => project.clips.map((clip) => clip.jobId))), [projects]);

  return {
    projects, createProject, renameProject, setProjectAspect, deleteProject,
    addJob, updateClip, replaceClip, removeClip, reorderClips, moveClip, referencedJobIds,
  };
}
