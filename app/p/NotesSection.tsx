"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNote, deleteNote, updateNote } from "../actions";
import {
  groupNotes,
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABELS,
  type NoteCategory,
  type NoteRow,
} from "@/lib/notes";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function NotesSection({
  prospectId,
  notes,
  emailAnchors,
}: {
  prospectId: string;
  notes: NoteRow[];
  /** message_id to the id of its row in the Emails list, for linking. */
  emailAnchors: Record<string, string>;
}) {
  const groups = groupNotes(notes);

  return (
    <section className="section" id="notes">
      <span className="label">Notes</span>
      <h2>Notes</h2>

      {groups.length === 0 ? (
        <p className="label">
          No notes yet. Add one below, or they will appear here when a prospect replies.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.category} style={{ marginBottom: "var(--s-5)" }}>
            <h3 style={{ marginBottom: "var(--s-2)" }}>{NOTE_CATEGORY_LABELS[group.category]}</h3>
            <ul className="sources">
              {group.notes.map((note) => (
                <NoteItem key={note.id} note={note} emailAnchor={note.source_message_id ? emailAnchors[note.source_message_id] : undefined} />
              ))}
            </ul>
          </div>
        ))
      )}

      <AddNoteForm prospectId={prospectId} />
    </section>
  );
}

function CategorySelect({
  value,
  onChange,
  id,
}: {
  value: NoteCategory;
  onChange: (value: NoteCategory) => void;
  id: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as NoteCategory)}>
      {NOTE_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {NOTE_CATEGORY_LABELS[category]}
        </option>
      ))}
    </select>
  );
}

function NoteItem({ note, emailAnchor }: { note: NoteRow; emailAnchor: string | undefined }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<NoteCategory>(note.category);
  const [body, setBody] = useState(note.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateNote(note.id, category, body);
      if (!result.ok) return setError(result.error);
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("Delete this note?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteNote(note.id);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  const source =
    note.source === "email" ? (
      emailAnchor ? <a href={`#${emailAnchor}`}>From an email reply</a> : "From an email reply"
    ) : (
      "Added by hand"
    );

  if (editing) {
    return (
      <li>
        <form onSubmit={save} style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
          <CategorySelect id={`note-category-${note.id}`} value={category} onChange={setCategory} />
          <textarea
            aria-label="Note"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            style={{ flex: "1 1 100%" }}
          />
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setCategory(note.category);
              setBody(note.body);
              setError(null);
            }}
          >
            Cancel
          </button>
          {error ? <p role="alert" style={{ width: "100%", color: "var(--rosa)", margin: 0 }}>{error}</p> : null}
        </form>
      </li>
    );
  }

  return (
    <li>
      <div style={{ whiteSpace: "pre-wrap" }}>{note.body}</div>
      <div className="label" style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "var(--s-3)", alignItems: "center" }}>
        <span>{formatDate(note.created_at)}</span>
        <span>{source}</span>
        <button type="button" className="btn btn-quiet" disabled={pending} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn btn-quiet" disabled={pending} onClick={remove}>
          Delete
        </button>
      </div>
      {error ? <p role="alert" style={{ color: "var(--rosa)", margin: 0 }}>{error}</p> : null}
    </li>
  );
}

function AddNoteForm({ prospectId }: { prospectId: string }) {
  const [category, setCategory] = useState<NoteCategory>("learned");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addNote(prospectId, category, body);
      if (!result.ok) return setError(result.error);
      setBody("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="panel" style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)" }}>
      <label htmlFor="new-note-category" className="label" style={{ width: "100%" }}>
        Add a note
      </label>
      <CategorySelect id="new-note-category" value={category} onChange={setCategory} />
      <textarea
        aria-label="Note"
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="What did you learn?"
        style={{ flex: "1 1 100%" }}
      />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Adding" : "Add note"}
      </button>
      {error ? <p role="alert" style={{ width: "100%", color: "var(--rosa)", margin: 0 }}>{error}</p> : null}
    </form>
  );
}
