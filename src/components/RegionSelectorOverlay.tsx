import { invoke } from "@tauri-apps/api/core";
import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  CaptureRegion,
  RegionSelectorOverlayData,
} from "../types";

interface Point {
  x: number;
  y: number;
}

interface Selection {
  start: Point;
  end: Point;
}

export function RegionSelectorOverlay({ monitorId }: { monitorId: number }) {
  const [overlay, setOverlay] = useState<RegionSelectorOverlayData | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<RegionSelectorOverlayData>("get_region_selector_overlay", { monitorId }).then(
      setOverlay,
      (reason) => setError(String(reason)),
    );
  }, [monitorId]);

  const bounds = useMemo(() => {
    if (!selection) return null;
    return {
      left: Math.min(selection.start.x, selection.end.x),
      top: Math.min(selection.start.y, selection.end.y),
      width: Math.abs(selection.end.x - selection.start.x),
      height: Math.abs(selection.end.y - selection.start.y),
    };
  }, [selection]);
  const valid = Boolean(bounds && bounds.width >= 6 && bounds.height >= 6);

  function pointAt(event: React.PointerEvent<HTMLDivElement>): Point {
    return {
      x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
      y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
    };
  }

  function start(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".region-selector-actions")) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointAt(event);
    setSelection({ start: point, end: point });
    setDragging(true);
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const point = pointAt(event);
    setSelection((current) => (current ? { ...current, end: point } : current));
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function selectedRegion(): CaptureRegion | null {
    if (!overlay || !bounds || !valid) return null;
    const scaleX = overlay.width / Math.max(window.innerWidth, 1);
    const scaleY = overlay.height / Math.max(window.innerHeight, 1);
    return {
      x: Math.round(bounds.left * scaleX),
      y: Math.round(bounds.top * scaleY),
      width: Math.round(bounds.width * scaleX),
      height: Math.round(bounds.height * scaleY),
    };
  }

  function confirm() {
    const region = selectedRegion();
    if (!region) return;
    void invoke("finish_region_selector", { monitorId, region });
  }

  function cancel() {
    void invoke("finish_region_selector", { monitorId: null, region: null });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "Enter" && valid) {
        event.preventDefault();
        confirm();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (error) {
    return <div className="region-selector-error">{error}</div>;
  }
  if (!overlay) {
    return <div className="region-selector-loading" />;
  }

  const region = selectedRegion();
  const actionWidth = 238;
  const actionHeight = 42;
  const actionLeft = bounds
    ? Math.max(12, Math.min(window.innerWidth - actionWidth - 12, bounds.left + bounds.width - actionWidth))
    : 12;
  const actionTop = bounds
    ? bounds.top + bounds.height + 10 + actionHeight > window.innerHeight
      ? Math.max(12, bounds.top - actionHeight - 10)
      : bounds.top + bounds.height + 10
    : 12;
  const sizeLeft = bounds
    ? Math.max(8, Math.min(window.innerWidth - 130, bounds.left + 8))
    : 8;
  const sizeTop = bounds ? Math.max(8, bounds.top - 30) : 8;

  return (
    <div
      className="region-selector-overlay"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <img className="region-selector-image" src={overlay.dataUrl} alt="" draggable={false} />

      {!valid || !bounds ? (
        <div className="region-selector-full-mask" />
      ) : (
        <>
          <div className="region-selector-mask top" style={{ height: bounds.top }} />
          <div
            className="region-selector-mask left"
            style={{ top: bounds.top, width: bounds.left, height: bounds.height }}
          />
          <div
            className="region-selector-mask right"
            style={{
              top: bounds.top,
              left: bounds.left + bounds.width,
              height: bounds.height,
            }}
          />
          <div
            className="region-selector-mask bottom"
            style={{ top: bounds.top + bounds.height }}
          />
          <div
            className="region-selector-selection"
            style={{
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            }}
          />
        </>
      )}

      {(!selection || !valid) && (
        <div className="region-selector-instruction">
          {selection ? "区域太小，请重新拖拽" : "按住鼠标拖拽选择区域"}
          <small>右键或 Esc 取消</small>
        </div>
      )}

      {valid && bounds && region && (
        <>
          <div
            className="region-selector-size"
            style={{ transform: `translate(${sizeLeft}px, ${sizeTop}px)` }}
          >
            {region.width} × {region.height}
          </div>
          {!dragging && (
            <div
              className="region-selector-actions"
              style={{ transform: `translate(${actionLeft}px, ${actionTop}px)` }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button title="重新选择" onClick={() => setSelection(null)}>
                <RotateCcw size={16} />
              </button>
              <button title="取消" onClick={cancel}>
                <X size={16} />
              </button>
              <button className="confirm" onClick={confirm}>
                <Check size={16} />
                确认
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
