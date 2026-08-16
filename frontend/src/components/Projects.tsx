import { Blend, ChevronLeft, ChevronRight, Download, Film, GripVertical, LoaderCircle, Plus, RotateCcw, Scissors, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocalGeneratedVideoUrl } from "../hooks/useLocalGeneratedVideoUrl";
import { ApiError, createProjectExport, getProjectExport } from "../lib/api/client";
import { clearStoredProjectExport, downloadProjectExport, prepareProjectExportVideos, readStoredProjectExport, writeStoredProjectExport } from "../lib/projectExport";
import { clipDuration, clipFractionAtSourceTime, isProjectPlaybackBoundary, MIN_CLIP_SECONDS, projectClipOpacity, projectClipTrimValue, shouldToggleProjectPlayback, sourceTimeAtClipFraction } from "../lib/projects";
import type { AspectId, Job, LocalProject, ProjectClip, ProjectTransition } from "../types";
import { RemixIcon } from "./icons";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const TIMELINE_DRAG_HOLD_MS = 250;
const TIMELINE_SCROLL_CANCEL_X_PX = 6;
const EXPORT_POLL_INTERVAL_MS = 1500;

type ProjectPlayhead = { clipId: string; sourceTime: number };
type ProjectSeekTarget = ProjectPlayhead & { requestId: number };

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return minutes ? `${minutes}:${seconds.toFixed(1).padStart(4, "0")}` : `${seconds.toFixed(1)}s`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function Projects({ projects, jobs, selectedProjectId, onSelectProject, onCreateProject, onRenameProject, onSetAspect, onDeleteProject, onUpdateClip, onRemoveClip, onReorderClips, onMoveClip, onOpenLibrary, onRemix }: {
  projects: LocalProject[];
  jobs: Job[];
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onCreateProject: () => LocalProject;
  onRenameProject: (id: string, name: string) => void;
  onSetAspect: (id: string, aspect: AspectId) => void;
  onDeleteProject: (id: string) => void;
  onUpdateClip: (projectId: string, clipId: string, patch: Partial<ProjectClip>) => void;
  onRemoveClip: (projectId: string, clipId: string) => void;
  onReorderClips: (projectId: string, fromId: string, toId: string) => void;
  onMoveClip: (projectId: string, clipId: string, delta: number) => void;
  onOpenLibrary: () => void;
  onRemix: (job: Job) => void;
}) {
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (selectedProject?.id !== selectedProjectId) onSelectProject(selectedProject?.id ?? null);
  }, [onSelectProject, selectedProject?.id, selectedProjectId]);

  const createAndSelect = () => {
    const project = onCreateProject();
    onSelectProject(project.id);
  };

  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-dvh px-3 pb-5 pt-16 sm:px-5 sm:pt-18">
      <div className="mx-auto flex min-h-[calc(100dvh-5.25rem)] max-w-[1500px] overflow-hidden rounded-[18px] border border-white/8 bg-[#0d0d0d] shadow-[0_30px_90px_rgba(0,0,0,.35)]">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-white/7 bg-white/[.015] md:flex">
          <div className="flex items-center justify-between px-4 py-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/38">Projects</span>
            <button type="button" onClick={createAndSelect} className="flex size-8 items-center justify-center rounded-full text-white/50 hover:bg-white/7 hover:text-white" title="New project"><Plus size={15} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {projects.map((project) => <button key={project.id} type="button" onClick={() => onSelectProject(project.id)} className={`mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition ${selectedProject?.id === project.id ? "bg-white/8 text-white" : "text-white/48 hover:bg-white/[.035] hover:text-white/75"}`}><span className="truncate">{project.name}</span><b className="ml-3 text-[9px] tabular-nums text-white/28">{project.clips.length}</b></button>)}
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="flex items-center gap-2 border-b border-white/7 p-3 md:hidden">
            <select value={selectedProject?.id ?? ""} onChange={(event) => onSelectProject(event.target.value || null)} className="min-w-0 flex-1 rounded-lg border border-white/8 bg-white/[.035] px-3 py-2 text-xs text-white outline-none">
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name} ({project.clips.length})</option>)}
            </select>
            <button type="button" onClick={createAndSelect} className="flex size-9 items-center justify-center rounded-full bg-reelo-accent text-black" aria-label="New project"><Plus size={15} /></button>
          </div>

          {selectedProject ? (
            <ProjectEditor
              key={selectedProject.id}
              project={selectedProject}
              jobs={jobs}
              onRename={(name) => onRenameProject(selectedProject.id, name)}
              onSetAspect={(aspect) => onSetAspect(selectedProject.id, aspect)}
              onDelete={() => { if (confirm(`Delete “${selectedProject.name}”? Its cached videos will stay on this device.`)) onDeleteProject(selectedProject.id); }}
              onUpdateClip={(clipId, patch) => onUpdateClip(selectedProject.id, clipId, patch)}
              onRemoveClip={(clipId) => onRemoveClip(selectedProject.id, clipId)}
              onReorderClips={(fromId, toId) => onReorderClips(selectedProject.id, fromId, toId)}
              onMoveClip={(clipId, delta) => onMoveClip(selectedProject.id, clipId, delta)}
              onOpenLibrary={onOpenLibrary}
              onRemix={onRemix}
            />
          ) : (
            <div className="flex min-h-[70dvh] items-center justify-center px-6 text-center">
              <div className="max-w-xs"><Film size={24} className="mx-auto text-white/20" /><h1 className="mt-5 text-lg font-semibold text-white">Start a local project</h1><p className="mt-2 text-xs leading-5 text-white/42">Arrange cached H3 videos into a lightweight sequence saved on this device.</p><button type="button" onClick={createAndSelect} className="mt-5 rounded-full bg-reelo-accent px-4 py-2 text-xs font-bold text-black">New project</button></div>
            </div>
          )}
        </section>
      </div>
    </motion.main>
  );
}

