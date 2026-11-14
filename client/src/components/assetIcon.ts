import L from "leaflet";
import type { AssetKind, ServiceState } from "../types";

/**
 * Markers for equipment.
 *
 * Deliberately a different shape from the issue pins: a rounded square rather than
 * a circle or an octagon. The two layers can end up on one screen, and "a fault
 * here" and "a generator here" must not read as the same kind of thing at a
 * glance.
 *
 * Service state tints the badge, so a map of the plant doubles as a map of what is
 * out of date without anybody opening anything.
 */
const STATE_FILL: Record<ServiceState, string> = {
  overdue: "#b91c1c",
  never: "#b91c1c",
  due: "#b45309",
  ok: "#15803d",
  unknown: "#334155",
};

/** One glyph per kind. Flat shapes, because these are read at 32px on a phone. */
const GLYPH: Record<AssetKind, string> = {
  panel: '<rect x="12" y="10" width="16" height="20" rx="2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M16 15h8M16 20h8M16 25h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  breaker: '<path d="M21 9 L14 21 h5 l-2 10 L26 19 h-5 z" fill="#fff"/>',
  valve: '<circle cx="20" cy="20" r="6" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M20 8v6M20 26v6M8 20h6M26 20h6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
  generator: '<rect x="10" y="14" width="20" height="13" rx="2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M21 16 L16 22 h4 l-1 5 5-6h-4z" fill="#fff"/>',
  tank: '<path d="M12 14a8 3.5 0 0 1 16 0v12a8 3.5 0 0 1-16 0z" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M12 14a8 3.5 0 0 0 16 0" fill="none" stroke="#fff" stroke-width="2.2"/>',
  pump: '<circle cx="20" cy="20" r="8" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M20 12v8l6 3" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
  ahu: '<rect x="10" y="12" width="20" height="16" rx="2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M14 17h12M14 23h12" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  fcu: '<rect x="10" y="15" width="20" height="10" rx="2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M14 20h12" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  ice_machine: '<path d="M20 10v20M12 14l16 12M28 14L12 26" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  lift: '<rect x="12" y="10" width="16" height="20" rx="2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M20 14l-3 4h6zM20 26l-3-4h6z" fill="#fff"/>',
  meter: '<circle cx="20" cy="20" r="9" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M20 20l5-4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  grease_trap: '<rect x="11" y="13" width="18" height="14" rx="2" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M11 21h18" stroke="#fff" stroke-width="2" stroke-dasharray="3 2"/>',
  calorifier: '<path d="M13 12h14v16H13z" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M17 16c0 2 2 2 2 4s-2 2-2 4M23 16c0 2 2 2 2 4s-2 2-2 4" stroke="#fff" stroke-width="1.8" fill="none"/>',
  chiller: '<path d="M20 10v20M12 14l16 12M28 14L12 26" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="20" r="3" fill="#fff"/>',
  other: '<circle cx="20" cy="20" r="4.5" fill="#fff"/>',
};

export interface AssetPinOptions {
  kind: AssetKind;
  state: ServiceState;
  /** Shown when the marker holds more than one thing. */
  count?: number;
  size?: number;
  /** A marker anchored to a space rather than surveyed: drawn as an area, not a point. */
  approximate?: boolean;
  selected?: boolean;
}

export function assetDivIcon(o: AssetPinOptions): L.DivIcon {
  const size = o.size ?? 40;
  const fill = STATE_FILL[o.state] ?? STATE_FILL.unknown;
  const stroke = o.selected ? "#0b4fd1" : "#fff";
  const strokeWidth = o.selected ? 3.5 : 2.4;

  /**
   * An anchored marker is dashed. The distinction matters: a dashed marker says
   * "somewhere in this building", a solid one says "here". Drawing them alike
   * would turn an honest approximation into a false precision, and somebody would
   * walk to the wrong wall on the strength of it.
   */
  const body = o.approximate
    ? `<rect x="3" y="3" width="34" height="34" rx="9" fill="${fill}" fill-opacity="0.82" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="5 3.5"/>`
    : `<rect x="3" y="3" width="34" height="34" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;

  const tail = o.approximate ? "" : `<path d="M20 38 L15.5 44 L24.5 44 Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;

  const count = o.count && o.count > 1
    ? `<g><circle cx="33" cy="7" r="7.5" fill="#111827" stroke="#fff" stroke-width="1.8"/><text x="33" y="10.5" text-anchor="middle" font-size="9.5" font-weight="800" font-family="system-ui, sans-serif" fill="#fff">${o.count > 99 ? "99+" : o.count}</text></g>`
    : "";

  const svg = `<svg width="${size}" height="${size * 1.2}" viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">${tail}${body}${GLYPH[o.kind] ?? GLYPH.other}${count}</svg>`;

  return L.divIcon({
    html: svg,
    className: "asset-pin",
    iconSize: [size, size * 1.2],
    // An approximate marker is centred on the area; a surveyed one points at its spot.
    iconAnchor: o.approximate ? [size / 2, size * 0.6] : [size / 2, size * 1.2],
  });
}
