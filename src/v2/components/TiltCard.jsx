import React, { useRef, useCallback } from 'react';

import { tr } from '../../i18n';
// Lightweight GPU-friendly 3D tilt wrapper.
// - Writes rotation/glow to CSS variables (no React re-render per frame).
// - Pointer-fine devices only; on touch it stays flat (saves battery + avoids jank).
// - Respects prefers-reduced-motion (the CSS disables the transform too).
export default function TiltCard({ children, className = '', max = 9, glow = true, onClick, ...rest }) {
  const ref = useRef(null);
  const frame = useRef(0);

  const handleMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;   // 0..1
    const py = (e.clientY - rect.top) / rect.height;   // 0..1
    const ry = (px - 0.5) * 2 * max;
    const rx = -(py - 0.5) * 2 * max;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    });
  }, [max]);

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      onClick={onClick}
      className={`tilt-card ${glow ? 'tilt-glow' : ''} ${className}`}
      {...rest}
    >
      <div className="tilt-inner">{children}</div>
    </div>
  );
}
