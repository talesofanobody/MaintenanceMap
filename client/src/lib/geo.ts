import L from "leaflet";
import type { GeoJSONPolygon } from "../types";

export function geoJsonToLatLngs(polygon: GeoJSONPolygon): L.LatLngExpression[] {
  const ring = polygon.coordinates[0] ?? [];
  return ring.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
}

export function latLngsToGeoJson(latlngs: L.LatLng[]): GeoJSONPolygon {
  const coords = latlngs.map((p) => [p.lng, p.lat]);
  if (coords.length > 0) {
    const [firstLng, firstLat] = coords[0];
    const [lastLng, lastLat] = coords[coords.length - 1];
    if (firstLng !== lastLng || firstLat !== lastLat) {
      coords.push(coords[0]);
    }
  }
  return { type: "Polygon", coordinates: [coords] };
}

export function centroidOf(latlngs: L.LatLng[]): { lat: number; lng: number } {
  const sum = latlngs.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / latlngs.length, lng: sum.lng / latlngs.length };
}
