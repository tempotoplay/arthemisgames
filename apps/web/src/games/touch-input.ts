/**
 * Touch input layer for canvas games.
 * Normalizes touch events into the same g.keys flags that keyboard listeners populate.
 * Use alongside keyboard input — both update the same state.
 */

export interface TouchInputZone {
  name: string;
  keyName: string; // e.g. "left", "right", "f" — maps to g.keys[keyName]
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TouchInputProps {
  canvas: HTMLCanvasElement;
  zones: TouchInputZone[];
  onZoneChange: (keysUpdate: Record<string, boolean>) => void;
  /**
   * Logical coordinate space the zones are defined in — i.e. the size the game
   * draws with, before devicePixelRatio scaling (e.g. 900×560). The canvas is
   * usually displayed at a different CSS size, so touch points must be scaled
   * from CSS pixels into this space or the zones won't line up. Defaults to the
   * canvas backing-store size.
   */
  width?: number;
  height?: number;
}

/**
 * Map a client (CSS-pixel) point onto a canvas's logical coordinate space.
 * Mirrors how the game's draw calls and other pointer handlers convert points.
 */
export function toCanvasCoords(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  width?: number,
  height?: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = (width ?? canvas.width) / (rect.width || 1);
  const sy = (height ?? canvas.height) / (rect.height || 1);
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

export function attachTouchInput({
  canvas,
  zones,
  onZoneChange,
  width,
  height,
}: TouchInputProps): () => void {
  const activeTouches = new Map<number, string>(); // touch ID -> key name

  const handleTouchStart = (e: TouchEvent) => {
    if (!canvas) return;
    for (const touch of e.changedTouches) {
      const { x, y } = toCanvasCoords(canvas, touch.clientX, touch.clientY, width, height);
      for (const zone of zones) {
        if (x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h) {
          activeTouches.set(touch.identifier, zone.keyName);
          onZoneChange({ [zone.keyName]: true });
          break;
        }
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    for (const touch of e.changedTouches) {
      const key = activeTouches.get(touch.identifier);
      if (key) {
        activeTouches.delete(touch.identifier);
        onZoneChange({ [key]: false });
      }
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!canvas) return;
    for (const touch of e.changedTouches) {
      const oldKey = activeTouches.get(touch.identifier);
      const { x, y } = toCanvasCoords(canvas, touch.clientX, touch.clientY, width, height);

      let newKey: string | null = null;
      for (const zone of zones) {
        if (x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h) {
          newKey = zone.keyName;
          break;
        }
      }

      // If the touch moved to a different zone, update state.
      if (oldKey !== newKey) {
        if (oldKey) {
          activeTouches.delete(touch.identifier);
          onZoneChange({ [oldKey]: false });
        }
        if (newKey) {
          activeTouches.set(touch.identifier, newKey);
          onZoneChange({ [newKey]: true });
        }
      }
    }
  };

  canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
  canvas.addEventListener("touchend", handleTouchEnd, { passive: true });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: true });

  return () => {
    canvas.removeEventListener("touchstart", handleTouchStart);
    canvas.removeEventListener("touchend", handleTouchEnd);
    canvas.removeEventListener("touchmove", handleTouchMove);
  };
}

/**
 * Draw touch button zones on a canvas 2D context.
 * Useful for visual debugging or always-visible button overlays.
 */
export function drawTouchZones(
  ctx: CanvasRenderingContext2D,
  zones: TouchInputZone[],
  options?: { filled?: boolean; alpha?: number },
) {
  const { filled = false, alpha = 0.2 } = options || {};

  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  for (const zone of zones) {
    roundRect(zone.x, zone.y, zone.w, zone.h, 16);

    if (filled) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#4a9eff";
      ctx.fill();
    }
    ctx.globalAlpha = Math.min(1, alpha * 4 + 0.15);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label — placed near the bottom of tall zones (where the thumb rests),
    // centered otherwise. Drawn solid so it reads against busy backgrounds.
    const labelY = zone.h > 160 ? zone.y + zone.h - 28 : zone.y + zone.h / 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 4;
    ctx.fillText(zone.name, zone.x + zone.w / 2, labelY);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}
