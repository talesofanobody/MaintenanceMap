import L from "leaflet";
import type { Priority, Status } from "../types";
import { PRIORITY_COLORS } from "../types";

// Pin geometry lives in a 40x48 box: a 40x40 badge whose shape encodes the risk
// profile, plus a tail pointing at the exact location. Rendered as inline SVG so
// it stays crisp on Retina screens and in print.
const BADGE: Record<Priority, string> = {
  low: '<circle cx="20" cy="20" r="17"/>',
  medium: '<circle cx="20" cy="20" r="17"/>',
  high: '<path d="M20 3.5 L37 34 L3 34 Z" stroke-linejoin="round"/>',
  urgent: '<path d="M13 3 L27 3 L37 13 L37 27 L27 37 L13 37 L3 27 L3 13 Z" stroke-linejoin="round"/>',
};

const GLYPH: Record<Priority, string> = {
  low: '<text x="20" y="26" text-anchor="middle" font-size="17" font-weight="800" font-family="system-ui, sans-serif" fill="#fff">i</text>',
  medium: '<text x="20" y="27" text-anchor="middle" font-size="20" font-weight="800" font-family="system-ui, sans-serif" fill="#1f2937">!</text>',
  high: '<text x="20" y="30" text-anchor="middle" font-size="19" font-weight="800" font-family="system-ui, sans-serif" fill="#fff">!</text>',
  urgent: '<text x="20" y="27" text-anchor="middle" font-size="19" font-weight="900" font-family="system-ui, sans-serif" fill="#fff">!!</text>',
};

const STATUS_BADGE: Record<Status, string> = {
  pending: "",
  in_progress:
    '<g><circle cx="7" cy="33" r="6.5" fill="#2563eb" stroke="#fff" stroke-width="1.8"/><path d="M4.5 33 A2.5 2.5 0 0 1 9.5 33" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M4 31 h6" stroke="#fff" stroke-width="1.6"/></g>',
  completed:
    '<g><circle cx="7" cy="33" r="6.5" fill="#16a34a" stroke="#fff" stroke-width="1.8"/><path d="M3.8 33.2 L6.2 35.6 L10.4 30.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>',
};

export interface PinOptions {
  priority: Priority;
  status: Status;
  label?: string | number;
  size?: number;
  dimmed?: boolean;
}

export function pinSvg({ priority, status, label, size = 40 }: PinOptions): string {
  const height = Math.round(size * 1.2);
  const color = PRIORITY_COLORS[priority];
  const labelText = label !== undefined ? String(label) : "";
  const wide = labelText.length > 1;
  const labelSvg = labelText
    ? `<g><circle cx="${wide ? 31 : 33}" cy="7" r="${wide ? 8.5 : 7.5}" fill="#111827" stroke="#fff" stroke-width="1.8"/>` +
      `<text x="${wide ? 31 : 33}" y="10.4" text-anchor="middle" font-size="${wide ? 9 : 10}" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">${labelText}</text></g>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 40 48" class="pin-svg">` +
    `<g fill="${color}" stroke="#fff" stroke-width="2.5">` +
    `<path d="M14 33 L20 47 L26 33 Z"/>${BADGE[priority]}</g>` +
    `${GLYPH[priority]}${STATUS_BADGE[status]}${labelSvg}</svg>`
  );
}

export function issueDivIcon(opts: PinOptions): L.DivIcon {
  const size = opts.size ?? 40;
  const height = Math.round(size * 1.2);
  const classes = ["issue-pin", `priority-${opts.priority}`, `status-${opts.status}`, opts.dimmed ? "dimmed" : ""].join(" ");
  return L.divIcon({
    className: "issue-marker-wrap",
    html: `<div class="${classes}">${pinSvg(opts)}</div>`,
    iconSize: [size, height],
    iconAnchor: [size / 2, height - 1],
    popupAnchor: [0, -height + 6],
  });
}

export function draftDivIcon(): L.DivIcon {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">' +
    '<g fill="#2563eb" stroke="#fff" stroke-width="2.5"><path d="M14 33 L20 47 L26 33 Z"/><circle cx="20" cy="20" r="17"/></g>' +
    '<path d="M20 12 v16 M12 20 h16" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>';
  return L.divIcon({
    className: "issue-marker-wrap",
    html: `<div class="issue-pin draft"><span class="pin-pulse"></span>${svg}</div>`,
    iconSize: [40, 48],
    iconAnchor: [20, 47],
  });
}
