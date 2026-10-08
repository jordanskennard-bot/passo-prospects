"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProspect } from "./actions";

const FIELDS = [
  { name: "brand", label: "Brand", required: true, placeholder: "Florian Poirot" },
  { name: "domain", label: "Domain", required: false, placeholder: "florianpoirot.co.uk" },
  { name: "town", label: "Town", required: false, placeholder: "York" },
  { name: "category", label: "Category", required: false, placeholder: "Patisserie" },
  { name: "platform", label: "Platform", required: false, placeholder: "Shopify" },
] as const;

type FieldName = (typeof FIELDS)[number]["name"] | "notes";

const EMPTY: Record<FieldName, string> = {
  brand: "", domain: "", town: "", category: "", platform: "", notes: "",
};

export function AddProspectForm() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set(name: FieldName, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function close() {
    setOpen(false);
    setValues(EMPTY);
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setAdded(null);

    startTransition(async () => {
      const result = await addProspect({
        brand: values.brand,
        domain: values.domain,
        town: values.town,
        category: values.category,
        platform: values.platform,
        notes: values.notes,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Keep the panel open so several can be added in a row, but clear it.
      setAdded(values.brand.trim());
      setValues(EMPTY);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div style={{ margin: "var(--s-5) 0 0" }}>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Add prospect
        </button>
        {added ? (
          <span className="label" style={{ marginLeft: "var(--s-3)" }}>
            {added} added
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="panel" style={{ margin: "var(--s-5) 0 0" }}>
      <div className="check-head" style={{ justifyContent: "space-between" }}>
        <span className="label">Add a prospect</span>
        <button type="button" className="btn btn-quiet" onClick={close}>
          Cancel
        </button>
      </div>

      <p style={{ margin: "var(--s-3) 0 var(--s-4)", fontSize: 14 }}>
        For anything not in the spreadsheet. It arrives with status new and no scores,
        and a re-seed will leave it alone.
      </p>

      <form onSubmit={submit}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "var(--s-4)",
          }}
        >
          {FIELDS.map((field) => (
            <div key={field.name}>
              <label htmlFor={`add-${field.name}`} className="label" style={{ display: "block", marginBottom: "var(--s-2)" }}>
                {field.label}
                {field.required ? "" : " (optional)"}
              </label>
              <input
                id={`add-${field.name}`}
                type="text"
                required={field.required}
                autoComplete="off"
                autoCapitalize={field.name === "domain" ? "off" : "words"}
                spellCheck={field.name !== "domain"}
                placeholder={field.placeholder}
                value={values[field.name]}
                onChange={(e) => set(field.name, e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: "var(--s-4)" }}>
          <label htmlFor="add-notes" className="label" style={{ display: "block", marginBottom: "var(--s-2)" }}>
            Notes (optional)
          </label>
          <textarea
            id="add-notes"
            rows={3}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Why they are worth a look."
            style={{
              width: "100%",
              fontFamily: "var(--sans)",
              fontSize: 14,
              color: "var(--ink)",
              background: "var(--paper-2)",
              border: "1px solid var(--paper-rule)",
              borderRadius: "var(--r-1)",
              padding: "var(--s-2) var(--s-3)",
              resize: "vertical",
            }}
          />
        </div>

        <p className="label" style={{ marginTop: "var(--s-3)" }}>
          Paste a full web address if it is easier. We reduce it to the bare domain.
        </p>

        {error ? (
          <p role="alert" style={{ color: "var(--rosa)", fontSize: 14, margin: "var(--s-3) 0 0" }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: "var(--s-3)", marginTop: "var(--s-4)" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Adding" : "Add prospect"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={close} disabled={pending}>
            Done
          </button>
        </div>
      </form>
    </div>
  );
}
