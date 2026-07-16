import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { ColorPickerOverlayData, ColorSample } from "../types";

const MAGNIFIER_SIZE = 184;
const MAGNIFIER_SOURCE_SIZE = 23;
const MAGNIFIER_GAP = 22;

interface CursorSample {
  clientX: number;
  clientY: number;
  imageX: number;
  imageY: number;
  color: ColorSample;
}

function channelHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

export function ColorPickerOverlay({ monitorId }: { monitorId: number }) {
  const [overlay, setOverlay] = useState<ColorPickerOverlayData | null>(null);
  const [cursor, setCursor] = useState<CursorSample | null>(null);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null);
  const magnifierRef = useRef<HTMLCanvasElement>(null);
  const latestSampleRef = useRef<ColorSample | null>(null);

  useEffect(() => {
    invoke<ColorPickerOverlayData>("get_color_picker_overlay", { monitorId }).then(setOverlay, (reason) => {
      setError(String(reason));
    });
  }, [monitorId]);

  useEffect(() => {
    function cancel(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        void invoke("finish_color_picker", { sample: null });
      }
    }

    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  useEffect(() => {
    if (!overlay || !cursor || !magnifierRef.current || !imageRef.current) return;

    const radius = Math.floor(MAGNIFIER_SOURCE_SIZE / 2);
    const sourceX = Math.max(
      0,
      Math.min(overlay.width - MAGNIFIER_SOURCE_SIZE, cursor.imageX - radius),
    );
    const sourceY = Math.max(
      0,
      Math.min(overlay.height - MAGNIFIER_SOURCE_SIZE, cursor.imageY - radius),
    );
    const context = magnifierRef.current.getContext("2d");
    if (!context) return;

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    context.drawImage(
      imageRef.current,
      sourceX,
      sourceY,
      MAGNIFIER_SOURCE_SIZE,
      MAGNIFIER_SOURCE_SIZE,
      0,
      0,
      MAGNIFIER_SIZE,
      MAGNIFIER_SIZE,
    );
  }, [cursor, overlay]);

  function prepareSampler() {
    if (!overlay || !imageRef.current || !sampleCanvasRef.current) return;
    const canvas = sampleCanvasRef.current;
    canvas.width = overlay.width;
    canvas.height = overlay.height;
    canvas.getContext("2d", { willReadFrequently: true })?.drawImage(imageRef.current, 0, 0);
  }

  function sampleAt(clientX: number, clientY: number) {
    if (!overlay || !sampleCanvasRef.current || !imageRef.current) return;

    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);
    const imageX = Math.min(
      overlay.width - 1,
      Math.max(0, Math.floor((clientX / viewportWidth) * overlay.width)),
    );
    const imageY = Math.min(
      overlay.height - 1,
      Math.max(0, Math.floor((clientY / viewportHeight) * overlay.height)),
    );
    const sampleContext = sampleCanvasRef.current.getContext("2d", { willReadFrequently: true });
    const pixel = sampleContext?.getImageData(imageX, imageY, 1, 1).data;
    if (!pixel) return;

    const rgb: [number, number, number] = [pixel[0], pixel[1], pixel[2]];
    const hex = `#${channelHex(rgb[0])}${channelHex(rgb[1])}${channelHex(rgb[2])}`.toUpperCase();
    const color: ColorSample = {
      hex,
      rgb,
      position: [overlay.originX + imageX, overlay.originY + imageY],
    };
    latestSampleRef.current = color;
    setCursor({
      clientX,
      clientY,
      imageX,
      imageY,
      color,
    });
  }

  function confirm(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    sampleAt(event.clientX, event.clientY);
    if (latestSampleRef.current) {
      void invoke("finish_color_picker", { sample: latestSampleRef.current });
    }
  }

  function cancel(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    void invoke("finish_color_picker", { sample: null });
  }

  if (error) {
    return <div className="picker-overlay-error">{error}</div>;
  }

  if (!overlay) {
    return <div className="picker-overlay-loading" />;
  }

  const panelWidth = MAGNIFIER_SIZE + 2;
  const panelHeight = MAGNIFIER_SIZE + 58;
  const desiredPanelLeft =
    cursor && cursor.clientX + MAGNIFIER_GAP + panelWidth > window.innerWidth
      ? cursor.clientX - MAGNIFIER_GAP - panelWidth
      : (cursor?.clientX ?? 0) + MAGNIFIER_GAP;
  const desiredPanelTop =
    cursor && cursor.clientY + MAGNIFIER_GAP + panelHeight > window.innerHeight
      ? cursor.clientY - MAGNIFIER_GAP - panelHeight
      : (cursor?.clientY ?? 0) + MAGNIFIER_GAP;
  const panelLeft = Math.max(12, Math.min(window.innerWidth - panelWidth - 12, desiredPanelLeft));
  const panelTop = Math.max(12, Math.min(window.innerHeight - panelHeight - 12, desiredPanelTop));

  return (
    <div
      className="picker-overlay"
      onPointerMove={(event) => sampleAt(event.clientX, event.clientY)}
      onPointerEnter={(event) => sampleAt(event.clientX, event.clientY)}
      onPointerLeave={() => {
        latestSampleRef.current = null;
        setCursor(null);
      }}
      onPointerDown={confirm}
      onContextMenu={cancel}
    >
      <img
        ref={imageRef}
        className="picker-screen-image"
        src={overlay.dataUrl}
        alt=""
        draggable={false}
        onLoad={() => {
          prepareSampler();
          if (overlay.initialPosition) {
            const [imageX, imageY] = overlay.initialPosition;
            sampleAt(
              ((imageX + 0.5) / overlay.width) * window.innerWidth,
              ((imageY + 0.5) / overlay.height) * window.innerHeight,
            );
          }
        }}
      />
      <div className="picker-screen-mask" />
      <canvas ref={sampleCanvasRef} className="picker-sample-canvas" />

      {cursor && (
        <>
          <div
            className="picker-cursor"
            style={{ transform: `translate(${cursor.clientX}px, ${cursor.clientY}px)` }}
          >
            <span />
          </div>
          <div
            className="picker-magnifier"
            style={{ transform: `translate(${panelLeft}px, ${panelTop}px)` }}
          >
            <div className="picker-magnifier-canvas">
              <canvas
                ref={magnifierRef}
                width={MAGNIFIER_SIZE}
                height={MAGNIFIER_SIZE}
              />
              <span className="picker-magnifier-crosshair" />
            </div>
            <div className="picker-magnifier-value">
              <span style={{ backgroundColor: cursor.color.hex }} />
              <strong>{cursor.color.hex}</strong>
              <small>{cursor.color.rgb.join(", ")}</small>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