function ProjectEditor({ project, jobs, onRename, onSetAspect, onDelete, onUpdateClip, onRemoveClip, onReorderClips, onMoveClip, onOpenLibrary, onRemix }: {
  project: LocalProject;
  jobs: Job[];
  onRename: (name: string) => void;
  onSetAspect: (aspect: AspectId) => void;
  onDelete: () => void;
  onUpdateClip: (clipId: string, patch: Partial<ProjectClip>) => void;
  onRemoveClip: (clipId: string) => void;
  onReorderClips: (fromId: string, toId: string) => void;
  onMoveClip: (clipId: string, delta: number) => void;
  onOpenLibrary: () => void;
  onRemix: (job: Job) => void;
}) {
  const orderedClips = useMemo(() => [...project.clips].sort((a, b) => a.order - b.order), [project.clips]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(orderedClips[0]?.id ?? null);
  const [playhead, setPlayhead] = useState<ProjectPlayhead | null>(() => orderedClips[0] ? { clipId: orderedClips[0].id, sourceTime: orderedClips[0].inPoint } : null);
  const [seekTarget, setSeekTarget] = useState<ProjectSeekTarget | null>(null);
  const seekRequestIdRef = useRef(0);
  const activeExportRef = useRef<string | null>(null);
  const [name, setName] = useState(project.name);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const selectedClip = orderedClips.find((clip) => clip.id === selectedClipId) ?? orderedClips[0] ?? null;
  const selectedIndex = selectedClip ? orderedClips.findIndex((clip) => clip.id === selectedClip.id) : -1;
  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const totalDuration = orderedClips.reduce((sum, clip) => sum + clipDuration(clip), 0);

  useEffect(() => {
    if (!selectedClip && orderedClips[0]) {
      setSelectedClipId(orderedClips[0].id);
      setPlayhead({ clipId: orderedClips[0].id, sourceTime: orderedClips[0].inPoint });
    }
    if (selectedClipId && !orderedClips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(orderedClips[0]?.id ?? null);
      setPlayhead(orderedClips[0] ? { clipId: orderedClips[0].id, sourceTime: orderedClips[0].inPoint } : null);
    }
  }, [orderedClips, selectedClip, selectedClipId]);

  const seekPreview = useCallback((clipId: string, sourceTime: number) => {
    const clip = orderedClips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const boundedTime = Math.max(clip.inPoint, Math.min(clip.outPoint, sourceTime));
    const target = { clipId, sourceTime: boundedTime, requestId: ++seekRequestIdRef.current };
    setSelectedClipId(clipId);
    setPlayhead(target);
    setSeekTarget(target);
  }, [orderedClips]);

  const selectPreviewClip = useCallback((clipId: string) => {
    const clip = orderedClips.find((candidate) => candidate.id === clipId);
    if (clip) seekPreview(clipId, clip.inPoint);
  }, [orderedClips, seekPreview]);
  const updatePreviewPosition = useCallback((clipId: string, sourceTime: number) => {
    setPlayhead({ clipId, sourceTime });
  }, []);

  const pollExportToCompletion = useCallback(async (exportId: string, filename: string) => {
    activeExportRef.current = exportId;
    setExporting(true);
    setExportError(null);
    let retryDelay = EXPORT_POLL_INTERVAL_MS;
    try {
      while (activeExportRef.current === exportId) {
        let status;
        try {
          status = await getProjectExport(exportId);
          retryDelay = EXPORT_POLL_INTERVAL_MS;
        } catch (error) {
          if (error instanceof ApiError && error.status < 500) throw error;
          setExportMessage("Reconnecting to export…");
          await wait(retryDelay);
          retryDelay = Math.min(10_000, retryDelay * 1.5);
          continue;
        }
        if (activeExportRef.current !== exportId) return;
        if (status.progress?.message) setExportMessage(status.progress.message);
        if (status.status === "failed") throw new Error(status.error || "Project export failed.");
        if (status.status === "completed" && status.downloadUrl) {
          downloadProjectExport(status.downloadUrl, status.filename || filename);
          setExportMessage("Download started");
          clearStoredProjectExport(project.id);
          return;
        }
        await wait(EXPORT_POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (activeExportRef.current !== exportId) return;
      clearStoredProjectExport(project.id);
      setExportError(error instanceof Error ? error.message : "Project export failed.");
      setExportMessage(null);
    } finally {
      if (activeExportRef.current === exportId) {
        activeExportRef.current = null;
        setExporting(false);
      }
    }
  }, [project.id]);

  useEffect(() => {
    const stored = readStoredProjectExport(project.id);
    if (stored) {
      setExportMessage("Resuming export…");
      void pollExportToCompletion(stored.exportId, stored.filename);
    }
    return () => { activeExportRef.current = null; };
  }, [pollExportToCompletion, project.id]);

  const exportProject = useCallback(async () => {
    if (!orderedClips.length || exporting) return;
    setExporting(true);
    setExportError(null);
    setExportMessage("Preparing clips…");
    clearStoredProjectExport(project.id);
    try {
      const videos = await prepareProjectExportVideos(project, jobsById, (completed, total) => {
        setExportMessage(`Preparing clips ${completed}/${total}`);
      });
      setExportMessage("Uploading clips…");
      const status = await createProjectExport(project, videos);
      const filename = `${project.name || "Untitled project"}.mp4`;
      writeStoredProjectExport(project.id, { exportId: status.id, filename, updatedAt: Date.now() });
      await pollExportToCompletion(status.id, filename);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Project export failed.");
      setExportMessage(null);
      setExporting(false);
    }
  }, [exporting, jobsById, orderedClips.length, pollExportToCompletion, project]);

  return (
    <div className="flex min-h-[calc(100dvh-5.25rem)] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/7 px-4 py-3 sm:px-5">
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => onRename(name)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/25 sm:text-base" aria-label="Project name" />
        <span className="text-[10px] tabular-nums text-white/35">{orderedClips.length} clips · {formatSeconds(totalDuration)}</span>
        <div className="flex rounded-full bg-white/[.035] p-0.5">{(["16:9", "9:16"] as AspectId[]).map((aspect) => <button key={aspect} type="button" onClick={() => onSetAspect(aspect)} className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${project.aspect === aspect ? "bg-white/10 text-white" : "text-white/35 hover:text-white/70"}`}>{aspect}</button>)}</div>
        <button type="button" disabled={exporting || !orderedClips.length} onClick={() => void exportProject()} className="flex h-8 items-center gap-1.5 rounded-full border border-white/9 bg-white/[.035] px-3 text-[9px] font-bold text-white/62 hover:border-white/16 hover:bg-white/7 hover:text-white disabled:cursor-not-allowed disabled:opacity-30" title={exporting ? "Exporting project" : "Export MP4"}>{exporting ? <LoaderCircle size={12} className="animate-spin" /> : <Download size={12} />}<span>{exporting ? "Exporting" : "Export"}</span></button>
        <button type="button" onClick={onDelete} className="flex size-8 items-center justify-center rounded-full text-white/35 hover:bg-red-500/15 hover:text-red-300" aria-label="Delete project"><Trash2 size={13} /></button>
      </header>
      <AnimatePresence initial={false}>{(exportMessage || exportError) && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className={`overflow-hidden border-b px-5 py-2 text-[10px] ${exportError ? "border-red-400/10 bg-red-500/[.045] text-red-300" : "border-white/7 bg-white/[.018] text-white/42"}`}>{exportError ?? exportMessage}</motion.div>}</AnimatePresence>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(300px,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_260px] lg:grid-rows-[minmax(0,1fr)_auto]">
        <ProjectPreview clips={orderedClips} jobsById={jobsById} selectedClipId={selectedClip?.id ?? null} aspect={project.aspect} seekTarget={seekTarget} onSelectClip={selectPreviewClip} onPosition={updatePreviewPosition} onUpdateClip={onUpdateClip} onRemoveClip={onRemoveClip} />
        <AnimatePresence mode="wait">
          <ClipInspector key={selectedClip?.id ?? "empty"} clip={selectedClip} job={selectedClip ? jobsById.get(selectedClip.jobId) ?? null : null} index={selectedIndex} clipCount={orderedClips.length} onUpdate={onUpdateClip} onRemove={(clipId) => onRemoveClip(clipId)} onMove={onMoveClip} onRemix={onRemix} />
        </AnimatePresence>
        <div className="border-t border-white/7 lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-2.5 sm:px-5"><span className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/32">Timeline</span><button type="button" onClick={onOpenLibrary} className="flex items-center gap-1.5 text-[10px] font-semibold text-reelo-accent hover:text-white"><Plus size={12} /> Add from videos</button></div>
          {orderedClips.length ? <TimelineStrip clips={orderedClips} jobsById={jobsById} selectedClipId={selectedClip?.id ?? null} playhead={playhead} onSelect={selectPreviewClip} onSeek={seekPreview} onReorder={onReorderClips} onSetTransition={(clipId, transitionIn) => onUpdateClip(clipId, { transitionIn })} /> : <div className="px-5 pb-5 text-[11px] text-white/35">No clips yet. Add a completed result from Videos.</div>}
        </div>
      </div>
    </div>
  );
}

function TimelineStrip({ clips, jobsById, selectedClipId, playhead, onSelect, onSeek, onReorder, onSetTransition }: {
  clips: ProjectClip[];
  jobsById: Map<string, Job>;
  selectedClipId: string | null;
  playhead: ProjectPlayhead | null;
  onSelect: (id: string) => void;
  onSeek: (clipId: string, sourceTime: number) => void;
  onReorder: (fromId: string, toId: string) => void;
  onSetTransition: (clipId: string, transitionIn: ProjectTransition) => void;
}) {
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TIMELINE_DRAG_HOLD_MS, tolerance: { x: TIMELINE_SCROLL_CANCEL_X_PX } } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const itemIds = clips.map((clip) => clip.id);
  const activeClip = activeClipId ? clips.find((clip) => clip.id === activeClipId) ?? null : null;
  const clipNodesRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const playheadClip = clips.find((clip) => clip.id === playhead?.clipId) ?? clips.find((clip) => clip.id === selectedClipId) ?? clips[0];
  const playheadIndex = clips.findIndex((clip) => clip.id === playheadClip?.id);
  const playheadFraction = playheadClip ? clipFractionAtSourceTime(playheadClip, playhead?.clipId === playheadClip.id ? playhead.sourceTime : playheadClip.inPoint) : 0;
  const playheadStyle: CSSProperties = { left: `calc(${Math.max(0, playheadIndex)} * (9rem + 0.5rem) + ${playheadFraction} * 9rem)` };

  const setClipNode = useCallback((clipId: string, node: HTMLButtonElement | null) => {
    if (node) clipNodesRef.current.set(clipId, node);
    else clipNodesRef.current.delete(clipId);
  }, []);

  useEffect(() => {
    if (activeClipId || seeking || !selectedClipId) return;
    clipNodesRef.current.get(selectedClipId)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeClipId, seeking, selectedClipId]);

  const handleDragStart = (event: DragStartEvent) => setActiveClipId(String(event.active.id));
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveClipId(null);
    if (!event.over || event.active.id === event.over.id) return;
    onReorder(String(event.active.id), String(event.over.id));
  };

  const seekAtClientX = useCallback((clientX: number) => {
    const candidates = clips.flatMap((clip) => {
      const node = clipNodesRef.current.get(clip.id);
      return node ? [{ clip, rect: node.getBoundingClientRect() }] : [];
    });
    if (!candidates.length) return;
    let target = candidates.find(({ rect }) => clientX >= rect.left && clientX <= rect.right) ?? candidates[0];
    if (clientX < target.rect.left || clientX > target.rect.right) {
      let closestDistance = Number.POSITIVE_INFINITY;
      candidates.forEach((candidate) => {
        const distance = clientX < candidate.rect.left ? candidate.rect.left - clientX : clientX - candidate.rect.right;
        if (distance < closestDistance) {
          closestDistance = distance;
          target = candidate;
        }
      });
    }
    const fraction = Math.max(0, Math.min(1, (clientX - target.rect.left) / Math.max(1, target.rect.width)));
    onSeek(target.clip.id, sourceTimeAtClipFraction(target.clip, fraction));
  }, [clips, onSeek]);

  const nudgePlayhead = useCallback((delta: number) => {
    if (!playheadClip) return;
    const currentTime = playhead?.clipId === playheadClip.id ? playhead.sourceTime : playheadClip.inPoint;
    const nextTime = currentTime + delta;
    if (nextTime < playheadClip.inPoint && playheadIndex > 0) {
      const previous = clips[playheadIndex - 1];
      onSeek(previous.id, previous.outPoint);
      return;
    }
    if (nextTime > playheadClip.outPoint && playheadIndex < clips.length - 1) {
      const next = clips[playheadIndex + 1];
      onSeek(next.id, next.inPoint);
      return;
    }
    onSeek(playheadClip.id, nextTime);
  }, [clips, onSeek, playhead, playheadClip, playheadIndex]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll={false} onDragStart={handleDragStart} onDragCancel={() => setActiveClipId(null)} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
        <div ref={timelineRef} data-project-timeline role="region" tabIndex={0} className="overflow-x-auto px-4 pb-4 pt-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-reelo-accent/45 sm:px-5" aria-label="Project timeline">
          <div className="relative w-max pt-7">
            <div
              aria-hidden="true"
              title="Click or drag to seek"
              className="absolute inset-x-0 top-0 z-10 h-7 cursor-pointer touch-none border-b border-white/8 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,.13)_0_1px,transparent_1px_36px)] bg-[length:auto_5px] bg-bottom bg-no-repeat outline-none hover:border-white/16 focus-visible:border-reelo-accent/60"
              onPointerDown={(event) => {
                timelineRef.current?.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                seekAtClientX(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAtClientX(event.clientX);
              }}
            />
            <div className="relative flex">
              {clips.map((clip, index) => <Fragment key={clip.id}>
                <SortableTimelineClip clip={clip} sourceUrl={jobsById.get(clip.jobId)?.contentUrl} position={index + 1} selected={clip.id === selectedClipId} active={clip.id === activeClipId} setClipNode={setClipNode} onSelect={() => onSelect(clip.id)} />
                {index < clips.length - 1 && <TransitionToggle incomingClip={clips[index + 1]} position={index + 2} onSetTransition={onSetTransition} />}
              </Fragment>)}
            </div>
            {playheadClip && <button
              type="button"
              role="slider"
              aria-label="Project playhead"
              aria-valuemin={playheadClip.inPoint}
              aria-valuemax={playheadClip.outPoint}
              aria-valuenow={playhead?.sourceTime ?? playheadClip.inPoint}
              aria-valuetext={`Clip ${playheadIndex + 1}, ${formatSeconds(playhead?.sourceTime ?? playheadClip.inPoint)}`}
              title="Drag to seek"
              className="absolute top-1 z-30 h-[7.5rem] w-5 -translate-x-1/2 touch-none cursor-ew-resize outline-none focus-visible:ring-2 focus-visible:ring-reelo-accent/70"
              style={playheadStyle}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                nudgePlayhead(event.key === "ArrowLeft" ? -0.1 : 0.1);
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSeeking(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                seekAtClientX(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAtClientX(event.clientX);
              }}
              onPointerUp={() => setSeeking(false)}
              onPointerCancel={() => setSeeking(false)}
              onLostPointerCapture={() => setSeeking(false)}
            >
              <span className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-reelo-accent shadow-[0_0_12px_rgba(71,181,255,.6)]" />
              <span className="absolute bottom-0 left-1/2 top-1.5 w-px -translate-x-1/2 bg-reelo-accent shadow-[0_0_8px_rgba(71,181,255,.65)]" />
            </button>}
          </div>
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>{activeClip ? <TimelineClipFace clip={activeClip} sourceUrl={jobsById.get(activeClip.jobId)?.contentUrl} position={clips.findIndex((clip) => clip.id === activeClip.id) + 1} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function TransitionToggle({ incomingClip, position, onSetTransition }: {
  incomingClip: ProjectClip;
  position: number;
  onSetTransition: (clipId: string, transitionIn: ProjectTransition) => void;
}) {
  const enabled = incomingClip.transitionIn !== "cut";
  const nextTransition = enabled ? "cut" : "fade-black";
  const title = enabled
    ? `Fade through black before clip ${position} · 0.3s. Click for a hard cut.`
    : `Hard cut before clip ${position}. Click to fade through black.`;
  return <div className="relative z-20 w-2 shrink-0">
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={enabled}
      onClick={() => onSetTransition(incomingClip.id, nextTransition)}
      className={`absolute left-1/2 top-1/2 z-20 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-reelo-accent/70 ${enabled ? "border-reelo-accent/40 bg-[#07141c]/95 text-reelo-accent hover:border-reelo-accent/70 hover:bg-[#0a1c27]" : "border-white/12 bg-[#0d0d0f]/95 text-white/35 hover:border-white/25 hover:text-white/70"}`}
    >
      {enabled ? <Blend size={12} strokeWidth={2.2} /> : <Scissors size={11} strokeWidth={2.2} />}
    </button>
  </div>;
}

function SortableTimelineClip({ clip, sourceUrl, position, selected, active, setClipNode, onSelect }: {
  clip: ProjectClip;
  sourceUrl?: string;
  position: number;
  selected: boolean;
  active: boolean;
  setClipNode: (clipId: string, node: HTMLButtonElement | null) => void;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clip.id,
    transition: { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
  const setCombinedNodeRef = useCallback((node: HTMLButtonElement | null) => {
    setNodeRef(node);
    setClipNode(clip.id, node);
  }, [clip.id, setClipNode, setNodeRef]);
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return <TimelineClipFace ref={setCombinedNodeRef} clip={clip} sourceUrl={sourceUrl} position={position} selected={selected} dragging={active || isDragging} style={style} onClick={onSelect} attributes={attributes} listeners={listeners} />;
}

type TimelineClipFaceProps = {
  clip: ProjectClip;
  sourceUrl?: string;
  position: number;
  selected?: boolean;
  dragging?: boolean;
  overlay?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
  attributes?: ButtonHTMLAttributes<HTMLButtonElement>;
  listeners?: ButtonHTMLAttributes<HTMLButtonElement>;
};

const TimelineClipFace = forwardRef<HTMLButtonElement, TimelineClipFaceProps>(({ clip, sourceUrl, position, selected = false, dragging = false, overlay = false, style, onClick, attributes, listeners }, ref) => {
  const { loading, url } = useLocalGeneratedVideoUrl(clip.jobId, sourceUrl);
  return <button
      ref={ref}
      type="button"
      className={`group relative h-24 w-36 shrink-0 touch-pan-x overflow-hidden rounded-xl border text-left transition ${selected ? "border-reelo-accent/65 ring-2 ring-reelo-accent/12" : "border-white/10 hover:border-white/25"} ${dragging ? "opacity-35" : ""} ${overlay ? "z-80 rotate-1 border-reelo-accent/70 opacity-95 shadow-2xl" : ""}`}
      style={style}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {url ? <video src={url} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 size-full bg-black object-cover" /> : <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/[.035] text-[9px] text-white/32">{loading ? <LoaderCircle size={13} className="animate-spin" /> : "Unavailable"}</span>}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black via-black/80 to-transparent px-2 pb-1.5 pt-7 text-[9px] text-white/70"><b>{position}</b><span>{formatSeconds(clipDuration(clip))}</span></span>
      <GripVertical size={13} className="pointer-events-none absolute left-1.5 top-1.5 text-white/55 opacity-0 drop-shadow group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>;
});
TimelineClipFace.displayName = "TimelineClipFace";

function ProjectPreview({ clips, jobsById, selectedClipId, aspect, seekTarget, onSelectClip, onPosition, onUpdateClip, onRemoveClip }: {
  clips: ProjectClip[];
  jobsById: Map<string, Job>;
  selectedClipId: string | null;
  aspect: AspectId;
  seekTarget: ProjectSeekTarget | null;
  onSelectClip: (id: string) => void;
  onPosition: (clipId: string, sourceTime: number) => void;
  onUpdateClip: (clipId: string, patch: Partial<ProjectClip>) => void;
  onRemoveClip: (clipId: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fadeOverlayRef = useRef<HTMLDivElement | null>(null);
  const fadeAnimationRef = useRef<number | null>(null);
  const continuePlaybackRef = useRef(false);
  const advancingRef = useRef(false);
  const selectedIndex = Math.max(0, clips.findIndex((clip) => clip.id === selectedClipId));
  const clip = clips[selectedIndex] ?? null;
  const localVideo = useLocalGeneratedVideoUrl(clip?.jobId ?? null, clip ? jobsById.get(clip.jobId)?.contentUrl : null);

  const updatePreviewFade = useCallback((video: HTMLVideoElement) => {
    if (!clip || !fadeOverlayRef.current) return;
    const opacity = projectClipOpacity(clips, selectedIndex, video.currentTime);
    fadeOverlayRef.current.style.opacity = String(1 - opacity);
  }, [clip, clips, selectedIndex]);

  const stopPreviewFade = useCallback(() => {
    if (fadeAnimationRef.current !== null) cancelAnimationFrame(fadeAnimationRef.current);
    fadeAnimationRef.current = null;
  }, []);

  const animatePreviewFade = useCallback(() => {
    stopPreviewFade();
    const frame = () => {
      const video = videoRef.current;
      if (!video) return;
      updatePreviewFade(video);
      if (!video.paused && !video.ended) fadeAnimationRef.current = requestAnimationFrame(frame);
    };
    frame();
  }, [stopPreviewFade, updatePreviewFade]);

  useEffect(() => {
    stopPreviewFade();
    return stopPreviewFade;
  }, [clip?.id, stopPreviewFade]);

  useEffect(() => {
    if (videoRef.current) updatePreviewFade(videoRef.current);
  }, [updatePreviewFade]);

  useEffect(() => {
    const handlePlaybackShortcut = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video || !shouldToggleProjectPlayback(event)) return;
      event.preventDefault();
      if (event.target instanceof Element && event.target.closest("[data-project-timeline]")) {
        event.stopPropagation();
      }
      if (!video.paused) {
        video.pause();
        return;
      }
      if (clip && isProjectPlaybackBoundary(clip, video.currentTime, video.ended)) {
        video.currentTime = clip.inPoint;
        onPosition(clip.id, clip.inPoint);
      }
      void video.play();
    };
    window.addEventListener("keydown", handlePlaybackShortcut, true);
    return () => window.removeEventListener("keydown", handlePlaybackShortcut, true);
  }, [clip, onPosition]);

  const advancePreview = useCallback((shouldContinue: boolean) => {
    const next = clips[selectedIndex + 1];
    continuePlaybackRef.current = shouldContinue;
    if (!next) {
      advancingRef.current = false;
      continuePlaybackRef.current = false;
      videoRef.current?.pause();
      return;
    }
    advancingRef.current = shouldContinue;
    onSelectClip(next.id);
  }, [clips, onSelectClip, selectedIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    video.playbackRate = clip.playbackRate;
    if (video.readyState >= 1 && (video.currentTime < clip.inPoint || video.currentTime > clip.outPoint)) {
      video.currentTime = clip.inPoint;
      onPosition(clip.id, clip.inPoint);
    }
  }, [clip?.id, clip?.inPoint, clip?.outPoint, clip?.playbackRate, onPosition]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || video.readyState < 1 || seekTarget?.clipId !== clip.id) return;
    video.currentTime = Math.max(clip.inPoint, Math.min(clip.outPoint, seekTarget.sourceTime));
  }, [clip?.id, seekTarget?.requestId]);

  return (
    <section className="flex min-h-0 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_20%,rgba(66,172,255,.08),transparent_45%)] p-5 sm:p-8">
      {clip && localVideo.url ? <div className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-xl bg-black" style={{ aspectRatio: aspect.replace(":", "/") }}>
        <video
          key={`${clip.id}:${localVideo.url}`}
          ref={videoRef}
          src={localVideo.url}
          autoPlay={advancingRef.current && continuePlaybackRef.current}
          controls
          playsInline
          className="max-h-[52dvh] max-w-full rounded-xl bg-black object-contain shadow-[0_22px_70px_rgba(0,0,0,.45)]"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const requestedTime = seekTarget?.clipId === clip.id ? seekTarget.sourceTime : clip.inPoint;
            video.currentTime = Math.min(Math.max(clip.inPoint, requestedTime), Math.max(0, video.duration - 0.05));
            video.playbackRate = clip.playbackRate;
            onPosition(clip.id, video.currentTime);
            updatePreviewFade(video);
            if (Number.isFinite(video.duration) && Math.abs(video.duration - clip.sourceDuration) > 0.1) {
              const usedFullSource = Math.abs(clip.outPoint - clip.sourceDuration) < 0.1;
              onUpdateClip(clip.id, { sourceDuration: video.duration, outPoint: usedFullSource ? video.duration : Math.min(clip.outPoint, video.duration) });
            }
            if (advancingRef.current && continuePlaybackRef.current) {
              advancingRef.current = false;
              void video.play().catch(() => { continuePlaybackRef.current = false; });
            }
          }}
          onPlay={() => { continuePlaybackRef.current = true; animatePreviewFade(); }}
          onPause={(event) => {
            stopPreviewFade();
            updatePreviewFade(event.currentTarget);
            if (!advancingRef.current && !isProjectPlaybackBoundary(clip, event.currentTarget.currentTime, event.currentTarget.ended)) {
              continuePlaybackRef.current = false;
            }
          }}
          onTimeUpdate={(event) => {
            updatePreviewFade(event.currentTarget);
            onPosition(clip.id, event.currentTarget.currentTime);
            if (advancingRef.current || !isProjectPlaybackBoundary(clip, event.currentTarget.currentTime, event.currentTarget.ended)) return;
            advancePreview(continuePlaybackRef.current);
          }}
          onSeeked={(event) => updatePreviewFade(event.currentTarget)}
          onEnded={() => { if (!advancingRef.current) advancePreview(continuePlaybackRef.current); }}
        />
        <div ref={fadeOverlayRef} className="pointer-events-none absolute inset-0 bg-black opacity-0" aria-hidden="true" />
      </div> : <div className="text-center">{localVideo.loading ? <LoaderCircle size={24} className="mx-auto animate-spin text-white/20" /> : <Film size={24} className="mx-auto text-white/18" />}<p className="mt-3 text-xs text-white/35">{localVideo.loading ? "Loading video from this device…" : clip ? "Video unavailable on this device." : "Add a video to begin your sequence."}</p>{clip && !localVideo.loading && <button type="button" onClick={() => onRemoveClip(clip.id)} className="mt-4 rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-semibold text-white/55 hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-300">Remove clip</button>}</div>}
    </section>
  );
}

function ClipTrimControl({ clip, onUpdate }: {
  clip: ProjectClip;
  onUpdate: (patch: Partial<ProjectClip>) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const sourceDuration = Math.max(MIN_CLIP_SECONDS, clip.sourceDuration);
  const startPercent = (clip.inPoint / sourceDuration) * 100;
  const endPercent = (clip.outPoint / sourceDuration) * 100;

  const updateFromPointer = useCallback((edge: "start" | "end", clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const value = projectClipTrimValue(clip, edge, fraction * sourceDuration);
    onUpdate(edge === "start" ? { inPoint: value } : { outPoint: value });
  }, [clip, onUpdate, sourceDuration]);

  const beginDrag = (edge: "start" | "end", event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(edge, event.clientX);
  };

  const continueDrag = (edge: "start" | "end", event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      updateFromPointer(edge, event.clientX);
    }
  };

  const nudgeHandle = (edge: "start" | "end", event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const current = edge === "start" ? clip.inPoint : clip.outPoint;
    const step = event.shiftKey ? 0.25 : 0.05;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = current - step;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = current + step;
    if (event.key === "Home") next = edge === "start" ? 0 : clip.inPoint + MIN_CLIP_SECONDS;
    if (event.key === "End") next = edge === "start" ? clip.outPoint - MIN_CLIP_SECONDS : sourceDuration;
    if (next === null) return;
    event.preventDefault();
    const value = projectClipTrimValue(clip, edge, next);
    onUpdate(edge === "start" ? { inPoint: value } : { outPoint: value });
  };

  const handle = (edge: "start" | "end", percent: number, value: number) => (
    <button
      type="button"
      role="slider"
      aria-label={`Trim ${edge}`}
      aria-orientation="horizontal"
      aria-valuemin={edge === "start" ? 0 : clip.inPoint + MIN_CLIP_SECONDS}
      aria-valuemax={edge === "start" ? clip.outPoint - MIN_CLIP_SECONDS : sourceDuration}
      aria-valuenow={value}
      aria-valuetext={formatSeconds(value)}
      title={`Trim ${edge}: ${formatSeconds(value)}`}
      onKeyDown={(event) => nudgeHandle(edge, event)}
      onPointerDown={(event) => beginDrag(edge, event)}
      onPointerMove={(event) => continueDrag(edge, event)}
      className="absolute inset-y-0 z-10 w-5 -translate-x-1/2 touch-none cursor-ew-resize rounded-sm bg-reelo-accent/90 p-0 transition-colors after:absolute after:inset-y-[15px] after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-black/70 after:shadow-[-4px_0_0_rgba(0,0,0,.4),4px_0_0_rgba(0,0,0,.4)] hover:bg-[#66ccff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      style={{ left: `${percent}%` }}
    />
  );

  return (
    <div role="group" aria-label="Clip trim range">
      <div className="flex items-center justify-between text-[10px] tabular-nums text-white/42">
        <span><b className="mr-1.5 font-medium text-white/68">Start</b>{formatSeconds(clip.inPoint)}</span>
        <span>{formatSeconds(clip.outPoint)}<b className="ml-1.5 font-medium text-white/68">End</b></span>
      </div>
      <div ref={trackRef} className="relative mt-2 h-12 touch-none">
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-reelo-accent/30 bg-[#050505]"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.055) 0 7px, transparent 7px 11px)" }}
        >
          <div
            className="absolute inset-y-0 border-x border-reelo-accent/45 bg-[linear-gradient(135deg,rgba(68,170,255,.28),rgba(255,255,255,.07))]"
            style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
          />
        </div>
        {handle("start", startPercent, clip.inPoint)}
        {handle("end", endPercent, clip.outPoint)}
      </div>
    </div>
  );
}

function ClipInspector({ clip, job, index, clipCount, onUpdate, onRemove, onMove, onRemix }: {
  clip: ProjectClip | null;
  job: Job | null;
  index: number;
  clipCount: number;
  onUpdate: (clipId: string, patch: Partial<ProjectClip>) => void;
  onRemove: (clipId: string) => void;
  onMove: (clipId: string, delta: number) => void;
  onRemix: (job: Job) => void;
}) {
  if (!clip) return <motion.aside initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t border-white/7 p-5 text-xs text-white/32 lg:border-l lg:border-t-0">Select a clip to edit it.</motion.aside>;
  return (
    <motion.aside initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16 }} className="border-t border-white/7 p-4 lg:border-l lg:border-t-0 lg:p-5">
      <div className="flex items-center justify-between"><div><span className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/32">Clip {index + 1}</span><p className="mt-1 max-w-[21ch] truncate text-xs font-semibold text-white/75">{job?.prompt || "Unavailable video"}</p></div><div className="flex gap-1"><button type="button" disabled={index <= 0} onClick={() => onMove(clip.id, -1)} className="flex size-7 items-center justify-center rounded-full text-white/42 hover:bg-white/7 hover:text-white disabled:opacity-20" aria-label="Move clip left"><ChevronLeft size={14} /></button><button type="button" disabled={index >= clipCount - 1} onClick={() => onMove(clip.id, 1)} className="flex size-7 items-center justify-center rounded-full text-white/42 hover:bg-white/7 hover:text-white disabled:opacity-20" aria-label="Move clip right"><ChevronRight size={14} /></button></div></div>
      <div className="mt-6 space-y-5">
        <ClipTrimControl clip={clip} onUpdate={(patch) => onUpdate(clip.id, patch)} />
        <div><span className="text-[10px] font-medium text-white/65">Speed</span><div className="mt-2 grid grid-cols-3 gap-1">{SPEEDS.map((speed) => <button key={speed} type="button" onClick={() => onUpdate(clip.id, { playbackRate: speed })} className={`rounded-lg py-1.5 text-[9px] font-bold ${clip.playbackRate === speed ? "bg-reelo-accent text-black" : "bg-white/[.045] text-white/48 hover:bg-white/8 hover:text-white"}`}>{speed}×</button>)}</div></div>
        {index > 0 && <div><span className="text-[10px] font-medium text-white/65">Transition before</span><div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-white/[.025] p-1">
          <button type="button" aria-pressed={clip.transitionIn === "cut"} onClick={() => onUpdate(clip.id, { transitionIn: "cut" })} className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[9px] font-bold transition-colors ${clip.transitionIn === "cut" ? "bg-white/10 text-white" : "text-white/38 hover:bg-white/[.055] hover:text-white/70"}`}><Scissors size={11} /> Cut</button>
          <button type="button" aria-pressed={clip.transitionIn !== "cut"} onClick={() => onUpdate(clip.id, { transitionIn: "fade-black" })} className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[9px] font-bold transition-colors ${clip.transitionIn !== "cut" ? "bg-reelo-accent text-black" : "text-white/38 hover:bg-white/[.055] hover:text-white/70"}`}><Blend size={11} /> Fade · 0.3s</button>
        </div></div>}
      </div>
      <div className="mt-6 flex gap-2"><button type="button" disabled={!job} onClick={() => job && onRemix(job)} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/[.055] px-3 py-2 text-[10px] font-semibold text-white/68 hover:bg-white/10 hover:text-white disabled:opacity-35"><RemixIcon size={12} /> Remix</button><button type="button" onClick={() => onUpdate(clip.id, { inPoint: 0, outPoint: clip.sourceDuration, playbackRate: 1 })} className="flex size-8 items-center justify-center rounded-lg bg-white/[.055] text-white/50 hover:bg-white/10 hover:text-white" title="Reset edits"><RotateCcw size={12} /></button><button type="button" onClick={() => onRemove(clip.id)} className="flex size-8 items-center justify-center rounded-lg bg-white/[.055] text-white/45 hover:bg-red-500/15 hover:text-red-300" title="Remove from project"><Trash2 size={12} /></button></div>
    </motion.aside>
  );
}
