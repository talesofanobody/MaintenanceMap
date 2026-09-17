import { useEffect, useState } from "react";
import { api } from "../api";
import { CATEGORIES, type Tag } from "../types";

const SWATCHES = ["#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#9333ea", "#db2777", "#475569", "#0d9488"];

/** Manage the tag list. Categories are fixed in the app, so they're shown for reference only. */
export default function TagAdmin() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .listTags()
      .then((r) => setTags(r.tags))
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTag({ name: name.trim(), color });
      setName("");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(tag: Tag) {
    try {
      await api.updateTag(tag.id, { active: !tag.active });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function recolour(tag: Tag, next: string) {
    try {
      await api.updateTag(tag.id, { color: next });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove(tag: Tag) {
    if (!confirm(`Delete the tag "${tag.name}"?`)) return;
    try {
      await api.deleteTag(tag.id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Tags</h2>
      <p>
        Labels for the kind of job, on top of its category. The hotel set is created for you — add your own, and turn off any you don't use rather than deleting
        them, so issues already labelled keep their history.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="tag-admin">
        {tags.map((tag) => (
          <div key={tag.id} className={`tag-admin-row ${tag.active ? "" : "off"}`}>
            <span className="tag-chip on" style={{ background: tag.color, borderColor: tag.color }}>
              {tag.name}
            </span>
            <span className="muted small">
              {tag._count?.issues ? `${tag._count.issues} issue${tag._count.issues === 1 ? "" : "s"}` : "unused"}
              {tag.active ? "" : " · off"}
            </span>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${tag.color === c ? "selected" : ""}`}
                  style={{ background: c }}
                  aria-label={`Colour ${tag.name} ${c}`}
                  onClick={() => recolour(tag, c)}
                />
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => toggle(tag)}>
              {tag.active ? "Turn off" : "Turn on"}
            </button>
            <button type="button" className="btn btn-ghost btn-small btn-danger-text" onClick={() => remove(tag)}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="tag-add">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="New tag, e.g. Balcony check"
          maxLength={60}
          aria-label="New tag name"
        />
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch ${color === c ? "selected" : ""}`}
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-small" disabled={busy || !name.trim()} onClick={add}>
          Add tag
        </button>
      </div>

      <details className="category-list">
        <summary>The {CATEGORIES.length} categories issues can belong to</summary>
        <p className="muted small">
          Categories are fixed, because they drive who gets suggested for a job. Set which ones each person covers on the Technicians page.
        </p>
        <div className="tag-picker">
          {CATEGORIES.map((c) => (
            <span key={c.key} className="tag-chip static">
              {c.label}
            </span>
          ))}
        </div>
      </details>
    </section>
  );
}
