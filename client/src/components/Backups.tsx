import { useEffect, useRef, useState } from "react";
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
  // Restoring replaces everything, so it is deliberately a two-step: say what is
  // in the archive, then ask again with that in front of you.
  const [pending, setPending] = useState<{ name: string; photoCount: number; file?: File } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);

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

  async function offerRestore(file: BackupFile) {
    setError(null);
    setNote(null);
    try {
      const found = await api.inspectBackup(file.name);
      setPending({ name: file.name, photoCount: found.photoCount });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function offerUpload(file: File) {
    setError(null);
    setNote(null);
    // An uploaded archive cannot be inspected without sending it, so the count is
    // only known after the restore. Saying so is better than guessing.
    setPending({ name: file.name, photoCount: -1, file });
  }

  async function confirmRestore() {
    if (!pending) return;
    setRestoring(true);
    setError(null);
    try {
      const result = pending.file ? await api.restoreUpload(pending.file) : await api.restoreBackup(pending.name);
      setPending(null);
      setNote(result.message);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Backups</h2>
      <p>
        One archive a night holding the database and every photo, plus one taken automatically whenever an update is about to change the database. Files are
        written to <code>{directory || "the server's backups folder"}</code>, so copy them somewhere else as well — a backup on the same machine won't
        survive losing that machine. <strong>Restore one now and again</strong> on something other than the live system: a backup nobody has ever put back
        is a backup you only think you have.
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {note && <div className="banner banner-info">{note}</div>}

      <div className="settings-actions">
        <button type="button" className="btn btn-secondary" onClick={runNow} disabled={busy}>
          {busy ? "Backing up…" : "Back up now"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => uploadInput.current?.click()} disabled={restoring}>
          Restore from a file…
        </button>
        <input
          ref={uploadInput}
          type="file"
          accept=".tar.gz,.tgz,.db,application/gzip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) offerUpload(file);
            e.target.value = "";
          }}
        />
        <span className="muted small">{backups.length === 0 ? "No backups yet." : `${backups.length} kept`}</span>
      </div>

      {pending && (
        <div className="restore-confirm">
          <h3>Restore {pending.name}?</h3>
          <p>
            This replaces <strong>the whole database and every photo</strong> with what is in that archive. Anything logged since it was taken — issues,
            inspections, photos, messages — will be gone.
          </p>
          <p className="muted small">
            {pending.photoCount >= 0
              ? `The archive holds ${pending.photoCount} photo${pending.photoCount === 1 ? "" : "s"}.`
              : "Uploaded archives are checked as they are restored."}{" "}
            A copy of everything as it stands now is saved first, so this is itself reversible. You may be signed out afterwards, because the logins come
            from the backup too.
          </p>
          <div className="settings-actions">
            <button type="button" className="btn btn-danger" onClick={confirmRestore} disabled={restoring}>
              {restoring ? "Restoring…" : "Yes, replace everything"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPending(null)} disabled={restoring}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {backups.length > 0 && (
        <div className="user-list backup-list">
          {backups.map((file) => (
            <div key={file.name} className="user-row">
              <div>
                <strong>{formatDateTime(file.createdAt)}</strong>
                <span className="muted small">
                  {size(file.bytes)} · {file.includesPhotos ? "database and photos" : "database only"}
                  {file.kind === "before-update" && " · taken before an update"}
                  {file.kind === "before-restore" && " · taken before a restore"} · {file.name}
                </span>
              </div>
              <div className="user-row-actions">
                <a className="btn btn-ghost btn-small" href={api.backupUrl(file.name)} download>
                  Download
                </a>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => offerRestore(file)} disabled={restoring}>
                  Restore
                </button>
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
