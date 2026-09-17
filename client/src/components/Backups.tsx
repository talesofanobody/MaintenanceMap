import { useEffect, useState } from "react";
import { api } from "../api";
import type { BackupFile } from "../types";
import { formatDateTime } from "../lib/dates";

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Nightly database + photo archives, with a manual run and downloads. Admin only. */
export default function Backups() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function load() {
    api
      .listBackups()
      .then((r) => {
        setBackups(r.backups);
        setDirectory(r.directory);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function runNow() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const file = await api.runBackup();
      setNote(`Backup written: ${file.name} (${size(file.bytes)})`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: BackupFile) {
    if (!confirm(`Delete ${file.name}? This can't be undone.`)) return;
    try {
      await api.deleteBackup(file.name);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Backups</h2>
      <p>
        One archive a night holding the database and every photo, kept for a fortnight. Download one and you can restore the whole system elsewhere. Files are written to{" "}
        <code>{directory || "the server's backups folder"}</code>, so copy them somewhere else as well — a backup on the same machine won't survive losing that machine.
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {note && <div className="banner banner-info">{note}</div>}

      <div className="settings-actions">
        <button type="button" className="btn btn-secondary" onClick={runNow} disabled={busy}>
          {busy ? "Backing up…" : "Back up now"}
        </button>
        <span className="muted small">{backups.length === 0 ? "No backups yet." : `${backups.length} kept`}</span>
      </div>

      {backups.length > 0 && (
        <div className="user-list backup-list">
          {backups.map((file) => (
            <div key={file.name} className="user-row">
              <div>
                <strong>{formatDateTime(file.createdAt)}</strong>
                <span className="muted small">
                  {size(file.bytes)} · {file.includesPhotos ? "database and photos" : "database only"} · {file.name}
                </span>
              </div>
              <div className="user-row-actions">
                <a className="btn btn-ghost btn-small" href={api.backupUrl(file.name)} download>
                  Download
                </a>
                <button type="button" className="btn btn-ghost btn-small btn-danger-text" onClick={() => remove(file)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
