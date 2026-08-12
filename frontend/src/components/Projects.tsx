import { ArrowLeft, ChevronLeft, ChevronRight, Film, GripVertical, Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
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
import { clipDuration, MIN_CLIP_SECONDS } from "../lib/projects";
import type { AspectId, Job, LocalProject, ProjectClip } from "../types";
import { RemixIcon } from "./icons";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const TIMELINE_DRAG_HOLD_MS = 250;
const TIMELINE_SCROLL_CANCEL_X_PX = 6;

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return minutes ? `${minutes}:${seconds.toFixed(1).padStart(4, "0")}` : `${seconds.toFixed(1)}s`;
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
          <button type="button" onClick={onOpenLibrary} className="m-2 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[11px] text-white/43 hover:bg-white/5 hover:text-white"><ArrowLeft size={13} /> Back to videos</button>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="flex items-center gap-2 border-b border-white/7 p-3 md:hidden">
            <button type="button" onClick={onOpenLibrary} className="flex size-9 items-center justify-center rounded-full text-white/50 hover:bg-white/7" aria-label="Back to videos"><ArrowLeft size={15} /></button>
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
              onDelete={() => { if (confirm(`Delete “${selectedProject.name}”? The favorited videos will be kept.`)) onDeleteProject(selectedProject.id); }}
              onUpdateClip={(clipId, patch) => onUpdateClip(selectedProject.id, clipId, patch)}
              onRemoveClip={(clipId) => onRemoveClip(selectedProject.id, clipId)}
              onReorderClips={(fromId, toId) => onReorderClips(selectedProject.id, fromId, toId)}
              onMoveClip={(clipId, delta) => onMoveClip(selectedProject.id, clipId, delta)}
              onOpenLibrary={onOpenLibrary}
              onRemix={onRemix}
            />
          ) : (
            <div className="flex min-h-[70dvh] items-center justify-center px-6 text-center">
              <div className="max-w-xs"><Film size={24} className="mx-auto text-white/20" /><h1 className="mt-5 text-lg font-semibold text-white">Start a local project</h1><p className="mt-2 text-xs leading-5 text-white/42">Arrange favorited H3 videos into a lightweight sequence saved on this device.</p><button type="button" onClick={createAndSelect} className="mt-5 rounded-full bg-reelo-accent px-4 py-2 text-xs font-bold text-black">New project</button></div>
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
  const [name, setName] = useState(project.name);
  const selectedClip = orderedClips.find((clip) => clip.id === selectedClipId) ?? orderedClips[0] ?? null;
  const selectedIndex = selectedClip ? orderedClips.findIndex((clip) => clip.id === selectedClip.id) : -1;
  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const totalDuration = orderedClips.reduce((sum, clip) => sum + clipDuration(clip), 0);

  useEffect(() => {
    if (!selectedClip && orderedClips[0]) setSelectedClipId(orderedClips[0].id);
    if (selectedClipId && !orderedClips.some((clip) => clip.id === selectedClipId)) setSelectedClipId(orderedClips[0]?.id ?? null);
  }, [orderedClips, selectedClip, selectedClipId]);

  return (
    <div className="flex min-h-[calc(100dvh-5.25rem)] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/7 px-4 py-3 sm:px-5">
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => onRename(name)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/25 sm:text-base" aria-label="Project name" />
        <span className="text-[10px] tabular-nums text-white/35">{orderedClips.length} clips · {formatSeconds(totalDuration)}</span>
        <div className="flex rounded-full bg-white/[.035] p-0.5">{(["16:9", "9:16"] as AspectId[]).map((aspect) => <button key={aspect} type="button" onClick={() => onSetAspect(aspect)} className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${project.aspect === aspect ? "bg-white/10 text-white" : "text-white/35 hover:text-white/70"}`}>{aspect}</button>)}</div>
        <button type="button" onClick={onDelete} className="flex size-8 items-center justify-center rounded-full text-white/35 hover:bg-red-500/15 hover:text-red-300" aria-label="Delete project"><Trash2 size={13} /></button>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(300px,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_260px] lg:grid-rows-[minmax(0,1fr)_auto]">
        <ProjectPreview clips={orderedClips} jobsById={jobsById} selectedClipId={selectedClip?.id ?? null} aspect={project.aspect} onSelectClip={setSelectedClipId} onUpdateClip={onUpdateClip} />
        <AnimatePresence mode="wait">
          <ClipInspector key={selectedClip?.id ?? "empty"} clip={selectedClip} job={selectedClip ? jobsById.get(selectedClip.jobId) ?? null : null} index={selectedIndex} clipCount={orderedClips.length} onUpdate={onUpdateClip} onRemove={(clipId) => onRemoveClip(clipId)} onMove={onMoveClip} onRemix={onRemix} />
        </AnimatePresence>
        <div className="border-t border-white/7 lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-2.5 sm:px-5"><span className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/32">Timeline</span><button type="button" onClick={onOpenLibrary} className="flex items-center gap-1.5 text-[10px] font-semibold text-reelo-accent hover:text-white"><Plus size={12} /> Add from videos</button></div>
          {orderedClips.length ? <TimelineStrip clips={orderedClips} jobsById={jobsById} selectedClipId={selectedClip?.id ?? null} onSelect={setSelectedClipId} onReorder={onReorderClips} /> : <div className="px-5 pb-5 text-[11px] text-white/35">No clips yet. Return to Videos and add a completed result.</div>}
        </div>
      </div>
    </div>
  );
}

function TimelineStrip({ clips, jobsById, selectedClipId, onSelect, onReorder }: {
  clips: ProjectClip[];
  jobsById: Map<string, Job>;
  selectedClipId: string | null;
  onSelect: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: TIMELINE_DRAG_HOLD_MS, tolerance: { x: TIMELINE_SCROLL_CANCEL_X_PX } } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const itemIds = clips.map((clip) => clip.id);
  const activeClip = activeClipId ? clips.find((clip) => clip.id === activeClipId) ?? null : null;
  const clipNodesRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  const setClipNode = useCallback((clipId: string, node: HTMLButtonElement | null) => {
    if (node) clipNodesRef.current.set(clipId, node);
    else clipNodesRef.current.delete(clipId);
  }, []);

  useEffect(() => {
    if (activeClipId || !selectedClipId) return;
    clipNodesRef.current.get(selectedClipId)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeClipId, selectedClipId]);

  const handleDragStart = (event: DragStartEvent) => setActiveClipId(String(event.active.id));
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveClipId(null);
    if (!event.over || event.active.id === event.over.id) return;
    onReorder(String(event.active.id), String(event.over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll={false} onDragStart={handleDragStart} onDragCancel={() => setActiveClipId(null)} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
        <div className="flex gap-2 overflow-x-auto px-4 pb-4 sm:px-5" aria-label="Project timeline">
          {clips.map((clip, index) => <SortableTimelineClip key={clip.id} clip={clip} job={jobsById.get(clip.jobId)} position={index + 1} selected={clip.id === selectedClipId} active={clip.id === activeClipId} setClipNode={setClipNode} onSelect={() => onSelect(clip.id)} />)}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>{activeClip ? <TimelineClipFace clip={activeClip} job={jobsById.get(activeClip.jobId)} position={clips.findIndex((clip) => clip.id === activeClip.id) + 1} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function SortableTimelineClip({ clip, job, position, selected, active, setClipNode, onSelect }: {
  clip: ProjectClip;
  job?: Job;
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
  return <TimelineClipFace ref={setCombinedNodeRef} clip={clip} job={job} position={position} selected={selected} dragging={active || isDragging} style={style} onClick={onSelect} attributes={attributes} listeners={listeners} />;
}

type TimelineClipFaceProps = {
  clip: ProjectClip;
  job?: Job;
  position: number;
  selected?: boolean;
  dragging?: boolean;
  overlay?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
  attributes?: ButtonHTMLAttributes<HTMLButtonElement>;
  listeners?: ButtonHTMLAttributes<HTMLButtonElement>;
};

const TimelineClipFace = forwardRef<HTMLButtonElement, TimelineClipFaceProps>(({ clip, job, position, selected = false, dragging = false, overlay = false, style, onClick, attributes, listeners }, ref) => (
  <button
    ref={ref}
    type="button"
    className={`group relative h-24 w-36 shrink-0 touch-pan-x overflow-hidden rounded-xl border text-left transition ${selected ? "border-reelo-accent/65 ring-2 ring-reelo-accent/12" : "border-white/10 hover:border-white/25"} ${dragging ? "opacity-35" : ""} ${overlay ? "z-80 rotate-1 border-reelo-accent/70 opacity-95 shadow-2xl" : ""}`}
    style={style}
    onClick={onClick}
    {...attributes}
    {...listeners}
  >
    {job?.contentUrl ? <video src={job.contentUrl} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 size-full bg-black object-cover" /> : <span className="absolute inset-0 bg-white/[.035]" />}
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black via-black/80 to-transparent px-2 pb-1.5 pt-7 text-[9px] text-white/70"><b>{position}</b><span>{formatSeconds(clipDuration(clip))}</span></span>
    <GripVertical size={13} className="pointer-events-none absolute left-1.5 top-1.5 text-white/55 opacity-0 drop-shadow group-hover:opacity-100 group-focus-visible:opacity-100" />
  </button>
));
TimelineClipFace.displayName = "TimelineClipFace";

function ProjectPreview({ clips, jobsById, selectedClipId, aspect, onSelectClip, onUpdateClip }: {
  clips: ProjectClip[];
  jobsById: Map<string, Job>;
  selectedClipId: string | null;
  aspect: AspectId;
  onSelectClip: (id: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<ProjectClip>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playingSequence, setPlayingSequence] = useState(false);
  const selectedIndex = Math.max(0, clips.findIndex((clip) => clip.id === selectedClipId));
  const clip = clips[selectedIndex] ?? null;
  const job = clip ? jobsById.get(clip.jobId) : null;

  const selectNext = () => {
    if (!clip) return;
    const next = clips[selectedIndex + 1];
    if (next) onSelectClip(next.id);
    else setPlayingSequence(false);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    video.playbackRate = clip.playbackRate;
    if (video.currentTime < clip.inPoint || video.currentTime > clip.outPoint) video.currentTime = clip.inPoint;
  }, [clip]);

  useEffect(() => {
    if (!playingSequence || !videoRef.current || !job?.contentUrl) return;
    void videoRef.current.play().catch(() => setPlayingSequence(false));
  }, [job?.contentUrl, playingSequence, selectedClipId]);

  return (
    <section className="flex min-h-0 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_20%,rgba(66,172,255,.08),transparent_45%)] p-5 sm:p-8">
      {clip && job?.contentUrl ? <div className="relative flex max-h-full max-w-full items-center justify-center" style={{ aspectRatio: aspect.replace(":", "/") }}>
        <video
          key={`${clip.id}:${job.contentUrl}`}
          ref={videoRef}
          src={job.contentUrl}
          controls
          playsInline
          className="max-h-[52dvh] max-w-full rounded-xl bg-black object-contain shadow-[0_22px_70px_rgba(0,0,0,.45)]"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            video.currentTime = Math.min(clip.inPoint, Math.max(0, video.duration - 0.05));
            video.playbackRate = clip.playbackRate;
            if (Number.isFinite(video.duration) && Math.abs(video.duration - clip.sourceDuration) > 0.1) {
              const usedFullSource = Math.abs(clip.outPoint - clip.sourceDuration) < 0.1;
              onUpdateClip(clip.id, { sourceDuration: video.duration, outPoint: usedFullSource ? video.duration : Math.min(clip.outPoint, video.duration) });
            }
            if (playingSequence) void video.play();
          }}
          onTimeUpdate={(event) => {
            if (event.currentTarget.currentTime >= clip.outPoint - 0.03) {
              event.currentTarget.pause();
              if (playingSequence) selectNext();
            }
          }}
          onEnded={() => { if (playingSequence) selectNext(); }}
        />
        <button type="button" onClick={() => {
          if (playingSequence) { setPlayingSequence(false); videoRef.current?.pause(); return; }
          if (clips[0]) onSelectClip(clips[0].id);
          setPlayingSequence(true);
        }} className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-black/72 px-3.5 py-2 text-[10px] font-bold text-white backdrop-blur-md hover:bg-black">
          {playingSequence ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}{playingSequence ? "Pause sequence" : "Play sequence"}
        </button>
      </div> : <div className="text-center"><Film size={24} className="mx-auto text-white/18" /><p className="mt-3 text-xs text-white/35">{clip ? "This local reference is unavailable." : "Add a video to begin your sequence."}</p></div>}
    </section>
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
  const maxStart = Math.max(0, clip.outPoint - MIN_CLIP_SECONDS);
  const minEnd = Math.min(clip.sourceDuration, clip.inPoint + MIN_CLIP_SECONDS);
  return (
    <motion.aside initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16 }} className="border-t border-white/7 p-4 lg:border-l lg:border-t-0 lg:p-5">
      <div className="flex items-center justify-between"><div><span className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/32">Clip {index + 1}</span><p className="mt-1 max-w-[21ch] truncate text-xs font-semibold text-white/75">{job?.prompt || "Unavailable video"}</p></div><div className="flex gap-1"><button type="button" disabled={index <= 0} onClick={() => onMove(clip.id, -1)} className="flex size-7 items-center justify-center rounded-full text-white/42 hover:bg-white/7 hover:text-white disabled:opacity-20" aria-label="Move clip left"><ChevronLeft size={14} /></button><button type="button" disabled={index >= clipCount - 1} onClick={() => onMove(clip.id, 1)} className="flex size-7 items-center justify-center rounded-full text-white/42 hover:bg-white/7 hover:text-white disabled:opacity-20" aria-label="Move clip right"><ChevronRight size={14} /></button></div></div>
      <div className="mt-6 space-y-5">
        <label className="block"><span className="flex justify-between text-[10px] text-white/40"><b className="font-medium text-white/65">Start</b>{formatSeconds(clip.inPoint)}</span><input type="range" min={0} max={maxStart} step={0.05} value={clip.inPoint} onChange={(event) => onUpdate(clip.id, { inPoint: Number(event.target.value) })} className="mt-2 w-full accent-[#47b5ff]" /></label>
        <label className="block"><span className="flex justify-between text-[10px] text-white/40"><b className="font-medium text-white/65">End</b>{formatSeconds(clip.outPoint)}</span><input type="range" min={minEnd} max={clip.sourceDuration} step={0.05} value={clip.outPoint} onChange={(event) => onUpdate(clip.id, { outPoint: Number(event.target.value) })} className="mt-2 w-full accent-[#47b5ff]" /></label>
        <div><span className="text-[10px] font-medium text-white/65">Speed</span><div className="mt-2 grid grid-cols-3 gap-1">{SPEEDS.map((speed) => <button key={speed} type="button" onClick={() => onUpdate(clip.id, { playbackRate: speed })} className={`rounded-lg py-1.5 text-[9px] font-bold ${clip.playbackRate === speed ? "bg-reelo-accent text-black" : "bg-white/[.045] text-white/48 hover:bg-white/8 hover:text-white"}`}>{speed}×</button>)}</div></div>
      </div>
      <div className="mt-6 flex gap-2"><button type="button" disabled={!job} onClick={() => job && onRemix(job)} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/[.055] px-3 py-2 text-[10px] font-semibold text-white/68 hover:bg-white/10 hover:text-white disabled:opacity-35"><RemixIcon size={12} /> Remix</button><button type="button" onClick={() => onUpdate(clip.id, { inPoint: 0, outPoint: clip.sourceDuration, playbackRate: 1 })} className="flex size-8 items-center justify-center rounded-lg bg-white/[.055] text-white/50 hover:bg-white/10 hover:text-white" title="Reset edits"><RotateCcw size={12} /></button><button type="button" onClick={() => onRemove(clip.id)} className="flex size-8 items-center justify-center rounded-lg bg-white/[.055] text-white/45 hover:bg-red-500/15 hover:text-red-300" title="Remove from project"><Trash2 size={12} /></button></div>
    </motion.aside>
  );
}
