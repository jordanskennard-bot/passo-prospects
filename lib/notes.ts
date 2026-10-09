// Prospect notes: the constants and checks shared by the site, the server
// actions and the email scanner. No Next.js imports, so scripts can use it.
// Mirrors the check constraints in supabase/migrations/004_prospect_notes.sql.

export const NOTE_CATEGORIES = [
  "learned",
  "looking_for",
  "challenge",
  "objection",
  "next_step",
  "other",
] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

/** Section headings on the prospect page, in display order. */
export const NOTE_CATEGORY_LABELS: Record<NoteCategory, string> = {
  learned: "What we've learned",
  looking_for: "What they're looking for",
  challenge: "Challenges",
  objection: "Objections",
  next_step: "Next steps",
  other: "Other",
};

export const NOTE_SOURCES = ["manual", "email"] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

export const MAX_NOTE_LENGTH = 2000;

export type NoteRow = {
  id: string;
  prospect_id: string;
  category: NoteCategory;
  body: string;
  source: NoteSource;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export function isNoteCategory(value: unknown): value is NoteCategory {
  return typeof value === "string" && (NOTE_CATEGORIES as readonly string[]).includes(value);
}

/** Validate a note typed in the tracker. Returns the cleaned body or an error. */
export function checkManualNote(
  category: unknown,
  body: unknown,
): { ok: true; category: NoteCategory; body: string } | { ok: false; error: string } {
  if (!isNoteCategory(category)) return { ok: false, error: "Choose a category." };
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, error: "Write the note first." };
  if (text.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `Keep a note under ${MAX_NOTE_LENGTH} characters.` };
  }
  return { ok: true, category, body: text };
}

/** Group notes by category in display order, newest first within each. */
export function groupNotes(notes: NoteRow[]): { category: NoteCategory; notes: NoteRow[] }[] {
  return NOTE_CATEGORIES.map((category) => ({
    category,
    notes: notes
      .filter((n) => n.category === category)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  })).filter((group) => group.notes.length > 0);
}
