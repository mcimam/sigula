/**
 * Contract shared by `UploadDialog` (client) and `handleUpload` (server).
 * No `.server` suffix on purpose: components import it.
 */

export const UPLOAD_INTENT = {
  preview: "preview",
  confirm: "confirm",
  discard: "discard",
} as const;

export const UPLOAD_FIELD = {
  file: "file",
  token: "preview_token",
} as const;

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * What a route action returns for the three upload intents. `P` is the
 * record-specific preview payload, `R` the record-specific result.
 */
export type UploadActionData<P, R> = {
  error?: string;
  preview?: P;
  token?: string;
  result?: R;
  discarded?: true;
};
