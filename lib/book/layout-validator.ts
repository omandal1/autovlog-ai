import type {
  AutoRepairAction,
  BookDecoration,
  BookPage,
  LayoutCollisionReport,
  OutOfBoundsViolation,
  OverlapViolation,
  RenderLayoutValidationReport,
  SafeLayoutZone
} from "@/lib/types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function boxArea(box: { width: number; height: number }) {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function outOfBounds(id: string, box: { x: number; y: number; width: number; height: number }) {
  const results: OutOfBoundsViolation[] = [];
  if (box.x < 0) {
    results.push({ id, direction: "left", overflow: Number(Math.abs(box.x).toFixed(4)) });
  }
  if (box.y < 0) {
    results.push({ id, direction: "top", overflow: Number(Math.abs(box.y).toFixed(4)) });
  }
  if (box.x + box.width > 1) {
    results.push({
      id,
      direction: "right",
      overflow: Number((box.x + box.width - 1).toFixed(4))
    });
  }
  if (box.y + box.height > 1) {
    results.push({
      id,
      direction: "bottom",
      overflow: Number((box.y + box.height - 1).toFixed(4))
    });
  }
  return results;
}

function fitBox(
  box: { x: number; y: number; width: number; height: number; rotationDeg?: number },
  bounds: { left: number; top: number; right: number; bottom: number },
  limits: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number }
) {
  const width = Number(clamp(box.width, limits.minWidth, Math.min(limits.maxWidth, bounds.right - bounds.left)).toFixed(4));
  const height = Number(clamp(box.height, limits.minHeight, Math.min(limits.maxHeight, bounds.bottom - bounds.top)).toFixed(4));
  const x = Number(clamp(box.x, bounds.left, bounds.right - width).toFixed(4));
  const y = Number(clamp(box.y, bounds.top, bounds.bottom - height).toFixed(4));
  return {
    ...box,
    x,
    y,
    width,
    height,
    rotationDeg: Number(clamp(box.rotationDeg ?? 0, -0.8, 0.8).toFixed(3))
  };
}

export function buildSafeLayoutZones(page: Pick<BookPage, "layoutType">): SafeLayoutZone[] {
  const base: SafeLayoutZone[] = [
    { id: "header-band", x: 0.08, y: 0.1, width: 0.76, height: 0.1, purpose: "text" },
    { id: "footer-band", x: 0.08, y: 0.79, width: 0.78, height: 0.12, purpose: "decor" },
    { id: "gutter", x: 0.47, y: 0.1, width: 0.06, height: 0.75, purpose: "gutter" },
    { id: "edge-buffer", x: 0.04, y: 0.05, width: 0.9, height: 0.86, purpose: "edge-buffer" }
  ];

  if (page.layoutType === "hero") {
    return [
      ...base,
      { id: "hero-media", x: 0.14, y: 0.18, width: 0.62, height: 0.58, purpose: "media" }
    ];
  }

  if (page.layoutType === "side-by-side" || page.layoutType === "yearbook-spread") {
    return [
      ...base,
      { id: "left-media", x: 0.1, y: 0.2, width: 0.34, height: 0.5, purpose: "media" },
      { id: "right-media", x: 0.52, y: 0.2, width: 0.28, height: 0.4, purpose: "media" }
    ];
  }

  return base;
}

export function detectLayoutCollisions(page: BookPage) {
  const overlaps: OverlapViolation[] = [];
  const outOfBoundsViolations: OutOfBoundsViolation[] = [];

  for (const slot of page.slots) {
    outOfBoundsViolations.push(...outOfBounds(slot.id, slot.frame));
  }
  for (const decoration of page.decorations) {
    outOfBoundsViolations.push(...outOfBounds(decoration.id, decoration));
  }

  for (let index = 0; index < page.slots.length; index += 1) {
    const slot = page.slots[index]!;
    for (let nextIndex = index + 1; nextIndex < page.slots.length; nextIndex += 1) {
      const next = page.slots[nextIndex]!;
      const overlap = intersectionArea(slot.frame, next.frame);
      if (overlap > 0.004) {
        overlaps.push({
          a: slot.id,
          b: next.id,
          area: Number(overlap.toFixed(4))
        });
      }
    }
  }

  for (const decoration of page.decorations) {
    const decorationBox = {
      x: decoration.x,
      y: decoration.y,
      width: decoration.width,
      height: decoration.height
    };
    for (const slot of page.slots) {
      const overlap = intersectionArea(decorationBox, slot.frame);
      const tolerance = boxArea(decorationBox) * 0.12;
      if (overlap > tolerance) {
        overlaps.push({
          a: decoration.id,
          b: slot.id,
          area: Number(overlap.toFixed(4))
        });
      }
    }
  }

  return {
    overlaps,
    outOfBounds: outOfBoundsViolations
  } satisfies LayoutCollisionReport;
}

