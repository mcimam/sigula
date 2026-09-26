import { Form } from "react-router";

import { TEMPLATE_PLACEHOLDERS } from "~/lib/template-vars";

export type TemplateView = {
  code: string;
  channel: string;
  title: string;
  recipientKind: string;
  subject: string;
  body: string;
  version: number;
  /** The text rendered with sample data, so an admin sees what a recipient would read. */
  preview: string;
};

/**
 * One editable message text. Saving posts to `/admin/settings` and creates a
 * new version (the old one stays with the deliveries that used it). `draft`
 * keeps what the admin typed when the save was rejected.
 */
export function TemplateCard({
  template,
  draft,
  busy,
}: {
  template: TemplateView;
  draft?: { body: string; subject: string };
  busy: boolean;
}) {
  const id = `${template.code}-${template.channel}`;
  return (
    <div className="card max-w-2xl">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{template.title}</h2>
        <span className="text-xs text-slate-400">
          {template.channel} · versi {template.version}
        </span>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Dikirim ke{" "}
        {template.recipientKind === "supervisor" ? "supervisor (ringkasan tim)" : "salesman"}.
        Placeholder:{" "}
        {TEMPLATE_PLACEHOLDERS.map((k) => (
          <code key={k} className="mr-1">{`{{${k}}}`}</code>
        ))}
      </p>
      <Form method="post" action="/admin/settings">
        <input type="hidden" name="intent" value="save_template" />
        <input type="hidden" name="code" value={template.code} />
        <input type="hidden" name="channel" value={template.channel} />
        {template.channel === "email" ? (
          <div className="form-field">
            <label htmlFor={`${id}-subject`}>Subjek</label>
            <input
              id={`${id}-subject`}
              name="subject"
              className="form-control"
              defaultValue={draft?.subject ?? template.subject}
            />
          </div>
        ) : null}
        <div className="form-field">
          <label htmlFor={`${id}-body`}>Isi pesan</label>
          <textarea
            id={`${id}-body`}
            name="body"
            className="form-control"
            rows={4}
            required
            defaultValue={draft?.body ?? template.body}
          />
        </div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan versi baru"}
        </button>
      </Form>
      <div className="mt-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Pratinjau (data contoh)
        </div>
        <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{template.preview}</pre>
      </div>
    </div>
  );
}
