import {
  ChevronsLeft,
  Clock,
  Copy,
  Crosshair,
  Download,
  FileVideo,
  Film,
  Flag,
  FlagOff,
  History,
  Layers,
  Lock,
  Magnet,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  Maximize2,
  Monitor,
  PanelRight,
  Radio,
  FastForward,
  Rewind,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Move,
  Trash2,
  Type,
  Unlock,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  X
} from "lucide-react";
import {
  type CSSProperties as ReactCSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { resolveKeyboardShortcut } from "./core/keyboardShortcuts";
import { calculateResizeScale } from "./core/previewResize";
import { calculateRotation } from "./core/previewRotate";
import { fpsToNumber, frameRangeContains, framesToSeconds, framesToTimecode, secondsToFrames } from "./core/time";
import { timelineBoundaryFrames } from "./core/timelineNavigation";
import { hasSoloTracks, isTrackAudibleOrVisible } from "./core/trackVisibility";
import { allClips } from "./core/validation";
import { useProjectStore } from "./store/projectStore";
import type { AssetKind, Clip, Point2D, ProjectAst, StaticOrKeyframed, Track } from "./core/types";

const selectedClip = (project: ProjectAst, clipId: string): Clip | undefined =>
  allClips(project).find(({ clip }) => clip.id === clipId)?.clip;

const timelineEnd = (project: ProjectAst): number =>
  Math.max(1, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.startFrame + clip.durationFrames)));

const activeCanvasClips = (project: ProjectAst, frame: number): Array<{ track: Track; clip: Clip }> => {
  const soloTracksExist = hasSoloTracks(project);
  return allClips(project).filter(({ track, clip }) => {
    if (track.kind === "audio" || !isTrackAudibleOrVisible(project, track, soloTracksExist)) return false;
    return frameRangeContains(frame, clip.startFrame, clip.durationFrames);
  });
};

const staticNumberValue = (value: StaticOrKeyframed<number>, fallback: number): number =>
  value.mode === "static" ? value.value : value.keyframes[0]?.value ?? fallback;

const staticPointValue = (value: StaticOrKeyframed<Point2D>, fallback: Point2D): Point2D =>
  value.mode === "static" ? value.value : value.keyframes[0]?.value ?? fallback;

const aspectLabel = (width: number, height: number): string => {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
};

const clipKind = (project: ProjectAst, clip: Clip): "audio" | "video" | "caption" | "title" | "composition" => {
  if (clip.type === "caption") return "caption";
  if (clip.type === "title") return "title";
  if (clip.type === "composition") return "composition";
  const asset = project.assets.find((candidate) => candidate.id === clip.assetId);
  return asset?.kind === "audio" ? "audio" : "video";
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const isEditingTextInput = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
};

const nearestSnapFrame = (
  frame: number,
  boundaryFrames: number[],
  thresholdFrames: number
): { frame: number; snapped: boolean } => {
  const nearest = boundaryFrames.reduce(
    (best, boundary) => {
      const distance = Math.abs(boundary - frame);
      return distance < best.distance ? { frame: boundary, distance } : best;
    },
    { frame, distance: Number.POSITIVE_INFINITY }
  );

  return nearest.distance <= thresholdFrames ? { frame: nearest.frame, snapped: true } : { frame, snapped: false };
};

const snappedMoveFrame = (
  startFrame: number,
  durationFrames: number,
  boundaryFrames: number[],
  thresholdFrames: number
): { frame: number; guideFrame: number | null } => {
  const startSnap = nearestSnapFrame(startFrame, boundaryFrames, thresholdFrames);
  const endSnap = nearestSnapFrame(startFrame + durationFrames, boundaryFrames, thresholdFrames);
  const startDistance = Math.abs(startSnap.frame - startFrame);
  const endDistance = Math.abs(endSnap.frame - (startFrame + durationFrames));

  if (startSnap.snapped && (!endSnap.snapped || startDistance <= endDistance)) {
    return { frame: Math.max(0, startSnap.frame), guideFrame: startSnap.frame };
  }
  if (endSnap.snapped) {
    return { frame: Math.max(0, endSnap.frame - durationFrames), guideFrame: endSnap.frame };
  }
  return { frame: Math.max(0, startFrame), guideFrame: null };
};

const frameFromClientX = (clientX: number, element: HTMLElement, maxFrame: number): number => {
  const rect = element.getBoundingClientRect();
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return Math.round(ratio * maxFrame);
};

