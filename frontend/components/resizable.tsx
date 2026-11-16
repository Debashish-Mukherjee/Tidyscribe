"use client";

import { useEffect, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    setWidth(Math.round(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

type ResizeHandleProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
};

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

export function ResizeHandle({ label, value, min, max, onChange, onReset }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const clamp = (next: number) => Math.min(Math.max(next, min), Math.max(min, max));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startValue = value;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setDragging(true);

    const onMove = (move: globalThis.PointerEvent) => onChange(clamp(startValue + move.clientX - startX));
    const onEnd = () => {
      setDragging(false);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const next =
      event.key === "ArrowLeft" ? value - step :
      event.key === "ArrowRight" ? value + step :
      event.key === "Home" ? min :
      event.key === "End" ? max :
      null;
    if (next === null) return;
    event.preventDefault();
    onChange(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={`group relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none select-none outline-none ${dragging ? "bg-[#58a6ff]" : "bg-[#30363d] hover:bg-[#58a6ff]/70 focus-visible:bg-[#58a6ff]"}`}
    >
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