export function validateAndRepairPageLayout(page: BookPage) {
  const repairs: AutoRepairAction[] = [];
  const safeZones = buildSafeLayoutZones(page);
  const repaired: BookPage = {
    ...page,
    slots: page.slots.map((slot) => ({
      ...slot,
      frame: fitBox(
        slot.frame,
        page.kind === "cover"
          ? { left: 0.29, top: 0.5, right: 0.72, bottom: 0.78 }
          : { left: 0.115, top: 0.17, right: 0.885, bottom: 0.765 },
        page.kind === "cover"
          ? { minWidth: 0.16, maxWidth: 0.3, minHeight: 0.12, maxHeight: 0.23 }
          : { minWidth: 0.15, maxWidth: 0.52, minHeight: 0.14, maxHeight: 0.48 }
      )
    })),
    decorations: page.decorations.map((decoration) => ({
      ...decoration,
      ...fitBox(
        decoration,
        { left: 0.05, top: 0.07, right: 0.94, bottom: 0.91 },
        { minWidth: 0.025, maxWidth: 0.24, minHeight: 0.008, maxHeight: 0.11 }
      )
    }))
  };

  repaired.slots.forEach((slot, index) => {
    const previous = repaired.slots[index - 1];
    if (!previous) {
      return;
    }
    const overlap = intersectionArea(slot.frame, previous.frame);
    if (overlap > 0.002) {
      slot.frame.x = Number(clamp(slot.frame.x + 0.03, 0.06, 0.82).toFixed(4));
      slot.frame.y = Number(clamp(slot.frame.y + 0.02, 0.12, 0.78).toFixed(4));
      repairs.push({
        type: "move",
        targetId: slot.id,
        detail: "Shifted media frame to resolve overlap."
      });
    }
  });

  const collisionReport = detectLayoutCollisions(repaired);
  let cleanedDecorations: BookDecoration[] = repaired.decorations;
  if (collisionReport.overlaps.length) {
    const blockedIds = new Set(
      collisionReport.overlaps
        .map((violation) => (violation.a.startsWith("decor_") ? violation.a : violation.b))
        .filter((id) => id.startsWith("decor_"))
    );
    cleanedDecorations = repaired.decorations.filter((decoration) => {
      if (!blockedIds.has(decoration.id)) {
        return true;
      }
      repairs.push({
        type: "remove-decoration",
        targetId: decoration.id,
        detail: "Removed a decoration to keep media and labels readable."
      });
      return false;
    });
  }

  const finalPage: BookPage = {
    ...repaired,
    decorations: cleanedDecorations,
    safeZones
  };
  const finalReport = detectLayoutCollisions(finalPage);
  const validation: RenderLayoutValidationReport = {
    valid: finalReport.overlaps.length === 0 && finalReport.outOfBounds.length === 0,
    overlaps: finalReport.overlaps,
    outOfBounds: finalReport.outOfBounds,
    unreadableTextIds: finalPage.decorations
      .filter((decoration) => Boolean(decoration.text) && decoration.height < 0.022)
      .map((decoration) => decoration.id),
    aspectRatioWarnings: finalPage.slots
      .filter((slot) => slot.frame.width / Math.max(slot.frame.height, 0.01) > 3.4)
      .map((slot) => `${slot.id} is too wide for the page frame.`),
    repairs
  };

  return {
    page: {
      ...finalPage,
      layoutValidation: validation
    },
    report: validation
  };
}
