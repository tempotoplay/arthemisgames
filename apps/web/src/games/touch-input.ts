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
}

export function attachTouchInput({
  canvas,
  zones,
  onZoneChange,
}: TouchInputProps): () => void {
  const activeTouches = new Map<number, string>(); // touch ID -> key name

  const handleTouchStart = (e: TouchEvent) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    for (const touch of e.changedTouches) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
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
    const rect = canvas.getBoundingClientRect();
    const zoneMap = new Map(zones.map((z) => [z.keyName, z]));

    for (const touch of e.changedTouches) {
      const oldKey = activeTouches.get(touch.identifier);
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

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
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#4a9eff";
  ctx.strokeStyle = "#2d7acc";
  ctx.lineWidth = 2;

  for (const zone of zones) {
    if (filled) {
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    }
    ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);

    // Label
    ctx.globalAlpha = alpha * 1.5;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(zone.name, zone.x + zone.w / 2, zone.y + zone.h / 2);
  }
  ctx.globalAlpha = 1;
}
