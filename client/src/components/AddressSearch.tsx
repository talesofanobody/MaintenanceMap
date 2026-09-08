import { FormEvent, useState } from "react";

interface Result {
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  onSelect: (lat: number, lng: number, zoom?: number) => void;
}

export default function AddressSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      setResults(data);
      if (data.length === 0) setError("No matches — try adding the town or postcode.");
    } catch {
      setResults([]);
      setError("Address search is unavailable right now. You can still pan and zoom the map by hand.");
    } finally {
      setLoading(false);
    }
  }

  function pick(r: Result) {
    onSelect(parseFloat(r.lat), parseFloat(r.lon), 18);
    setResults([]);
    setQuery(r.display_name);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setError("Your browser doesn't support location.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onSelect(pos.coords.latitude, pos.coords.longitude, 19);
      },
      () => {
        setLocating(false);
        setError("Couldn't get your location. Check location permissions for this site.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="address-search">
      <form onSubmit={handleSearch} role="search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an address…"
          aria-label="Search an address"
          inputMode="search"
        />
        <button type="submit" className="btn btn-secondary btn-small" disabled={loading}>
          {loading ? "…" : "Search"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small btn-locate"
          onClick={locateMe}
          disabled={locating}
          title="Use my location"
          aria-label="Use my location"
        >
          {locating ? "…" : "◎"}
        </button>
      </form>
      {(results.length > 0 || error) && (
        <div className="address-results">
          {error && <div className="address-error">{error}</div>}
          {results.map((r, i) => (
            <button type="button" key={i} onClick={() => pick(r)}>
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