const nearestTimelineLane = (
  timeline: HTMLElement,
  clientX: number,
  clientY: number,
  maxFrame: number
): { trackId: string; frame: number } | null => {
  const lanes = [...timeline.querySelectorAll<HTMLElement>("[data-track-id]")];
  if (lanes.length === 0) return null;
  const lane = lanes.reduce((nearest, candidate) => {
    const nearestRect = nearest.getBoundingClientRect();
    const candidateRect = candidate.getBoundingClientRect();
    const nearestDistance = Math.abs(clientY - (nearestRect.top + nearestRect.height / 2));
    const candidateDistance = Math.abs(clientY - (candidateRect.top + candidateRect.height / 2));
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, lanes[0]);

  return {
    trackId: lane.dataset.trackId ?? "",
    frame: frameFromClientX(clientX, lane, maxFrame)
  };
};

const hideNativeDragImage = (dataTransfer: DataTransfer) => {
  const dragImage = document.createElement("span");
  dragImage.style.position = "fixed";
  dragImage.style.left = "-1000px";
  dragImage.style.top = "-1000px";
  dragImage.style.width = "1px";
  dragImage.style.height = "1px";
  dragImage.style.opacity = "0";
  document.body.appendChild(dragImage);
  dataTransfer.setDragImage(dragImage, 0, 0);
  window.setTimeout(() => dragImage.remove(), 0);
};

const displayTrackName = (name: string): string => name.replace(/^Layer\s*(\d+)$/i, "レイヤー$1");

const timelineLaneOffset = 116;

const supportedAssetExtensions: Record<AssetKind, string[]> = {
  video: ["mp4", "mov", "m4v", "webm", "mkv", "avi"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
  audio: ["wav", "mp3", "aac", "m4a", "flac", "ogg"]
};

const assetKindFromFileName = (name: string): AssetKind => {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (supportedAssetExtensions.audio.includes(extension)) return "audio";
  if (supportedAssetExtensions.image.includes(extension)) return "image";
  return "video";
};

type TextAlign = "left" | "center" | "right";
type TextWeight = "400" | "700";
type TextFontStyle = "normal" | "italic";

interface TextStyleValue {
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  fontWeight: TextWeight;
  fontStyle: TextFontStyle;
  textAlign: TextAlign;
  strokeColor: string;
  strokeWidth: number;
  lineHeight: number;
}

const fontOptions = ["Yu Gothic", "Yu Gothic UI", "Noto Sans JP", "Arial", "Times New Roman", "Courier New"];

const defaultTextStyle: TextStyleValue = {
  fontFamily: "Yu Gothic",
  fontSize: 30,
  color: "#ffffff",
  backgroundEnabled: false,
  backgroundColor: "rgba(0, 0, 0, 0.62)",
  fontWeight: "700",
  fontStyle: "normal",
  textAlign: "center",
  strokeColor: "#000000",
  strokeWidth: 0,
  lineHeight: 1.25
};

const textStyleValue = (raw: unknown): TextStyleValue => {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const textAlign = value.textAlign === "left" || value.textAlign === "center" || value.textAlign === "right"
    ? value.textAlign
    : defaultTextStyle.textAlign;
  const fontWeight = value.fontWeight === "400" || value.fontWeight === "700"
    ? value.fontWeight
    : defaultTextStyle.fontWeight;
  const fontStyle = value.fontStyle === "normal" || value.fontStyle === "italic"
    ? value.fontStyle
    : defaultTextStyle.fontStyle;

  return {
    fontFamily: typeof value.fontFamily === "string" ? value.fontFamily : defaultTextStyle.fontFamily,
    fontSize: typeof value.fontSize === "number" ? clamp(value.fontSize, 8, 180) : defaultTextStyle.fontSize,
    color: typeof value.color === "string" ? value.color : defaultTextStyle.color,
    backgroundEnabled:
      typeof value.backgroundEnabled === "boolean" ? value.backgroundEnabled : defaultTextStyle.backgroundEnabled,
    backgroundColor:
      typeof value.backgroundColor === "string" ? value.backgroundColor : defaultTextStyle.backgroundColor,
    fontWeight,
    fontStyle,
    textAlign,
    strokeColor: typeof value.strokeColor === "string" ? value.strokeColor : defaultTextStyle.strokeColor,
    strokeWidth: typeof value.strokeWidth === "number" ? clamp(value.strokeWidth, 0, 10) : defaultTextStyle.strokeWidth,
    lineHeight: typeof value.lineHeight === "number" ? clamp(value.lineHeight, 0.8, 2.4) : defaultTextStyle.lineHeight
  };
};

function AssetBin() {
  const project = useProjectStore((state) => state.project);
  const importAssetFiles = useProjectStore((state) => state.importAssetFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openAssetDialog = async () => {
    if (window.desktopProject?.openAssetFiles) {
      const files = await window.desktopProject.openAssetFiles();
      importAssetFiles(files);
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <aside className="asset-bin">
      <div className="panel-title">
        <Film aria-hidden />
        <span>素材</span>
      </div>
      <button className="tool-button full asset-import-button" onClick={openAssetDialog}>
        <Upload aria-hidden />
        素材追加
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*,.gif"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])].map((file) => ({
            name: file.name,
            path: file.name,
            kind: assetKindFromFileName(file.name)
          }));
          importAssetFiles(files);
          event.target.value = "";
        }}
      />
      <div className="asset-list">
        <button className="asset-chip sequence" title="現在の編集シーケンス">
          <span className="asset-kind sequence-kind">S</span>
          <strong>{project.name}</strong>
          <small>{project.render.size.width}x{project.render.size.height}</small>
        </button>
        {project.assets.map((asset) => (
          <button className="asset-chip" key={asset.id} title={`${asset.kind}: ${asset.path}`}>
            <span className={`asset-kind ${asset.kind}`}>{asset.kind[0].toUpperCase()}</span>
            <span>{asset.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Preview() {
  const project = useProjectStore((state) => state.project);
  const playheadFrame = useProjectStore((state) => state.playheadFrame);
  const addTextAtPlayhead = useProjectStore((state) => state.addTextAtPlayhead);
  const splitSelectedClipAtPlayhead = useProjectStore((state) => state.splitSelectedClipAtPlayhead);
  const duplicateSelectedClip = useProjectStore((state) => state.duplicateSelectedClip);
  const duplicateSelectedClipAtPlayhead = useProjectStore((state) => state.duplicateSelectedClipAtPlayhead);
  const removeSelectedClip = useProjectStore((state) => state.removeSelectedClip);
  const rippleRemoveSelectedClip = useProjectStore((state) => state.rippleRemoveSelectedClip);
  const selectedClipId = useProjectStore((state) => state.selectedClipId);
  const setSelectedClipId = useProjectStore((state) => state.setSelectedClipId);
  const updateSelectedTransform = useProjectStore((state) => state.updateSelectedTransform);
  const centerSelectedOnCanvas = useProjectStore((state) => state.centerSelectedOnCanvas);
  const fitSelectedToCanvas = useProjectStore((state) => state.fitSelectedToCanvas);
  const alignSelectedHorizontally = useProjectStore((state) => state.alignSelectedHorizontally);
  const alignSelectedVertically = useProjectStore((state) => state.alignSelectedVertically);
  const moveSelectedClipLayer = useProjectStore((state) => state.moveSelectedClipLayer);
  const moveSelectedClipToPlayhead = useProjectStore((state) => state.moveSelectedClipToPlayhead);
  const moveSelectedClipToAdjacentBoundary = useProjectStore((state) => state.moveSelectedClipToAdjacentBoundary);
  const jumpPlayheadToSelectedBoundary = useProjectStore((state) => state.jumpPlayheadToSelectedBoundary);
  const jumpPlayheadToTimelineBoundary = useProjectStore((state) => state.jumpPlayheadToTimelineBoundary);
  const activeClips = activeCanvasClips(project, playheadFrame);
  const frameRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    clipId: string;
    start: Point2D;
    current: Point2D;
    axis: "x" | "y" | null;
  } | null>(null);
  const [resize, setResize] = useState<{
    clipId: string;
    center: Point2D;
    startPointer: Point2D;
    startScale: Point2D;
    currentScale: Point2D;
    direction: Point2D;
  } | null>(null);
  const [rotate, setRotate] = useState<{
    clipId: string;
    center: Point2D;
    startPointer: Point2D;
    startRotation: number;
    currentRotation: number;
  } | null>(null);

  const beginCanvasDrag = (event: ReactPointerEvent<HTMLButtonElement>, clip: Clip, position: Point2D) => {
    event.preventDefault();
    setSelectedClipId(clip.id);
    setDrag({ clipId: clip.id, start: position, current: position, axis: null });
  };

  const updateCanvasDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const raw = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
    if (rotate) {
      const currentRotation = calculateRotation(rotate.startRotation, rotate.center, rotate.startPointer, raw, event.shiftKey);
      setRotate({ ...rotate, currentRotation });
      return;
    }
    if (resize) {
      const currentScale = calculateResizeScale(
        resize.startScale,
        { x: raw.x - resize.startPointer.x, y: raw.y - resize.startPointer.y },
        resize.direction,
        event.shiftKey
      );
      setResize({ ...resize, currentScale });
      return;
    }
    if (!drag) return;
    let axis = drag.axis;
    if (event.ctrlKey && !axis) {
      axis = Math.abs(raw.x - drag.start.x) >= Math.abs(raw.y - drag.start.y) ? "x" : "y";
    }
    const current = event.ctrlKey
      ? {
          x: axis === "y" ? drag.start.x : raw.x,
          y: axis === "x" ? drag.start.y : raw.y
        }
      : raw;
    setDrag({ ...drag, current, axis: event.ctrlKey ? axis : null });
  };

  const finishCanvasDrag = () => {
    if (rotate) {
      setSelectedClipId(rotate.clipId);
      updateSelectedTransform({ rotation: rotate.currentRotation });
      setRotate(null);
      return;
    }
    if (resize) {
      setSelectedClipId(resize.clipId);
      updateSelectedTransform({ scale: resize.currentScale });
      setResize(null);
      return;
    }
    if (!drag) return;
    setSelectedClipId(drag.clipId);
    updateSelectedTransform({ position: drag.current });
    setDrag(null);
  };

  const beginResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    clip: Clip,
    center: Point2D,
    scale: Point2D,
    direction: Point2D
  ) => {
    if (!frameRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = frameRef.current.getBoundingClientRect();
    const startPointer = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
    setSelectedClipId(clip.id);
    setResize({ clipId: clip.id, center, startPointer, startScale: scale, currentScale: scale, direction });
  };

  const beginRotate = (
    event: ReactPointerEvent<HTMLSpanElement>,
    clip: Clip,
    center: Point2D,
    rotation: number
  ) => {
    if (!frameRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = frameRef.current.getBoundingClientRect();
    const startPointer = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
    setSelectedClipId(clip.id);
    setRotate({ clipId: clip.id, center, startPointer, startRotation: rotation, currentRotation: rotation });
  };

  return (
    <section className="preview-panel">
      <div className="preview-toolbar">
        <span />
        <div className="button-row">
          <button className="tool-button" onClick={addTextAtPlayhead}>
            <Type aria-hidden />
            テキスト
          </button>
          <button className="tool-button" title="分割 (Ctrl+K)" onClick={splitSelectedClipAtPlayhead}>
            <Scissors aria-hidden />
            分割
          </button>
          <button className="icon-button" title="選択オブジェクトを複製 (Ctrl+D)" onClick={duplicateSelectedClip}>
            <Copy aria-hidden />
          </button>
          <button className="icon-button" title="選択オブジェクトを再生ヘッドへ複製" onClick={duplicateSelectedClipAtPlayhead}>
            <Clock aria-hidden />
          </button>
          <button className="icon-button" title="選択オブジェクトを削除 (Delete)" onClick={removeSelectedClip}>
            <Trash2 aria-hidden />
          </button>
          <button className="icon-button" title="選択オブジェクトをリップル削除 (Shift+Delete)" onClick={rippleRemoveSelectedClip}>
            <ChevronsLeft aria-hidden />
          </button>
          <button className="icon-button" title="選択オブジェクトを再生ヘッドへ移動" onClick={moveSelectedClipToPlayhead}>
            <Clock aria-hidden />
          </button>
          <button className="icon-button" title="前のオブジェクト境界へ寄せる" onClick={() => moveSelectedClipToAdjacentBoundary("previous")}>
            <MoveLeft aria-hidden />
          </button>
          <button className="icon-button" title="次のオブジェクト境界へ寄せる" onClick={() => moveSelectedClipToAdjacentBoundary("next")}>
            <MoveRight aria-hidden />
          </button>
          <button className="icon-button" title="選択オブジェクトの開始へ移動 ([)" onClick={() => jumpPlayheadToSelectedBoundary("start")}>
            <SkipBack aria-hidden />
          </button>
          <button className="icon-button" title="選択オブジェクトの終了へ移動 (])" onClick={() => jumpPlayheadToSelectedBoundary("end")}>
            <SkipForward aria-hidden />
          </button>
          <button className="icon-button" title="前の境界へ移動 (,)" onClick={() => jumpPlayheadToTimelineBoundary("previous")}>
            <Rewind aria-hidden />
          </button>
          <button className="icon-button" title="次の境界へ移動 (.)" onClick={() => jumpPlayheadToTimelineBoundary("next")}>
            <FastForward aria-hidden />
          </button>
          <button className="icon-button" title="上のレイヤーへ移動" onClick={() => moveSelectedClipLayer("up")}>
            <Layers aria-hidden />
          </button>
          <button className="icon-button" title="下のレイヤーへ移動" onClick={() => moveSelectedClipLayer("down")}>
            <Layers aria-hidden />
          </button>
          <button className="icon-button" title="キャンバス中央へ配置" onClick={centerSelectedOnCanvas}>
            <Crosshair aria-hidden />
          </button>
          <button className="icon-button" title="キャンバス幅に合わせる" onClick={() => fitSelectedToCanvas("width")}>
            <Maximize2 aria-hidden />
          </button>
          <button className="icon-button" title="キャンバス高さに合わせる" onClick={() => fitSelectedToCanvas("height")}>
            <Maximize2 aria-hidden />
          </button>
          <button className="icon-button" title="左へ整列" onClick={() => alignSelectedHorizontally("left")}>
            <MoveLeft aria-hidden />
          </button>
          <button className="icon-button" title="右へ整列" onClick={() => alignSelectedHorizontally("right")}>
            <MoveRight aria-hidden />
          </button>
          <button className="icon-button" title="上へ整列" onClick={() => alignSelectedVertically("top")}>
            <MoveUp aria-hidden />
          </button>
          <button className="icon-button" title="下へ整列" onClick={() => alignSelectedVertically("bottom")}>
            <MoveDown aria-hidden />
          </button>
        </div>
      </div>
      <div className="preview-stage">
        <div
          className="preview-frame"
          ref={frameRef}
          style={{ aspectRatio: `${project.render.size.width} / ${project.render.size.height}` }}
          onPointerMove={updateCanvasDrag}
          onPointerUp={finishCanvasDrag}
          onPointerLeave={finishCanvasDrag}
        >
          <div className="preview-grid" />
          {activeClips.map(({ clip }) => {
            if (!("transform" in clip)) return null;
            const basePosition = staticPointValue(clip.transform.position, { x: 0.5, y: 0.5 });
            const position = drag?.clipId === clip.id ? drag.current : basePosition;
            const baseScale = staticPointValue(clip.transform.scale, { x: 1, y: 1 });
            const scale = resize?.clipId === clip.id ? resize.currentScale : baseScale;
            const opacity = staticNumberValue(clip.transform.opacity, 1);
            const baseRotation = staticNumberValue(clip.transform.rotation, 0);
            const rotation = rotate?.clipId === clip.id ? rotate.currentRotation : baseRotation;
            const isSelected = selectedClipId === clip.id;
            const handles = isSelected ? (
              <>
                <span
                  aria-hidden="true"
                  className="preview-rotate-handle"
                  onPointerDown={(event) => beginRotate(event, clip, position, rotation)}
                />
                <span
                  aria-hidden="true"
                  className="preview-resize-handle top-left"
                  onPointerDown={(event) => beginResize(event, clip, position, scale, { x: -1, y: -1 })}
                />
                <span
                  aria-hidden="true"
                  className="preview-resize-handle top-right"
                  onPointerDown={(event) => beginResize(event, clip, position, scale, { x: 1, y: -1 })}
                />
                <span
                  aria-hidden="true"
                  className="preview-resize-handle bottom-left"
                  onPointerDown={(event) => beginResize(event, clip, position, scale, { x: -1, y: 1 })}
                />
                <span
                  aria-hidden="true"
                  className="preview-resize-handle bottom-right"
                  onPointerDown={(event) => beginResize(event, clip, position, scale, { x: 1, y: 1 })}
                />
              </>
            ) : null;

            if (clip.type === "media") {
              const asset = project.assets.find((candidate) => candidate.id === clip.assetId);
              if (asset?.kind === "audio") return null;
              const assetWidth = asset?.width ?? 1920;
              const assetHeight = asset?.height ?? 1080;
              return (
                <button
                  className={`preview-media ${isSelected ? "selected" : ""}`}
                  key={clip.id}
                  style={{
                    left: `${position.x * 100}%`,
                    top: `${position.y * 100}%`,
                    width: `${Math.max(8, Math.min(180, 72 * scale.x))}%`,
                    aspectRatio: `${assetWidth} / ${assetHeight}`,
                    opacity,
                    transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleY(${scale.y})`
                  }}
                  onPointerDown={(event) => beginCanvasDrag(event, clip, position)}
                  title={clip.id}
                >
                  <span>{clip.name}</span>
                  {handles}
                </button>
              );
            }

            if ("text" in clip) {
              const textStyle = textStyleValue(clip.meta.textStyle);
              return (
                <button
                  className={`preview-text-layer ${clip.type} ${isSelected ? "selected" : ""}`}
                  key={clip.id}
                  style={{
                    left: `${position.x * 100}%`,
                    top: `${position.y * 100}%`,
                    width: `${Math.max(24, Math.min(100, 78 * scale.x))}%`,
                    opacity,
                    transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleY(${scale.y})`,
                    fontFamily: textStyle.fontFamily,
                    fontSize: `${textStyle.fontSize}px`,
                    fontWeight: textStyle.fontWeight,
                    fontStyle: textStyle.fontStyle,
                    color: textStyle.color,
                    background: textStyle.backgroundEnabled ? textStyle.backgroundColor : "transparent",
                    textAlign: textStyle.textAlign,
                    WebkitTextStroke:
                      textStyle.strokeWidth > 0 ? `${textStyle.strokeWidth}px ${textStyle.strokeColor}` : undefined,
                    lineHeight: textStyle.lineHeight
                  }}
                  onPointerDown={(event) => beginCanvasDrag(event, clip, position)}
                  title={clip.id}
                >
                  {clip.text}
                  {handles}
                </button>
              );
            }

            return null;
          })}
        </div>
      </div>
    </section>
  );
}

function SequenceSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((state) => state.project);
  const updateCanvasSize = useProjectStore((state) => state.updateCanvasSize);
  const [width, setWidth] = useState(project.render.size.width);
  const [height, setHeight] = useState(project.render.size.height);

  useEffect(() => {
    setWidth(project.render.size.width);
    setHeight(project.render.size.height);
  }, [project.render.size.width, project.render.size.height]);

  const presets = [
    { label: "9:16", width: 1080, height: 1920 },
    { label: "16:9", width: 1920, height: 1080 },
    { label: "1:1", width: 1080, height: 1080 },
    { label: "4:5", width: 1080, height: 1350 }
  ];

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="sequence-modal" role="dialog" aria-modal="true" aria-label="シーケンス設定">
        <div className="modal-header">
          <div className="panel-title">
            <Settings aria-hidden />
            <span>シーケンス設定</span>
          </div>
          <button className="icon-button" title="閉じる" onClick={onClose}>
            <X aria-hidden />
          </button>
        </div>
        <div className="sequence-summary">
          <span>{project.name}</span>
          <span>
            {project.render.size.width}x{project.render.size.height} /{" "}
            {aspectLabel(project.render.size.width, project.render.size.height)}
          </span>
        </div>
        <div className="canvas-controls modal-controls">
      <div className="preset-group">
        {presets.map((preset) => (
          <button
            className="preset-button"
            key={preset.label}
            onClick={() => updateCanvasSize(preset.width, preset.height)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="compact-number">
        <span>W</span>
        <input min={16} step={2} type="number" value={width} onChange={(event) => setWidth(Number(event.target.value))} />
      </label>
      <label className="compact-number">
        <span>H</span>
        <input min={16} step={2} type="number" value={height} onChange={(event) => setHeight(Number(event.target.value))} />
      </label>
      <button className="tool-button" onClick={() => updateCanvasSize(width, height)}>
        <Monitor aria-hidden />
        適用
      </button>
        </div>
        <p className="modal-note">これはPremiere Proのシーケンス設定に相当するキャンバスサイズです。</p>
      </section>
    </div>
  );
}

function Timeline() {
  const project = useProjectStore((state) => state.project);
  const playheadFrame = useProjectStore((state) => state.playheadFrame);
  const timelineSnappingEnabled = useProjectStore((state) => state.timelineSnappingEnabled);
  const setPlayheadFrame = useProjectStore((state) => state.setPlayheadFrame);
  const toggleTimelineSnapping = useProjectStore((state) => state.toggleTimelineSnapping);
  const addMarkerAtPlayhead = useProjectStore((state) => state.addMarkerAtPlayhead);
  const removeMarkerAtPlayhead = useProjectStore((state) => state.removeMarkerAtPlayhead);
  const jumpPlayheadToMarker = useProjectStore((state) => state.jumpPlayheadToMarker);
  const updateMarker = useProjectStore((state) => state.updateMarker);
  const selectedClipId = useProjectStore((state) => state.selectedClipId);
  const selectedClipIds = useProjectStore((state) => state.selectedClipIds);
  const setSelectedClipId = useProjectStore((state) => state.setSelectedClipId);
  const setSelectedClipIds = useProjectStore((state) => state.setSelectedClipIds);
  const toggleSelectedClipId = useProjectStore((state) => state.toggleSelectedClipId);
  const selectTrackClips = useProjectStore((state) => state.selectTrackClips);
  const moveClipOnTimeline = useProjectStore((state) => state.moveClipOnTimeline);
  const moveSelectedClipsOnTimeline = useProjectStore((state) => state.moveSelectedClipsOnTimeline);
  const trimClipOnTimeline = useProjectStore((state) => state.trimClipOnTimeline);
  const selectTimelineFrame = useProjectStore((state) => state.selectTimelineFrame);
  const toggleTrackLocked = useProjectStore((state) => state.toggleTrackLocked);
  const toggleTrackMuted = useProjectStore((state) => state.toggleTrackMuted);
  const toggleTrackSolo = useProjectStore((state) => state.toggleTrackSolo);
  const contentEndFrame = timelineEnd(project);
  const fps = fpsToNumber(project.render.fps);
  const zoomedOutVisibleFrames = Math.max(1, Math.round(4 * 60 * 60 * fps));
  const zoomedInVisibleFrames = Math.max(1, Math.round((5 / 60) * fps));
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineCanvasRef = useRef<HTMLDivElement>(null);
  const [timelineDrag, setTimelineDrag] = useState<{
    clipId: string;
    sourceTrackId: string;
    targetTrackId: string;
    frame: number;
    anchorStartFrame: number;
    offsetFrames: number;
    durationFrames: number;
    groupClipIds: string[];
    snapGuideFrame: number | null;
  } | null>(null);
  const [timelineTrim, setTimelineTrim] = useState<{
    clipId: string;
    trackId: string;
    edge: "start" | "end";
    startFrame: number;
    durationFrames: number;
    boundaryFrame: number;
    snapGuideFrame: number | null;
  } | null>(null);
  const [markerDrag, setMarkerDrag] = useState<{
    markerId: string;
    originalFrame: number;
    frame: number;
    snapGuideFrame: number | null;
  } | null>(null);
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const [timelineRangeSelect, setTimelineRangeSelect] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    baseSelectedClipIds: string[];
    additive: boolean;
  } | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(0);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(1);
  const visibleFrames = Math.max(
    1,
    Math.round(zoomedOutVisibleFrames * Math.pow(zoomedInVisibleFrames / zoomedOutVisibleFrames, timelineZoom))
  );
  const timelineFrameRange = Math.max(contentEndFrame, visibleFrames);
  const laneViewportWidth = Math.max(1, timelineViewportWidth - timelineLaneOffset);
  const laneWidth = Math.max(laneViewportWidth, Math.round((timelineFrameRange / visibleFrames) * laneViewportWidth));
  const timelineCanvasWidth = timelineLaneOffset + laneWidth;
  const frameToPercent = (frame: number): number =>
    (clamp(frame, 0, timelineFrameRange) / timelineFrameRange) * 100;
  const frameSpanToPercent = (frames: number): number => (frames / timelineFrameRange) * 100;
  const frameToCanvasX = (frame: number): number =>
    timelineLaneOffset + (clamp(frame, 0, timelineFrameRange) / timelineFrameRange) * laneWidth;
  const timelinePlayheadLeft = frameToCanvasX(playheadFrame);
  const snapThresholdFrames = Math.max(1, Math.round((timelineFrameRange / laneWidth) * 10));
  const snapFrames = timelineBoundaryFrames(project);
  const snapGuideLeft =
    timelineSnappingEnabled && timelineDrag?.snapGuideFrame !== null && timelineDrag?.snapGuideFrame !== undefined
      ? frameToCanvasX(timelineDrag.snapGuideFrame)
      : timelineSnappingEnabled && timelineTrim?.snapGuideFrame !== null && timelineTrim?.snapGuideFrame !== undefined
        ? frameToCanvasX(timelineTrim.snapGuideFrame)
      : timelineSnappingEnabled && markerDrag?.snapGuideFrame !== null && markerDrag?.snapGuideFrame !== undefined
        ? frameToCanvasX(markerDrag.snapGuideFrame)
      : null;

  useLayoutEffect(() => {
    const measureTimeline = () => {
      const width = timelineRef.current?.clientWidth ?? 1;
      setTimelineViewportWidth((previous) => (Math.abs(previous - width) < 0.5 ? previous : width));
    };

    measureTimeline();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureTimeline);
    if (timelineRef.current) observer?.observe(timelineRef.current);
    window.addEventListener("resize", measureTimeline);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureTimeline);
    };
  }, []);

  const snapPlayheadFrame = (frame: number): number =>
    timelineSnappingEnabled ? nearestSnapFrame(frame, snapFrames, snapThresholdFrames).frame : frame;

  const frameFromTimelineCanvasX = useCallback((clientX: number): number => {
    const rect = timelineCanvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const laneLeft = rect.left + timelineLaneOffset;
    const ratio = clamp((clientX - laneLeft) / laneWidth, 0, 1);
    return Math.round(ratio * timelineFrameRange);
  }, [laneWidth, timelineFrameRange]);

  const selectNearestClipInTrack = (event: ReactMouseEvent<HTMLElement>, track: Track) => {
    if ((event.target as HTMLElement).closest(".clip-block")) return;
    const frame = frameFromClientX(event.clientX, event.currentTarget, timelineFrameRange);
    const thresholdFrames = Math.max(snapThresholdFrames, Math.round((timelineFrameRange / laneWidth) * 8));
    const candidates = track.clips
      .map((clip) => {
        const endFrame = clip.startFrame + clip.durationFrames;
        const isOwnerFrame = frameRangeContains(frame, clip.startFrame, clip.durationFrames);
        const distance =
          isOwnerFrame
            ? 0
            : Math.min(Math.abs(frame - clip.startFrame), Math.abs(frame - endFrame)) + (frame === endFrame ? 1 : 0);
        return { clip, distance };
      })
      .filter(({ distance }) => distance <= thresholdFrames)
      .sort((a, b) => a.distance - b.distance || a.clip.startFrame - b.clip.startFrame)
      .map(({ clip }) => clip);
    const currentCandidateIndex = candidates.findIndex((clip) => clip.id === selectedClipId);
    const nearest = event.shiftKey
      ? candidates.find((clip) => !selectedClipIds.includes(clip.id)) ?? candidates[0]
      : candidates[currentCandidateIndex >= 0 ? (currentCandidateIndex + 1) % candidates.length : 0];
    if (!nearest) return;
    if (event.shiftKey) {
      toggleSelectedClipId(nearest.id);
      return;
    }
    setSelectedClipId(nearest.id);
  };

  const clipIdsInTimelineRange = (range: NonNullable<typeof timelineRangeSelect>): string[] => {
    if (!timelineCanvasRef.current) return [];
    const rangeLeft = Math.min(range.startX, range.currentX);
    const rangeRight = Math.max(range.startX, range.currentX);
    const rangeTop = Math.min(range.startY, range.currentY);
    const rangeBottom = Math.max(range.startY, range.currentY);
    return [...timelineCanvasRef.current.querySelectorAll<HTMLElement>(".clip-block")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left <= rangeRight && rect.right >= rangeLeft && rect.top <= rangeBottom && rect.bottom >= rangeTop;
      })
      .map((element) => element.title)
      .filter(Boolean);
  };

  const selectionRectStyle = timelineRangeSelect
    ? {
        left: `${Math.min(timelineRangeSelect.startX, timelineRangeSelect.currentX) - (timelineCanvasRef.current?.getBoundingClientRect().left ?? 0)}px`,
        top: `${Math.min(timelineRangeSelect.startY, timelineRangeSelect.currentY) - (timelineCanvasRef.current?.getBoundingClientRect().top ?? 0)}px`,
        width: `${Math.abs(timelineRangeSelect.currentX - timelineRangeSelect.startX)}px`,
        height: `${Math.abs(timelineRangeSelect.currentY - timelineRangeSelect.startY)}px`
      }
    : undefined;

  const previewTrim = (
    trim: NonNullable<typeof timelineTrim>,
    frame: number
  ): { startFrame: number; durationFrames: number; boundaryFrame: number; snapGuideFrame: number | null } => {
    const selected = allClips(project).find(({ clip }) => clip.id === trim.clipId)?.clip;
    if (!selected) return trim;
    const snap = timelineSnappingEnabled
      ? nearestSnapFrame(frame, timelineBoundaryFrames(project, trim.clipId), snapThresholdFrames)
      : { frame, snapped: false };
    const snappedFrame = snap.frame;
    if (trim.edge === "end") {
      const boundaryFrame = Math.max(selected.startFrame + 1, snappedFrame);
      return {
        startFrame: selected.startFrame,
        durationFrames: boundaryFrame - selected.startFrame,
        boundaryFrame,
        snapGuideFrame: snap.snapped ? boundaryFrame : null
      };
    }

    const originalEndFrame = selected.startFrame + selected.durationFrames;
    const minimumStartFrame = selected.type === "media" ? Math.max(0, selected.startFrame - selected.sourceInFrame) : 0;
    const startFrame = Math.min(Math.max(minimumStartFrame, snappedFrame), originalEndFrame - 1);
    return {
      startFrame,
      durationFrames: originalEndFrame - startFrame,
      boundaryFrame: startFrame,
      snapGuideFrame: snap.snapped ? startFrame : null
    };
  };

  useEffect(() => {
    if (!timelineTrim) return;

    const updateTrim = (event: PointerEvent) => {
      const lane = timelineRef.current?.querySelector<HTMLElement>(`[data-track-id="${timelineTrim.trackId}"]`);
      if (!lane) return;
      const frame = frameFromClientX(event.clientX, lane, timelineFrameRange);
      const next = previewTrim(timelineTrim, frame);
      setTimelineTrim({ ...timelineTrim, ...next });
    };

    const finishTrim = (event: PointerEvent) => {
      const lane = timelineRef.current?.querySelector<HTMLElement>(`[data-track-id="${timelineTrim.trackId}"]`);
      const next = lane ? previewTrim(timelineTrim, frameFromClientX(event.clientX, lane, timelineFrameRange)) : timelineTrim;
      trimClipOnTimeline(timelineTrim.clipId, timelineTrim.edge, next.boundaryFrame);
      setTimelineTrim(null);
    };

    window.addEventListener("pointermove", updateTrim);
    window.addEventListener("pointerup", finishTrim, { once: true });
    return () => {
      window.removeEventListener("pointermove", updateTrim);
      window.removeEventListener("pointerup", finishTrim);
    };
  }, [project, timelineFrameRange, timelineSnappingEnabled, timelineTrim, snapThresholdFrames, trimClipOnTimeline]);

  useEffect(() => {
    if (!markerDrag) return;

    const previewMarkerFrame = (clientX: number): { frame: number; snapGuideFrame: number | null } => {
      const frame = frameFromTimelineCanvasX(clientX);
      if (!timelineSnappingEnabled) return { frame, snapGuideFrame: null };
      const snap = nearestSnapFrame(
        frame,
        snapFrames.filter((candidate) => candidate !== markerDrag.originalFrame),
        snapThresholdFrames
      );
      return { frame: snap.frame, snapGuideFrame: snap.snapped ? snap.frame : null };
    };

    const updateMarkerDrag = (event: PointerEvent) => {
      const next = previewMarkerFrame(event.clientX);
      setMarkerDrag({ ...markerDrag, ...next });
    };

    const finishMarkerDrag = (event: PointerEvent) => {
      const next = previewMarkerFrame(event.clientX);
      if (next.frame !== markerDrag.originalFrame) {
        updateMarker(markerDrag.markerId, { frame: next.frame });
      }
      setPlayheadFrame(next.frame);
      setMarkerDrag(null);
    };

    window.addEventListener("pointermove", updateMarkerDrag);
    window.addEventListener("pointerup", finishMarkerDrag, { once: true });
    return () => {
      window.removeEventListener("pointermove", updateMarkerDrag);
      window.removeEventListener("pointerup", finishMarkerDrag);
    };
  }, [
    frameFromTimelineCanvasX,
    markerDrag,
    snapFrames,
    snapThresholdFrames,
    timelineSnappingEnabled,
    updateMarker,
    setPlayheadFrame
  ]);

  const setPlayheadFromRulerPointer = (event: ReactPointerEvent<HTMLElement>): number => {
    const frame = snapPlayheadFrame(frameFromClientX(event.clientX, event.currentTarget, timelineFrameRange));
    setPlayheadFrame(frame);
    return frame;
  };

  const setPlayheadFromTimelinePointer = (event: ReactPointerEvent<HTMLElement>): number | null => {
    if (!timelineRef.current) return null;
    const target = nearestTimelineLane(timelineRef.current, event.clientX, event.clientY, timelineFrameRange);
    if (!target) return null;
    const frame = snapPlayheadFrame(target.frame);
    setPlayheadFrame(frame);
    return frame;
  };

  const updateTimelineDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!timelineRef.current || !timelineDrag) return;
    const target = nearestTimelineLane(timelineRef.current, event.clientX, event.clientY, timelineFrameRange);
    if (!target) return;
    const rawFrame = Math.round(target.frame - timelineDrag.offsetFrames);
    const snapped = timelineSnappingEnabled
      ? snappedMoveFrame(
          rawFrame,
          timelineDrag.durationFrames,
          timelineBoundaryFrames(project, timelineDrag.clipId),
          snapThresholdFrames
        )
      : { frame: rawFrame, guideFrame: null };
    setTimelineDrag({
      ...timelineDrag,
      targetTrackId: target.trackId,
      frame: snapped.frame,
      snapGuideFrame: snapped.guideFrame
    });
  };

  const finishTimelineDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!timelineRef.current || !timelineDrag) return;
    event.preventDefault();
    const target = nearestTimelineLane(timelineRef.current, event.clientX, event.clientY, timelineFrameRange);
    const snapped = target
      ? timelineSnappingEnabled
        ? snappedMoveFrame(
            Math.round(target.frame - timelineDrag.offsetFrames),
            timelineDrag.durationFrames,
            timelineBoundaryFrames(project, timelineDrag.clipId),
            snapThresholdFrames
          )
        : { frame: Math.round(target.frame - timelineDrag.offsetFrames), guideFrame: null }
      : { frame: timelineDrag.frame, guideFrame: timelineDrag.snapGuideFrame };
    if (timelineDrag.groupClipIds.length > 1) {
      moveSelectedClipsOnTimeline(
        timelineDrag.clipId,
        target?.trackId ?? timelineDrag.targetTrackId,
        snapped.frame
      );
    } else {
      moveClipOnTimeline(
        timelineDrag.clipId,
        target?.trackId ?? timelineDrag.targetTrackId,
        snapped.frame
      );
    }
    setTimelineDrag(null);
  };

  return (
    <section className="timeline-panel">
      <div className="timeline-headline">
        <div className="panel-title">
          <Layers aria-hidden />
          <span>タイムライン</span>
          {selectedClipIds.length > 1 ? <span className="selection-count">{selectedClipIds.length}個選択</span> : null}
        </div>
        <div className="timeline-controls">
          <span className="timeline-time">
            <Clock aria-hidden />
            {framesToTimecode(playheadFrame, project.render.fps)}
          </span>
          <button
            className={`icon-button ${timelineSnappingEnabled ? "active" : ""}`}
            title={timelineSnappingEnabled ? "スナップON (S)" : "スナップOFF (S)"}
            onClick={toggleTimelineSnapping}
          >
            <Magnet aria-hidden />
          </button>
          <button className="icon-button" title="現在位置にマーカーを追加 (M)" onClick={addMarkerAtPlayhead}>
            <Flag aria-hidden />
          </button>
          <button className="icon-button" title="現在位置のマーカーを削除" onClick={removeMarkerAtPlayhead}>
            <FlagOff aria-hidden />
          </button>
          <button className="icon-button" title="前のマーカーへ移動 (Ctrl+Shift+M)" onClick={() => jumpPlayheadToMarker("previous")}>
            <Rewind aria-hidden />
          </button>
          <button className="icon-button" title="次のマーカーへ移動 (Shift+M)" onClick={() => jumpPlayheadToMarker("next")}>
            <FastForward aria-hidden />
          </button>
          <label className="timeline-zoom">
            <span>縮尺</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={timelineZoom}
              onInput={(event) => setTimelineZoom(Number(event.currentTarget.value))}
              onChange={(event) => setTimelineZoom(Number(event.currentTarget.value))}
            />
            <span>{framesToTimecode(visibleFrames, project.render.fps)}</span>
          </label>
        </div>
      </div>
      <div
        className="timeline"
        ref={timelineRef}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".timeline-ruler")) return;
          if ((event.target as HTMLElement).closest(".track-head")) return;
          if ((event.target as HTMLElement).closest(".clip-block")) return;
          setTimelineRangeSelect({
            startX: event.clientX,
            startY: event.clientY,
            currentX: event.clientX,
            currentY: event.clientY,
            baseSelectedClipIds: selectedClipIds,
            additive: event.shiftKey
          });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if ((event.target as HTMLElement).closest(".timeline-ruler")) return;
          if ((event.target as HTMLElement).closest(".track-head")) return;
          if (timelineRangeSelect) {
            setTimelineRangeSelect({ ...timelineRangeSelect, currentX: event.clientX, currentY: event.clientY });
            return;
          }
          if (playheadDragging) setPlayheadFromTimelinePointer(event);
        }}
        onPointerUp={(event) => {
          if (timelineRangeSelect) {
            const nextRange = { ...timelineRangeSelect, currentX: event.clientX, currentY: event.clientY };
            const moved = Math.hypot(nextRange.currentX - nextRange.startX, nextRange.currentY - nextRange.startY);
            if (moved >= 4) {
              const rangeClipIds = clipIdsInTimelineRange(nextRange);
              const nextSelectedClipIds = nextRange.additive ? [...nextRange.baseSelectedClipIds, ...rangeClipIds] : rangeClipIds;
              setSelectedClipIds(nextSelectedClipIds);
            } else {
              const frame = setPlayheadFromTimelinePointer(event);
              if (frame !== null) selectTimelineFrame(frame);
            }
            setTimelineRangeSelect(null);
          }
          setPlayheadDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerLeave={() => {
          setPlayheadDragging(false);
          setTimelineRangeSelect(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          updateTimelineDrag(event);
        }}
        onDrop={finishTimelineDrag}
      >
        <div className="timeline-canvas" ref={timelineCanvasRef} style={{ width: `${timelineCanvasWidth}px` }}>
          <div
            className="timeline-ruler"
            onPointerDown={(event) => {
              const frame = setPlayheadFromRulerPointer(event);
              selectTimelineFrame(frame);
              setPlayheadDragging(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (playheadDragging) setPlayheadFromRulerPointer(event);
            }}
            onPointerUp={(event) => {
              setPlayheadDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerLeave={() => setPlayheadDragging(false)}
          >
            <span className="ruler-label start">0</span>
            <span className="ruler-label middle">{framesToTimecode(Math.round(timelineFrameRange / 2), project.render.fps)}</span>
            <span className="ruler-label end">{framesToTimecode(timelineFrameRange, project.render.fps)}</span>
          </div>
          {project.markers.map((marker) => (
            (() => {
              const displayFrame = markerDrag?.markerId === marker.id ? markerDrag.frame : marker.frame;
              return (
            <button
              aria-label={`${marker.label}へ移動`}
              className="timeline-marker-line"
              key={marker.id}
              onClick={(event) => {
                event.stopPropagation();
                setPlayheadFrame(displayFrame);
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMarkerDrag({
                  markerId: marker.id,
                  originalFrame: marker.frame,
                  frame: marker.frame,
                  snapGuideFrame: null
                });
              }}
              style={{ left: `${frameToCanvasX(displayFrame)}px`, "--marker-color": marker.color } as ReactCSSProperties}
              title={`${marker.label}へ移動`}
              type="button"
            />
              );
            })()
          ))}
          <span className="timeline-playhead-line" style={{ left: `${timelinePlayheadLeft}px` }} />
          {snapGuideLeft !== null ? <span className="timeline-snap-line" style={{ left: `${snapGuideLeft}px` }} /> : null}
          {selectionRectStyle ? <span className="timeline-selection-rect" style={selectionRectStyle} /> : null}
          {project.tracks.map((track) => (
            <div
              className={`track-row ${track.locked ? "locked" : ""} ${track.muted ? "muted" : ""} ${
                track.solo ? "solo" : ""
              }`}
              key={track.id}
            >
              <div
                className="track-head"
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest(".track-control-button")) return;
                  event.stopPropagation();
                  selectTrackClips(track.id);
                }}
                title={`${displayTrackName(track.name)}のオブジェクトを選択`}
              >
                <span>{displayTrackName(track.name)}</span>
                <div className="track-controls" aria-label={`${displayTrackName(track.name)} controls`}>
                  <button
                    className={`track-control-button ${track.locked ? "active" : ""}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleTrackLocked(track.id);
                    }}
                    title={track.locked ? "ロック解除" : "レイヤーをロック"}
                    aria-label={track.locked ? "ロック解除" : "レイヤーをロック"}
                  >
                    {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                  <button
                    className={`track-control-button ${track.muted ? "active" : ""}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleTrackMuted(track.id);
                    }}
                    title={track.muted ? "ミュート解除" : "レイヤーをミュート"}
                    aria-label={track.muted ? "ミュート解除" : "レイヤーをミュート"}
                  >
                    {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  </button>
                  <button
                    className={`track-control-button ${track.solo ? "active solo" : ""}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleTrackSolo(track.id);
                    }}
                    title={track.solo ? "ソロ解除" : "レイヤーをソロ"}
                    aria-label={track.solo ? "ソロ解除" : "レイヤーをソロ"}
                  >
                    <Radio size={13} />
                  </button>
                </div>
              </div>
              <div
                className="track-lane layer"
                data-track-id={track.id}
                onClick={(event) => selectNearestClipInTrack(event, track)}
              >
                {track.clips.map((clip) => {
                  const isDragging = timelineDrag?.clipId === clip.id;
                  const isGroupDragging = Boolean(timelineDrag?.groupClipIds.includes(clip.id));
                  const draggedHere = isDragging && timelineDrag.targetTrackId === track.id;
                  const isTrimming = timelineTrim?.clipId === clip.id;
                  const groupDragFrame =
                    timelineDrag && isGroupDragging
                      ? clip.startFrame + (timelineDrag.frame - timelineDrag.anchorStartFrame)
                      : clip.startFrame;
                  const displayFrame = isGroupDragging ? groupDragFrame : isTrimming ? timelineTrim.startFrame : clip.startFrame;
                  const left = frameToPercent(displayFrame);
                  const displayDuration = isTrimming ? timelineTrim.durationFrames : clip.durationFrames;
                  const width = frameSpanToPercent(displayDuration);
                  const kind = clipKind(project, clip);
                  const isSelected = selectedClipIds.includes(clip.id);
                  if (isDragging && !draggedHere) return null;
                  return (
                    <button
                      className={`clip-block ${kind} ${isSelected ? "selected" : ""} ${
                        isDragging ? "dragging" : ""
                      }`}
                      key={clip.id}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      draggable={!track.locked}
                      onClick={(event) => {
                        if (event.shiftKey) {
                          toggleSelectedClipId(clip.id);
                          return;
                        }
                        setSelectedClipId(clip.id);
                      }}
                      onDragStart={(event) => {
                        if (track.locked) {
                          event.preventDefault();
                          return;
                        }
                        const lane = event.currentTarget.closest("[data-track-id]") as HTMLElement | null;
                        const pointerFrame = lane ? frameFromClientX(event.clientX, lane, timelineFrameRange) : clip.startFrame;
                        const offsetFrames = clamp(pointerFrame - clip.startFrame, 0, clip.durationFrames);
                        hideNativeDragImage(event.dataTransfer);
                        event.dataTransfer.effectAllowed = "move";
                        const groupClipIds = selectedClipIds.includes(clip.id) && selectedClipIds.length > 1 ? selectedClipIds : [clip.id];
                        if (!selectedClipIds.includes(clip.id)) {
                          setSelectedClipId(clip.id);
                        }
                        setTimelineDrag({
                          clipId: clip.id,
                          sourceTrackId: track.id,
                          targetTrackId: track.id,
                          frame: clip.startFrame,
                          anchorStartFrame: clip.startFrame,
                          offsetFrames,
                          durationFrames: clip.durationFrames,
                          groupClipIds,
                          snapGuideFrame: null
                        });
                        event.dataTransfer.setData(
                          "application/json",
                          JSON.stringify({ clipId: clip.id, sourceTrackId: track.id })
                        );
                      }}
                      onDragEnd={() => setTimelineDrag(null)}
                      title={clip.id}
                    >
                      {selectedClipId === clip.id && !track.locked ? (
                        <span
                          aria-hidden="true"
                          className="clip-trim-handle start"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSelectedClipId(clip.id);
                            setTimelineTrim({
                              clipId: clip.id,
                              trackId: track.id,
                              edge: "start",
                              startFrame: clip.startFrame,
                              durationFrames: clip.durationFrames,
                              boundaryFrame: clip.startFrame,
                              snapGuideFrame: null
                            });
                          }}
                        />
                      ) : null}
                      <span className="clip-kind">{kind[0].toUpperCase()}</span>
                      <span>{clip.name}</span>
                      {selectedClipId === clip.id && !track.locked ? (
                        <span
                          aria-hidden="true"
                          className="clip-trim-handle end"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSelectedClipId(clip.id);
                            setTimelineTrim({
                              clipId: clip.id,
                              trackId: track.id,
                              edge: "end",
                              startFrame: clip.startFrame,
                              durationFrames: clip.durationFrames,
                              boundaryFrame: clip.startFrame + clip.durationFrames,
                              snapGuideFrame: null
                            });
                          }}
                        />
                      ) : null}
                    </button>
                  );
                })}
                {track.clips
                  .filter(
                    (clip) =>
                      selectedClipIds.includes(clip.id) &&
                      (timelineDrag?.clipId !== clip.id || timelineDrag.targetTrackId === track.id)
                  )
                  .map((clip) => {
                    const isDragging = timelineDrag?.clipId === clip.id;
                    const isGroupDragging = Boolean(timelineDrag?.groupClipIds.includes(clip.id));
                    const isTrimming = timelineTrim?.clipId === clip.id;
                    const groupDragFrame =
                      timelineDrag && isGroupDragging
                        ? clip.startFrame + (timelineDrag.frame - timelineDrag.anchorStartFrame)
                        : clip.startFrame;
                    const displayFrame = isGroupDragging ? groupDragFrame : isTrimming ? timelineTrim.startFrame : clip.startFrame;
                    const left = frameToPercent(displayFrame);
                    const displayDuration = isTrimming ? timelineTrim.durationFrames : clip.durationFrames;
                    const width = frameSpanToPercent(displayDuration);
                    return (
                      <span
                        aria-hidden="true"
                        className="clip-selection-outline"
                        key={`${clip.id}-selection`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    );
                  })}
                {timelineDrag &&
                timelineDrag.targetTrackId === track.id &&
                !track.clips.some((clip) => clip.id === timelineDrag.clipId)
                  ? (() => {
                      const dragged = allClips(project).find(({ clip }) => clip.id === timelineDrag.clipId)?.clip;
                      if (!dragged) return null;
                      const kind = clipKind(project, dragged);
                      const left = frameToPercent(timelineDrag.frame);
                      const width = frameSpanToPercent(dragged.durationFrames);
                      return (
                        <>
                          <button
                            className={`clip-block ${kind} selected dragging`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={dragged.id}
                          >
                            <span className="clip-kind">{kind[0].toUpperCase()}</span>
                            <span>{dragged.name}</span>
                          </button>
                          <span
                            aria-hidden="true"
                            className="clip-selection-outline"
                            style={{ left: `${left}%`, width: `${width}%` }}
                          />
                        </>
                      );
                    })()
                  : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Inspector() {
  const project = useProjectStore((state) => state.project);
  const selectedClipId = useProjectStore((state) => state.selectedClipId);
  const addUnsupportedEffectToSelected = useProjectStore((state) => state.addUnsupportedEffectToSelected);
  const updateSelectedText = useProjectStore((state) => state.updateSelectedText);
  const updateSelectedTextStyle = useProjectStore((state) => state.updateSelectedTextStyle);
  const setSelectedVolume = useProjectStore((state) => state.setSelectedVolume);
  const setSelectedStartFrame = useProjectStore((state) => state.setSelectedStartFrame);
  const setSelectedDurationFrames = useProjectStore((state) => state.setSelectedDurationFrames);
  const updateSelectedTransform = useProjectStore((state) => state.updateSelectedTransform);
  const clip = selectedClip(project, selectedClipId);
  const selectedTrack = project.tracks.find((track) => track.clips.some((candidate) => candidate.id === selectedClipId));

  if (!clip) {
    return (
      <aside className="inspector">
        <div className="panel-title">
          <PanelRight aria-hidden />
          <span>プロパティ</span>
        </div>
      </aside>
    );
  }

  const volume = clip.type === "media" && clip.audio.volume.mode === "static" ? clip.audio.volume.value : 1;
  const position = staticPointValue(clip.transform.position, { x: 0.5, y: 0.5 });
  const scale = staticPointValue(clip.transform.scale, { x: 1, y: 1 });
  const opacity = staticNumberValue(clip.transform.opacity, 1);
  const rotation = staticNumberValue(clip.transform.rotation, 0);
  const textStyle = "text" in clip ? textStyleValue(clip.meta.textStyle) : null;
  const startSeconds = framesToSeconds(clip.startFrame, project.render.fps);
  const durationSeconds = framesToSeconds(clip.durationFrames, project.render.fps);
  const isLocked = Boolean(selectedTrack?.locked);

  return (
    <aside className="inspector">
      <div className="panel-title">
        <PanelRight aria-hidden />
        <span>プロパティ</span>
      </div>
      <dl className="clip-fields">
        <div>
          <dt>ID</dt>
          <dd>{clip.id}</dd>
        </div>
        <div>
          <dt>種別</dt>
          <dd>{clip.type}</dd>
        </div>
        <div>
          <dt>開始</dt>
          <dd>{framesToTimecode(clip.startFrame, project.render.fps)}</dd>
        </div>
        <div>
          <dt>長さ</dt>
          <dd>{framesToTimecode(clip.durationFrames, project.render.fps)}</dd>
        </div>
      </dl>
      {isLocked ? <div className="locked-note">このレイヤーはロック中です。</div> : null}
      <fieldset className="property-controls" disabled={isLocked}>
        <div className="section-title">
          <Clock aria-hidden />
          <span>時間</span>
        </div>
        <div className="inline-fields">
          <label className="field">
            <span>開始秒</span>
            <input
              key={`${clip.id}-start-${clip.startFrame}`}
              min={0}
              step={0.001}
              type="number"
              defaultValue={startSeconds.toFixed(3)}
              onBlur={(event) => setSelectedStartFrame(secondsToFrames(Number(event.target.value), project.render.fps))}
            />
          </label>
          <label className="field">
            <span>長さ秒</span>
            <input
              key={`${clip.id}-duration-${clip.durationFrames}`}
              min={0.001}
              step={0.001}
              type="number"
              defaultValue={durationSeconds.toFixed(3)}
              onBlur={(event) => setSelectedDurationFrames(secondsToFrames(Number(event.target.value), project.render.fps))}
            />
          </label>
        </div>
        {"text" in clip ? (
        <>
          <label className="field">
            <span>テキスト</span>
            <textarea
              key={clip.id}
              defaultValue={clip.text}
              rows={4}
              onBlur={(event) => updateSelectedText(event.target.value)}
            />
          </label>
          {textStyle ? (
            <>
              <div className="section-title">
                <Type aria-hidden />
                <span>テキスト設定</span>
              </div>
              <label className="field">
                <span>フォント</span>
                <select
                  value={textStyle.fontFamily}
                  onChange={(event) => updateSelectedTextStyle({ fontFamily: event.target.value })}
                >
                  {fontOptions.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field compact">
                <span>サイズ {textStyle.fontSize.toFixed(0)}px</span>
                <input
                  type="range"
                  min={8}
                  max={180}
                  step={1}
                  value={textStyle.fontSize}
                  onChange={(event) => updateSelectedTextStyle({ fontSize: Number(event.target.value) })}
                />
              </label>
              <div className="inline-fields">
                <label className="field">
                  <span>文字色</span>
                  <input
                    type="color"
                    value={textStyle.color}
                    onChange={(event) => updateSelectedTextStyle({ color: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>線色</span>
                  <input
                    type="color"
                    value={textStyle.strokeColor}
                    onChange={(event) => updateSelectedTextStyle({ strokeColor: event.target.value })}
                  />
                </label>
              </div>
              <label className="field compact">
                <span>線幅 {textStyle.strokeWidth.toFixed(0)}px</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={textStyle.strokeWidth}
                  onChange={(event) => updateSelectedTextStyle({ strokeWidth: Number(event.target.value) })}
                />
              </label>
              <div className="segmented-row">
                <button
                  className={`mini-toggle ${textStyle.fontWeight === "700" ? "active" : ""}`}
                  onClick={() =>
                    updateSelectedTextStyle({ fontWeight: textStyle.fontWeight === "700" ? "400" : "700" })
                  }
                >
                  B
                </button>
                <button
                  className={`mini-toggle ${textStyle.fontStyle === "italic" ? "active" : ""}`}
                  onClick={() =>
                    updateSelectedTextStyle({ fontStyle: textStyle.fontStyle === "italic" ? "normal" : "italic" })
                  }
                >
                  I
                </button>
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    className={`mini-toggle ${textStyle.textAlign === align ? "active" : ""}`}
                    key={align}
                    onClick={() => updateSelectedTextStyle({ textAlign: align })}
                  >
                    {align === "left" ? "左" : align === "center" ? "中" : "右"}
                  </button>
                ))}
              </div>
              <label className="field checkbox-field">
                <input
                  type="checkbox"
                  checked={textStyle.backgroundEnabled}
                  onChange={(event) => updateSelectedTextStyle({ backgroundEnabled: event.target.checked })}
                />
                <span>背景を表示</span>
              </label>
              <label className="field">
                <span>背景色</span>
                <input
                  type="color"
                  value={textStyle.backgroundColor.startsWith("#") ? textStyle.backgroundColor : "#000000"}
                  onChange={(event) => updateSelectedTextStyle({ backgroundColor: event.target.value })}
                />
              </label>
              <label className="field compact">
                <span>行間 {textStyle.lineHeight.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.8}
                  max={2.4}
                  step={0.05}
                  value={textStyle.lineHeight}
                  onChange={(event) => updateSelectedTextStyle({ lineHeight: Number(event.target.value) })}
                />
              </label>
            </>
          ) : null}
        </>
        ) : null}
        {clip.type === "media" ? (
        <label className="field">
          <span>音量 {volume.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={volume}
            onChange={(event) => setSelectedVolume(Number(event.target.value))}
          />
        </label>
        ) : null}
        <div className="section-title">
          <Move aria-hidden />
          <span>配置</span>
        </div>
        <label className="field compact">
          <span>X {(position.x * 100).toFixed(0)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={position.x}
            onChange={(event) => updateSelectedTransform({ position: { ...position, x: Number(event.target.value) } })}
          />
        </label>
        <label className="field compact">
          <span>Y {(position.y * 100).toFixed(0)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={position.y}
            onChange={(event) => updateSelectedTransform({ position: { ...position, y: Number(event.target.value) } })}
          />
        </label>
        <label className="field compact">
          <span>Scale X {scale.x.toFixed(2)}</span>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.01}
            value={scale.x}
            onChange={(event) => updateSelectedTransform({ scale: { ...scale, x: Number(event.target.value) } })}
          />
        </label>
        <label className="field compact">
          <span>Scale Y {scale.y.toFixed(2)}</span>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.01}
            value={scale.y}
            onChange={(event) => updateSelectedTransform({ scale: { ...scale, y: Number(event.target.value) } })}
          />
        </label>
        <label className="field compact">
          <span>Opacity {opacity.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(event) => updateSelectedTransform({ opacity: Number(event.target.value) })}
          />
        </label>
        <label className="field compact">
          <span>Rotation {rotation.toFixed(0)}deg</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={(event) => updateSelectedTransform({ rotation: Number(event.target.value) })}
          />
        </label>
        <button className="tool-button full" onClick={addUnsupportedEffectToSelected}>
          <Wand2 aria-hidden />
          future-glow
        </button>
        <div className="effect-list">
          {clip.effects.length === 0 ? <span>effects: []</span> : clip.effects.map((effect) => <span key={effect.id}>{effect.type}</span>)}
        </div>
      </fieldset>
    </aside>
  );
}

function LlmPanel() {
  const llmText = useProjectStore((state) => state.llmText);
  const setLlmText = useProjectStore((state) => state.setLlmText);
  const submitLlmPrompt = useProjectStore((state) => state.submitLlmPrompt);
  const llmStatus = useProjectStore((state) => state.llmStatus);

  return (
    <section className="llm-panel">
      <div className="panel-title">
        <Sparkles aria-hidden />
        <span>LLMCG 指示</span>
      </div>
      <textarea className="llm-input" value={llmText} onChange={(event) => setLlmText(event.target.value)} />
      <div className="button-row">
        <button className="tool-button primary" onClick={submitLlmPrompt}>
          <Wand2 aria-hidden />
          llmへ
        </button>
      </div>
      <div className="llm-status">{llmStatus}</div>
    </section>
  );
}

function ProjectPanel() {
  const project = useProjectStore((state) => state.project);
  const setPlayheadFrame = useProjectStore((state) => state.setPlayheadFrame);
  const renderPlan = useProjectStore((state) => state.renderPlan);
  const renderStatus = useProjectStore((state) => state.renderStatus);
  const renderWarnings = useProjectStore((state) => state.renderWarnings);
  const exportVideo = useProjectStore((state) => state.exportVideo);
  const exportProjectFileText = useProjectStore((state) => state.exportProjectFileText);
  const loadProjectFileText = useProjectStore((state) => state.loadProjectFileText);
  const removeMarker = useProjectStore((state) => state.removeMarker);
  const updateMarker = useProjectStore((state) => state.updateMarker);
  const lastError = useProjectStore((state) => state.lastError);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const markerFrameStep = framesToSeconds(1, project.render.fps).toFixed(6);

  const saveProject = async () => {
    const text = exportProjectFileText();
    if (window.desktopProject?.saveProject) {
      await window.desktopProject.saveProject(text);
      return;
    }
    const blob = new Blob([text], { type: "application/x-mesproj" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sample-short.mesproj";
    link.click();
    URL.revokeObjectURL(url);
  };

  const openProject = async () => {
    if (window.desktopProject?.openProject) {
      const result = await window.desktopProject.openProject();
      if (result) loadProjectFileText(result);
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <section className="data-panel">
      <div className="panel-title">
        <FileVideo aria-hidden />
        <span>プロジェクト</span>
      </div>
      {lastError ? <div className="error-line">{lastError}</div> : null}
      {renderWarnings.length > 0 ? (
        <div className="warning-list">
          {renderWarnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mesproj"
        hidden
        onChange={async (event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          loadProjectFileText(await file.text());
          input.value = "";
        }}
      />
      <div className="project-actions">
        <button className="tool-button" onClick={saveProject}>
          <Save aria-hidden />
          保存
        </button>
        <button className="tool-button" onClick={openProject}>
          <Upload aria-hidden />
          読込
        </button>
        <button className="tool-button" onClick={exportVideo}>
          <Download aria-hidden />
          書き出し
        </button>
      </div>
      <div className="marker-list">
        <div className="section-title">
          <Flag aria-hidden />
          <span>マーカー</span>
        </div>
        {project.markers.length === 0 ? <span className="empty-note">マーカーなし</span> : null}
        {project.markers.map((marker) => (
          <div className="marker-row" key={marker.id}>
            <button
              className="marker-jump"
              type="button"
              onClick={() => setPlayheadFrame(marker.frame)}
              title={`${framesToTimecode(marker.frame, project.render.fps)}へ移動`}
            >
              {framesToTimecode(marker.frame, project.render.fps)}
            </button>
            <input
              aria-label={`${marker.label} label`}
              value={marker.label}
              onChange={(event) => updateMarker(marker.id, { label: event.target.value })}
            />
            <input
              aria-label={`${marker.label} seconds`}
              type="number"
              min={0}
              step={markerFrameStep}
              value={framesToSeconds(marker.frame, project.render.fps)}
              onChange={(event) => updateMarker(marker.id, { frame: secondsToFrames(Number(event.target.value), project.render.fps) })}
            />
            <input
              aria-label={`${marker.label} color`}
              type="color"
              value={marker.color.startsWith("#") ? marker.color : "#f3d77c"}
              onChange={(event) => updateMarker(marker.id, { color: event.target.value })}
            />
            <button className="marker-remove" type="button" title={`${marker.label}を削除`} onClick={() => removeMarker(marker.id)}>
              <Trash2 aria-hidden />
            </button>
          </div>
        ))}
      </div>
      {renderPlan || renderStatus ? <div className="render-status">{renderStatus ?? "書き出し設定を作成済み"}</div> : null}
    </section>
  );
}

function TopBar({ onOpenSequenceSettings }: { onOpenSequenceSettings: () => void }) {
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const resetSample = useProjectStore((state) => state.resetSample);
  const history = useProjectStore((state) => state.history);
  return (
    <header className="topbar">
      <div className="brand">
        <Film aria-hidden />
        <span>Movie Edit Software</span>
      </div>
      <div className="top-actions">
        <button className="icon-button" title="Undo" onClick={undo} disabled={history.cursor === 0}>
          <RotateCcw aria-hidden />
        </button>
        <button className="icon-button" title="Redo" onClick={redo} disabled={history.cursor === history.entries.length}>
          <RotateCw aria-hidden />
        </button>
        <button className="tool-button" onClick={resetSample}>
          <History aria-hidden />
          リセット
        </button>
        <button className="tool-button" onClick={onOpenSequenceSettings}>
          <Settings aria-hidden />
          シーケンス設定
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const [sequenceSettingsOpen, setSequenceSettingsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditingTextInput(event.target)) return;
      const action = resolveKeyboardShortcut(event);
      if (!action) return;
      event.preventDefault();

      switch (action) {
        case "undo":
          useProjectStore.getState().undo();
          break;
        case "redo":
          useProjectStore.getState().redo();
          break;
        case "selectAll":
          useProjectStore.getState().selectAllClips();
          break;
        case "clearSelection":
          useProjectStore.getState().clearSelection();
          break;
        case "duplicate":
          useProjectStore.getState().duplicateSelectedClip();
          break;
        case "split":
          useProjectStore.getState().splitSelectedClipAtPlayhead();
          break;
        case "remove":
          useProjectStore.getState().removeSelectedClip();
          break;
        case "rippleRemove":
          useProjectStore.getState().rippleRemoveSelectedClip();
          break;
        case "toggleSnapping":
          useProjectStore.getState().toggleTimelineSnapping();
          break;
        case "addMarker":
          useProjectStore.getState().addMarkerAtPlayhead();
          break;
        case "jumpPreviousMarker":
          useProjectStore.getState().jumpPlayheadToMarker("previous");
          break;
        case "jumpNextMarker":
          useProjectStore.getState().jumpPlayheadToMarker("next");
          break;
        case "jumpSelectedStart":
          useProjectStore.getState().jumpPlayheadToSelectedBoundary("start");
          break;
        case "jumpSelectedEnd":
          useProjectStore.getState().jumpPlayheadToSelectedBoundary("end");
          break;
        case "jumpPreviousBoundary":
          useProjectStore.getState().jumpPlayheadToTimelineBoundary("previous");
          break;
        case "jumpNextBoundary":
          useProjectStore.getState().jumpPlayheadToTimelineBoundary("next");
          break;
        case "stepLeft":
          useProjectStore.getState().setPlayheadFrame(Math.max(0, useProjectStore.getState().playheadFrame - 1));
          break;
        case "stepRight":
          useProjectStore.getState().setPlayheadFrame(useProjectStore.getState().playheadFrame + 1);
          break;
        case "nudgeSelectedLeft":
          useProjectStore.getState().nudgeSelectedClips(-1);
          break;
        case "nudgeSelectedRight":
          useProjectStore.getState().nudgeSelectedClips(1);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="app-shell">
      <TopBar onOpenSequenceSettings={() => setSequenceSettingsOpen(true)} />
      <main className="workspace">
        <AssetBin />
        <div className="center-stack">
          <Preview />
          <Timeline />
        </div>
        <div className="right-stack">
          <Inspector />
          <LlmPanel />
          <ProjectPanel />
        </div>
      </main>
      <SequenceSettingsModal open={sequenceSettingsOpen} onClose={() => setSequenceSettingsOpen(false)} />
    </div>
  );
}
