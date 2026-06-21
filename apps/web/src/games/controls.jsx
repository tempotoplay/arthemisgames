/**
 * Shared on-screen touch controls for the canvas games.
 *
 * These render as real HTML buttons docked *below* the game canvas (never drawn
 * over the play area), sized for thumbs, and feed the same input that keyboard
 * handlers do. Pointer events cover both touch and mouse, so the dock also works
 * as a mouse fallback on desktop.
 */

import { useRef } from "react";

/**
 * Map a client (CSS-pixel) point onto a canvas's logical coordinate space —
 * the size the game draws with, before devicePixelRatio scaling. Used for
 * drag-to-aim / drag-to-turn and any pointer hit-testing.
 */
export function toCanvasCoords(canvas, clientX, clientY, width, height) {
  const rect = canvas.getBoundingClientRect();
  const sx = (width ?? canvas.width) / (rect.width || 1);
  const sy = (height ?? canvas.height) / (rect.height || 1);
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

const baseBtn = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  flex: 1,
  minHeight: 64,
  padding: "0 14px",
  userSelect: "none",
  WebkitUserSelect: "none",
  touchAction: "none",
  WebkitTapHighlightColor: "transparent",
  cursor: "pointer",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 16,
  color: "#fff",
  fontWeight: 800,
  fontSize: 17,
  lineHeight: 1,
  background: "rgba(255,255,255,0.07)",
  transition: "transform 0.06s ease, background 0.12s ease, filter 0.12s ease",
};

function variantStyle(accent) {
  if (!accent) return null;
  return { background: accent, color: "#241544", border: "none" };
}

/**
 * A button that stays "pressed" while held — for continuous actions (move,
 * turn, walk). onPress fires once on press, onRelease once on release; the
 * game reads the resulting flag every frame.
 */
export function HoldButton({ onPress, onRelease, children, style, accent, ariaLabel }) {
  const held = useRef(false);

  const press = (e) => {
    e.preventDefault();
    if (held.current) return;
    held.current = true;
    e.currentTarget.style.transform = "scale(0.96)";
    e.currentTarget.style.filter = "brightness(1.25)";
    onPress();
  };
  const release = (e) => {
    if (!held.current) return;
    held.current = false;
    if (e?.currentTarget) {
      e.currentTarget.style.transform = "";
      e.currentTarget.style.filter = "";
    }
    onRelease();
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      style={{ ...baseBtn, ...variantStyle(accent), ...style }}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** A button for discrete actions (fire, reload). Fires immediately on press. */
export function TapButton({ onTap, children, style, accent, ariaLabel }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      style={{ ...baseBtn, ...variantStyle(accent), ...style }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.style.transform = "scale(0.96)";
        e.currentTarget.style.filter = "brightness(1.15)";
        onTap();
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.filter = "";
      }}
      onPointerCancel={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.filter = "";
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** Horizontal dock that holds the control buttons below a game. */
export function Dock({ children, style }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        maxWidth: 560,
        margin: "12px auto 0",
        padding: "0 2px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
