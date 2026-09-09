"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import styles from "./DotGrid.module.css";

interface Dot {
  cx: number;
  cy: number;
  xOffset: number;
  yOffset: number;
  vx: number;
  vy: number;
}

interface PointerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  lastTime: number;
  lastX: number;
  lastY: number;
  inside: boolean;
}

export interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  resistance?: number;
  returnDuration?: number;
  className?: string;
  style?: React.CSSProperties;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const throttle = <Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number) => {
  let last = 0;
  return (...args: Args) => {
    const now = performance.now();
    if (now - last >= waitMs) {
      last = now;
      fn(...args);
    }
  };
};

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 6) return { r: 0, g: 0, b: 0 };
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export default function DotGrid({
  dotSize = 3,
  gap = 20,
  baseColor = "#3c4a5e",
  activeColor = "#6f8bb8",
  proximity = 120,
  speedTrigger = 90,
  shockRadius = 220,
  shockStrength = 2.8,
  maxSpeed = 2800,
  resistance = 760,
  returnDuration = 1.45,
  className = "",
  style,
}: DotGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const dotsRef = useRef<Dot[]>([]);
  const pointerRef = useRef<PointerState>({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
    inside: false,
  });

  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor]);
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor]);

  const circlePath = useMemo(() => {
    if (typeof window === "undefined" || typeof window.Path2D === "undefined") return null;
    const path = new Path2D();
    path.arc(0, 0, dotSize / 2, 0, Math.PI * 2);
    return path;
  }, [dotSize]);

  const buildGrid = useCallback(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const rect = wrapper.getBoundingClientRect();
    const width = Math.max(0, rect.width);
    const height = Math.max(0, rect.height);
    sizeRef.current = { width, height };

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const cell = dotSize + gap;
    const cols = Math.max(1, Math.floor((width + gap) / cell));
    const rows = Math.max(1, Math.floor((height + gap) / cell));

    const gridW = cols * cell - gap;
    const gridH = rows * cell - gap;
    const startX = (width - gridW) / 2 + dotSize / 2;
    const startY = (height - gridH) / 2 + dotSize / 2;

    const dots: Dot[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        dots.push({
          cx: startX + x * cell,
          cy: startY + y * cell,
          xOffset: 0,
          yOffset: 0,
          vx: 0,
          vy: 0,
        });
      }
    }

    dotsRef.current = dots;
  }, [dotSize, gap]);

  useEffect(() => {
    buildGrid();
    let resizeObserver: ResizeObserver | null = null;

    if ("ResizeObserver" in window && wrapperRef.current) {
      resizeObserver = new ResizeObserver(() => buildGrid());
      resizeObserver.observe(wrapperRef.current);
    } else {
      window.addEventListener("resize", buildGrid);
    }

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", buildGrid);
    };
  }, [buildGrid]);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    const proxSq = proximity * proximity;
    const spring = Math.max(10, resistance / 14);
    const damping = clamp(6 / Math.max(0.25, returnDuration), 2.6, 12);

    const draw = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dt = clamp((now - last) / 1000, 0.008, 0.034);
      last = now;

      const { width, height } = sizeRef.current;
      ctx.clearRect(0, 0, width, height);

      const pointer = pointerRef.current;
      const impulseGain = pointer.speed > speedTrigger ? 0.00115 : 0;

      for (const dot of dotsRef.current) {
        if (pointer.inside && impulseGain > 0) {
          const dx = dot.cx - pointer.x;
          const dy = dot.cy - pointer.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < proxSq) {
            const dist = Math.sqrt(distSq) || 1;
            const influence = 1 - dist / proximity;
            const nx = dx / dist;
            const ny = dy / dist;
            dot.vx += (nx * pointer.speed * impulseGain + pointer.vx * 0.00023) * influence;
            dot.vy += (ny * pointer.speed * impulseGain + pointer.vy * 0.00023) * influence;
          }
        }

        dot.vx += (-spring * dot.xOffset - damping * dot.vx) * dt;
        dot.vy += (-spring * dot.yOffset - damping * dot.vy) * dt;
        dot.xOffset += dot.vx * dt;
        dot.yOffset += dot.vy * dt;

        const x = dot.cx + dot.xOffset;
        const y = dot.cy + dot.yOffset;

        let fill = baseColor;
        if (pointer.inside) {
          const dx = dot.cx - pointer.x;
          const dy = dot.cy - pointer.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < proxSq) {
            const t = 1 - Math.sqrt(distSq) / proximity;
            const r = Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t);
            const g = Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t);
            const b = Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t);
            fill = `rgb(${r},${g},${b})`;
          }
        }

        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = fill;
        if (circlePath) {
          ctx.fill(circlePath);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, dotSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    proximity,
    speedTrigger,
    maxSpeed,
    resistance,
    returnDuration,
    baseColor,
    baseRgb,
    activeRgb,
    circlePath,
    dotSize,
  ]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      const p = pointerRef.current;
      const now = performance.now();
      const dt = p.lastTime ? Math.max(1, now - p.lastTime) : 16;
      const dx = e.clientX - p.lastX;
      const dy = e.clientY - p.lastY;

      let vx = (dx / dt) * 1000;
      let vy = (dy / dt) * 1000;
      let speed = Math.hypot(vx, vy);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        vx *= scale;
        vy *= scale;
        speed = maxSpeed;
      }

      p.lastTime = now;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.vx = vx;
      p.vy = vy;
      p.speed = speed;
      p.inside = inside;

      if (inside) {
        p.x = e.clientX - rect.left;
        p.y = e.clientY - rect.top;
      }
    };

    const onLeave = () => {
      pointerRef.current.inside = false;
      pointerRef.current.speed = 0;
    };

    const onClick = (e: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return;
      }

      const centerX = e.clientX - rect.left;
      const centerY = e.clientY - rect.top;
      for (const dot of dotsRef.current) {
        const dx = dot.cx - centerX;
        const dy = dot.cy - centerY;
        const dist = Math.hypot(dx, dy);
        if (dist <= 0 || dist > shockRadius) continue;

        const falloff = 1 - dist / shockRadius;
        const nx = dx / dist;
        const ny = dy / dist;
        const impulse = shockStrength * falloff * 210;
        dot.vx += nx * impulse;
        dot.vy += ny * impulse;
      }
    };

    const throttledMove = throttle(onMove, 40);
    window.addEventListener("mousemove", throttledMove, { passive: true });
    window.addEventListener("mouseout", onLeave, { passive: true });
    window.addEventListener("click", onClick, { passive: true });

    return () => {
      window.removeEventListener("mousemove", throttledMove);
      window.removeEventListener("mouseout", onLeave);
      window.removeEventListener("click", onClick);
    };
  }, [maxSpeed, shockRadius, shockStrength]);

  return (
    <section className={`${styles.dotGrid} ${className}`.trim()} style={style} aria-hidden="true">
      <div ref={wrapperRef} className={styles.wrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
    </section>
  );
}
