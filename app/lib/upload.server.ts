import {
  DEFAULT_MAX_UPLOAD_BYTES,
  UPLOAD_FIELD,
  UPLOAD_INTENT,
  type UploadActionData,
} from "~/lib/upload";

const TTL_MS = 30 * 60 * 1000;

const uploads = new Map<string, { buffer: Buffer; fileName: string; expires: number }>(); // DEBT-006

/** A message that is safe to show to the user as-is. Anything else is a 500. */
export class UploadError extends Error {}

function storeUpload(buffer: Buffer, fileName: string) {
  const token = crypto.randomUUID();
  uploads.set(token, { buffer, fileName, expires: Date.now() + TTL_MS });
  for (const [k, v] of uploads) {
    if (v.expires < Date.now()) uploads.delete(k);
  }
  return token;
}

/** Single use: a token can be confirmed once. */
function takeUpload(token: string) {
  const entry = uploads.get(token);
  uploads.delete(token);
  if (!entry || entry.expires < Date.now()) return null;
  return { buffer: entry.buffer, fileName: entry.fileName };
}

/**
 * Server half of the preview → confirm/cancel upload flow (`UploadDialog` is
 * the client half). Call it from a route action; a record supplies only what
 * is specific to it:
 *
 *   const upload = await handleUpload(form, { parse, confirm });
 *   if (upload) return upload;
 *
 * Returns `null` when the request is not one of the upload intents, so the
 * action carries on with its own intents. Nothing is applied before `confirm`.
 *
 * - `parse` reads the file into a preview and must not change any data. Any
 *   error it throws becomes `unreadableMessage` (FRD: unreadable file → a
 *   message, nothing applied) unless it is an `UploadError`.
 * - `confirm` applies the file. Throw `UploadError` for user-fixable problems.
 */
export async function handleUpload<P, R>(
  form: FormData,
  handlers: {
    parse: (buffer: Buffer) => Promise<P>;
    confirm: (buffer: Buffer, form: FormData, file: { fileName: string }) => Promise<R>;
    maxBytes?: number;
    unreadableMessage?: string;
  },
): Promise<UploadActionData<P, R> | null> {
  const intent = String(form.get("intent") ?? "");
  const token = String(form.get(UPLOAD_FIELD.token) ?? "");

  if (intent === UPLOAD_INTENT.preview) {
    const maxBytes = handlers.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    const file = form.get(UPLOAD_FIELD.file);
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Pilih file terlebih dahulu." };
    }
    if (file.size > maxBytes) {
      return {
        error: `File terlalu besar (maks ${Math.round(maxBytes / 1024 / 1024)} MB).`,
      };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    let preview: P;
    try {
      preview = await handlers.parse(buffer);
    } catch (err) {
      return {
        error:
          err instanceof UploadError
            ? err.message
            : (handlers.unreadableMessage ??
              "File tidak bisa dibaca. Pastikan formatnya valid dan sesuai template."),
      };
    }
    return { preview, token: storeUpload(buffer, file.name) };
  }

  if (intent === UPLOAD_INTENT.confirm) {
    const upload = takeUpload(token);
    if (!upload) return { error: "Preview kedaluwarsa — upload ulang." };
    try {
      return { result: await handlers.confirm(upload.buffer, form, { fileName: upload.fileName }) };
    } catch (err) {
      if (err instanceof UploadError) return { error: err.message };
      throw err;
    }
  }

  if (intent === UPLOAD_INTENT.discard) {
    uploads.delete(token);
    return { discarded: true };
  }

  return null;
}
