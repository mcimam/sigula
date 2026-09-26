import { afterEach, describe, expect, it, vi } from "vitest";

import { handleUpload, UploadError } from "~/lib/upload.server";

function form(fields: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const file = (text = "payload", name = "data.xlsx") =>
  new File([text], name);

/** A record's two callbacks, with spies so tests can see what was applied. */
function handlers(over: { parse?: () => Promise<unknown> } = {}) {
  const parse = vi.fn(
    over.parse ?? (async (buf: Buffer) => ({ size: buf.length })),
  );
  const confirm = vi.fn(async (buf: Buffer, _form: FormData) => ({
    applied: buf.toString(),
  }));
  return { parse, confirm };
}

async function preview(h: ReturnType<typeof handlers>, text = "payload") {
  const res = await handleUpload(
    form({ intent: "preview", file: file(text) }),
    h,
  );
  return res!.token!;
}

describe("handleUpload (preview → confirm / discard)", () => {
  afterEach(() => vi.useRealTimers());

  it("preview parses the file, issues a token and applies nothing", async () => {
    const h = handlers();
    const res = await handleUpload(
      form({ intent: "preview", file: file("hello") }),
      h,
    );
    expect(res).toEqual({ preview: { size: 5 }, token: expect.any(String) });
    expect(h.parse).toHaveBeenCalledOnce();
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("confirm applies the stored bytes exactly once (token is single-use)", async () => {
    const h = handlers();
    const token = await preview(h, "the bytes");

    const first = await handleUpload(
      form({ intent: "confirm", preview_token: token }),
      h,
    );
    expect(first).toEqual({ result: { applied: "the bytes" } });

    const again = await handleUpload(
      form({ intent: "confirm", preview_token: token }),
      h,
    );
    expect(again).toEqual({ error: "Preview kedaluwarsa — upload ulang." });
    expect(h.confirm).toHaveBeenCalledOnce();
  });

  it("confirm hands the whole form to the record (for its own options)", async () => {
    const h = handlers();
    const token = await preview(h);
    await handleUpload(
      form({ intent: "confirm", preview_token: token, treat_unknown: "on" }),
      h,
    );
    const passed = h.confirm.mock.calls[0][1];
    expect(passed.get("treat_unknown")).toBe("on");
  });

  it("an unknown token is refused without applying anything", async () => {
    const h = handlers();
    const res = await handleUpload(
      form({ intent: "confirm", preview_token: "nope" }),
      h,
    );
    expect(res).toEqual({ error: "Preview kedaluwarsa — upload ulang." });
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("a preview older than 30 minutes can no longer be confirmed", async () => {
    vi.useFakeTimers();
    const h = handlers();
    const token = await preview(h);
    vi.advanceTimersByTime(31 * 60 * 1000);
    const res = await handleUpload(
      form({ intent: "confirm", preview_token: token }),
      h,
    );
    expect(res).toEqual({ error: "Preview kedaluwarsa — upload ulang." });
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("discard drops the stored bytes; confirming afterwards is refused", async () => {
    const h = handlers();
    const token = await preview(h);
    expect(
      await handleUpload(form({ intent: "discard", preview_token: token }), h),
    ).toEqual({ discarded: true });
    expect(
      await handleUpload(form({ intent: "confirm", preview_token: token }), h),
    ).toEqual({ error: "Preview kedaluwarsa — upload ulang." });
    // idempotent: discarding again (or an unknown token) is harmless
    expect(
      await handleUpload(form({ intent: "discard", preview_token: token }), h),
    ).toEqual({ discarded: true });
  });

  it("rejects a missing or empty file and never calls parse", async () => {
    const h = handlers();
    expect(await handleUpload(form({ intent: "preview" }), h)).toEqual({
      error: "Pilih file terlebih dahulu.",
    });
    expect(
      await handleUpload(form({ intent: "preview", file: file("") }), h),
    ).toEqual({ error: "Pilih file terlebih dahulu." });
    expect(h.parse).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit (default 10 MB, overridable)", async () => {
    const h = handlers();
    const big = file("x".repeat(2 * 1024 * 1024));
    const res = await handleUpload(form({ intent: "preview", file: big }), {
      ...h,
      maxBytes: 1024 * 1024,
    });
    expect(res).toEqual({ error: "File terlalu besar (maks 1 MB)." });
    expect(h.parse).not.toHaveBeenCalled();
  });

  it("an unreadable file gives a message and no token", async () => {
    const h = handlers({
      parse: async () => {
        throw new Error("zip: corrupt");
      },
    });
    const res = await handleUpload(form({ intent: "preview", file: file() }), h);
    expect(res).toEqual({ error: expect.stringContaining("tidak bisa dibaca") });
    expect(res).not.toHaveProperty("token");

    const custom = await handleUpload(
      form({ intent: "preview", file: file() }),
      { ...h, unreadableMessage: "Bentuk file salah." },
    );
    expect(custom).toEqual({ error: "Bentuk file salah." });
  });

  it("an UploadError from parse or confirm is shown as-is", async () => {
    const h = handlers({
      parse: async () => {
        throw new UploadError("Kolom Nama hilang.");
      },
    });
    expect(
      await handleUpload(form({ intent: "preview", file: file() }), h),
    ).toEqual({ error: "Kolom Nama hilang." });

    const ok = handlers();
    const token = await preview(ok);
    const res = await handleUpload(
      form({ intent: "confirm", preview_token: token }),
      {
        ...ok,
        confirm: async () => {
          throw new UploadError("Sheet tidak dikenal.");
        },
      },
    );
    expect(res).toEqual({ error: "Sheet tidak dikenal." });
  });

  it("any other confirm error propagates (it is a bug, not a user message)", async () => {
    const ok = handlers();
    const token = await preview(ok);
    await expect(
      handleUpload(form({ intent: "confirm", preview_token: token }), {
        ...ok,
        confirm: async () => {
          throw new Error("db locked");
        },
      }),
    ).rejects.toThrow("db locked");
  });

  it("returns null for intents that are not upload intents", async () => {
    const h = handlers();
    const token = await preview(h);
    expect(await handleUpload(form({ intent: "create" }), h)).toBeNull();
    expect(await handleUpload(form({}), h)).toBeNull();
    // ...and does not disturb a pending preview
    expect(
      await handleUpload(form({ intent: "confirm", preview_token: token }), h),
    ).toHaveProperty("result");
  });
});
