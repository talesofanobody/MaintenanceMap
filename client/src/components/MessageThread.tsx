import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useCurrentUser } from "../auth/AuthContext";
import type { Issue, Message } from "../types";
import { initials } from "../lib/capacity";

interface Props {
  issue: Issue;
  /** Display logins can read the thread but not add to it. */
  canPost: boolean;
}

/** Turns a timestamp into "just now", "14:32" or a date, depending on how old it is. */
function when(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const mins = Math.round((now - at.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const sameDay = new Date().toDateString() === at.toDateString();
  if (sameDay) return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return at.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Colour an author consistently, so the same person looks the same every time. */
function hueFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hash} 45% 42%)`;
}

/**
 * The conversation on an issue: who said what, and when. Posting is immediate — it isn't
 * tied to saving the rest of the form — so two people can talk on the same issue without
 * overwriting each other, which is what the old single comments box did.
 */
export default function MessageThread({ issue, canPost }: Props) {
  const me = useCurrentUser();
  const [messages, setMessages] = useState<Message[]>(issue.messages ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api
      .listMessages(issue.id)
      .then((fresh) => {
        setMessages(fresh);
        setError(null);
      })
      .catch(() => {
        // A failed refresh shouldn't wipe what is already on screen; the next one retries.
      });
  }, [issue.id]);

  // A conversation is only useful if the other person's reply turns up on its own, so the
  // thread polls while it is open and catches up whenever the tab regains focus.
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function post() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.postMessage(issue.id, body);
      setMessages((list) => [...list, created]);
      setText("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(message: Message) {
    const body = editText.trim();
    if (!body) return;
    setBusy(true);
    try {
      const updated = await api.updateMessage(issue.id, message.id, body);
      setMessages((list) => list.map((m) => (m.id === message.id ? updated : m)));
      setEditingId(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(message: Message) {
    if (!confirm("Delete this message? It can't be brought back.")) return;
    setMessages((list) => list.filter((m) => m.id !== message.id));
    try {
      await api.deleteMessage(issue.id, message.id);
    } catch (e: any) {
      setError(e.message);
      load();
    }
  }

  return (
    <div className="thread">
      <div className="thread-head">
        <span className="field-label">Conversation</span>
        <span className="muted small">
          {messages.length === 0 ? "nothing yet" : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {messages.length > 0 && (
        <ul className="thread-list">
          {messages.map((message) => {
            const mine = !!me && message.userId === me.id;
            const canRemove = mine || me?.role === "admin";
            return (
              <li key={message.id} className={`thread-message ${mine ? "mine" : ""}`}>
                <span className="thread-avatar" style={{ background: hueFor(message.authorName) }} aria-hidden="true">
                  {initials(message.authorName)}
                </span>
                <div className="thread-bubble">
                  <div className="thread-meta">
                    <strong>{mine ? "You" : message.authorName}</strong>
                    <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                      {when(message.createdAt)}
                    </time>
                    {message.editedAt && <span className="thread-edited">edited</span>}
                  </div>

                  {editingId === message.id ? (
                    <div className="thread-edit">
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} aria-label="Edit message" />
                      <div className="thread-edit-actions">
                        <button type="button" className="btn btn-secondary btn-small" disabled={busy || !editText.trim()} onClick={() => saveEdit(message)}>
                          Save
                        </button>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="thread-body">{message.body}</p>
                  )}

                  {canPost && editingId !== message.id && (mine || canRemove) && (
                    <div className="thread-actions">
                      {mine && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(message.id);
                            setEditText(message.body);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {canRemove && (
                        <button type="button" className="danger" onClick={() => remove(message)}>
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          <div ref={endRef} />
        </ul>
      )}

      {canPost ? (
        <div className="thread-composer">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter starts a new line — the usual chat behaviour.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                post();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Add to the conversation… (Enter to send, Shift+Enter for a new line)"
            aria-label="New message"
          />
          <button type="button" className="btn btn-primary btn-small" disabled={busy || !text.trim()} onClick={post}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      ) : (
        messages.length === 0 && <p className="muted small">No messages on this issue yet.</p>
      )}
    </div>
  );
}
