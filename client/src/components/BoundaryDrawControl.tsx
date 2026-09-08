import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";

interface Props {
  initialLatLngs?: L.LatLngExpression[];
  onChange: (latlngs: L.LatLng[] | null) => void;
}

export default function BoundaryDrawControl({ initialLatLngs, onChange }: Props) {
  const map = useMap();
  const initialLatLngsRef = useRef(initialLatLngs);

  useEffect(() => {
    const featureGroup = new L.FeatureGroup();
    map.addLayer(featureGroup);

    if (initialLatLngsRef.current && initialLatLngsRef.current.length > 0) {
      const polygon = L.polygon(initialLatLngsRef.current, { color: "#2563eb" });
      featureGroup.addLayer(polygon);
    }

    const drawControl = new (L.Control as any).Draw({
      position: "topright",
      draw: {
        polygon: {
          allowIntersection: false,
          // leaflet-draw's showArea:true path (readableArea) references an
          // undeclared `type` var, which throws under Vite/esbuild's strict-mode
          // module wrapping. Keep it off to avoid that upstream bug.
          showArea: false,
          shapeOptions: { color: "#2563eb" },
        },
        marker: false,
        circle: false,
        circlemarker: false,
        polyline: false,
        rectangle: false,
      },
      edit: {
        featureGroup,
        remove: true,
      },
    });
    map.addControl(drawControl);

    function extractLatLngs(): L.LatLng[] | null {
      const layers = featureGroup.getLayers() as L.Polygon[];
      if (!layers[0]) return null;
      const rings = layers[0].getLatLngs();
      return (rings[0] as L.LatLng[]) ?? null;
    }

    function handleCreated(e: any) {
      featureGroup.clearLayers();
      featureGroup.addLayer(e.layer);
      onChange(extractLatLngs());
    }
    function handleEdited() {
      onChange(extractLatLngs());
    }
    function handleDeleted() {
      onChange(extractLatLngs());
    }

    map.on((L as any).Draw.Event.CREATED, handleCreated);
    map.on((L as any).Draw.Event.EDITED, handleEdited);
    map.on((L as any).Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off((L as any).Draw.Event.CREATED, handleCreated);
      map.off((L as any).Draw.Event.EDITED, handleEdited);
      map.off((L as any).Draw.Event.DELETED, handleDeleted);
      map.removeControl(drawControl);
      map.removeLayer(featureGroup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}
