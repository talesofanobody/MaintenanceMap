import L from "leaflet";
import type { Priority, Status } from "../types";
import { PRIORITY_COLORS } from "../types";

const STATUS_GLYPH: Record<Status, string> = {
  pending: "!",
  in_progress: "…",
  completed: "✓",
};

export function issueDivIcon(priority: Priority, status: Status, dimmed = false): L.DivIcon {
  const color = PRIORITY_COLORS[priority];
  const glyph = STATUS_GLYPH[status];
  return L.divIcon({
    className: "issue-marker-wrap",
    html: `<div class="issue-marker ${status}" style="background:${color};opacity:${dimmed ? 0.45 : 1}">${glyph}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

export function draftDivIcon(): L.DivIcon {
  return L.divIcon({
    className: "issue-marker-wrap",
    html: `<div class="issue-marker draft">📍</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
  });
}
