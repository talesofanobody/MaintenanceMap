import { FormEvent, useState } from "react";

interface Result {
  display_name: string;
  lat: string;
  lon: string;
}

export default function AddressSearch({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function pick(r: Result) {
    onSelect(parseFloat(r.lat), parseFloat(r.lon));
    setResults([]);
    setQuery(r.display_name);
  }

  return (
    <div className="address-search">
      <form onSubmit={handleSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an address to center the map…"
        />
        <button type="submit" className="btn btn-small" disabled={loading}>
          {loading ? "…" : "Search"}
        </button>
      </form>
      {results.length > 0 && (
        <ul className="address-results">
          {results.map((r, i) => (
            <li key={i} onClick={() => pick(r)}>
              {r.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
