# ADR-0009 — Salesmen answer reminders on WhatsApp, received through the WAHA webhook

| | |
|---|---|
| Status | accepted (implemented on branch `feat/erd-v2-foundation`; not deployed; WAHA still has to be pointed at the endpoint) |
| Date | 2026-09-26 |
| Deciders | User (chat: implement the "Balas dengan alasan" part of the reminder, using WAHA's webhook; reply format = number + reason, and with no number it applies to everyone in that reminder; the system may send a short confirmation) |
| Supersedes | The "WAHA boundary is outbound-only" conclusion in `docs/tdd/sigula-pilot.md` (Self-review) |
| Builds on | ADR-0001 (WAHA), ADR-0002 (manual trigger), ADR-0006 (follow-ups), ADR-0008 (reasons on the customer panel) |

## Context

The reminder ends "Balas dengan alasan: Kalah Harga / Stok Masih Ada / Sudah Bangkrut", but nothing read a reply:
reasons could only be entered in the app (ADR-0008). The TDD had rejected a webhook as unwarranted scope; the user
now wants replies to count, so WAHA has to call us.

## Decision

1. **Endpoint** `POST /webhooks/waha`, no session. **The signature is optional, as it is in WAHA** (user's decision,
   after the first design refused every call while no secret was set and WAHA, configured without an HMAC key, got 503
   for all of them). With a shared secret set (setting `waha.webhook_secret`, secret, env fallback
   `WAHA_WEBHOOK_SECRET`; edited in Pengaturan → Koneksi WAHA) the call must carry `X-Webhook-Hmac`, the HMAC-SHA512 of
   the raw body, or it is refused (401); hex and base64 encodings are both accepted (the WAHA docs do not name one).
   With no secret the call is taken on trust. WAHA is configured with `WHATSAPP_HOOK_URL` and
   `WHATSAPP_HOOK_EVENTS=message`, plus `WHATSAPP_HOOK_HMAC_KEY` when a secret is used (runbook).
2. **Which messages count**: a text `message` event on the configured session, not from ourselves, from a person's own
   chat (`@c.us`, or an anonymous `@lid` that WAHA can map to a number: `GET /api/{session}/lids/{lid}`). Groups, other
   sessions, other events and empty text are ignored (200, so WAHA does not retry).
3. **Who is writing**: the sender's number is compared, by digits, with the salesmen's primary WhatsApp contacts. A
   stranger's message is stored and never answered. The reason is recorded as the salesman's own user (the login linked
   to that salesman) or, without one, with no actor.
4. **Which reminder**: the one quoted (`replyTo`), else the newest delivered salesman reminder that still holds a
   customer waiting, else the newest. To make "3" mean the same thing it meant in the message, each customer's line
   number is stored (`notification_items.position`; the message and the rows share one ordering, `orderByWait`).
   Reminders sent before this have no positions and cannot be answered by number.
5. **Reply grammar** (`reply-parser.ts`): `3 Kalah Harga`, `1,2,5 …`, `1-3 …`, `1 dan 2 …`, one pair per line, or
   several on one line; reasons are matched by their label (from the reasons on offer), ignoring case and
   punctuation. **With no number, the reason applies to every customer of that reminder still waiting** (user's
   decision; ones the same message names by number keep their own reason). Two different unnumbered reasons in one
   message are ambiguous and record nothing. Text after the reason becomes a comment on the customer.
6. **Recording** goes through `submitReason` — the same path as the customer panel: follow-up row, the reminder stops
   being pending, "Sudah Bangkrut" deactivates — and the activity says "Kalah Harga (via WhatsApp)". Numbers that are
   not in the list, already answered, or no longer the salesman's are reported back, not recorded.
7. **Exactly once**: every message is a row in `inbound_messages` with a unique WhatsApp message id; the check and the
   write happen in one synchronous step, so WAHA's retries change nothing. The row is kept for every message from a
   known number, with its outcome (`recorded`, `unrecognized`, `nothing_pending`, `unknown_sender`) and what we
   answered; Log Audit lists them ("Balasan WhatsApp", paged).
8. **Confirmation** (user's decision): after recording, a short message — what was recorded, warnings, how many are
   still waiting. A message we cannot understand gets a how-to at most once an hour per salesman. Only known salesmen
   are ever answered.

## Consequences

- ADR-0002's concern (a number that sends bot-like traffic can be banned) now also applies to confirmations. They are
  replies to a message a salesman just sent, one each, not scheduled or bulk; the hourly limit bounds the unsolicited
  ones. FR-4 still holds for reminders.
- "No number ⇒ everyone" means a bare "Sudah Bangkrut" deactivates every customer of that reminder still waiting. That
  is what was asked for; the confirmation lists what was recorded so a mistake is visible, and reactivating is one click.
- The WAHA side is a deployment step (env vars + restart) the admin must do; until the secret is set and WAHA points at
  the endpoint, replies are simply not received.
- **Without a secret the endpoint is open**: anyone who knows the URL and a salesman's WhatsApp number can post a
  forged reply — recording a reason for that salesman's customers (a bare "Sudah Bangkrut" deactivates them) and making
  us send that salesman a confirmation. What limits it: the sender must be a salesman's own number and the session
  must match; nothing is answered to strangers. Set a secret whenever the URL is reachable from the internet (the
  settings page says so).
- A salesman who shares a phone shares the ability to answer.
- The supervisor's number receives summaries, not reminders: what they write does not record anything.

## Amendment (2026-09-26, later the same day)

Decided with the user after the first replies were tried on a real phone:

1. **The reason may be free text.** After a number ("1. Barang masih ada") the salesman's words *are* the reason. A
   follow-up must have a reason (`follow_ups_reason_required`), so migration 0009 seeds a reason `other` / "Lainnya" that
   is never offered as a choice (`listFollowUpReasons` filters it out; `reasonCounts` and the reports show it); the words
   go in `follow_ups.note` and in the activity ("Barang masih ada (via WhatsApp)"), cut at 500 characters. Only the
   exact offered "Sudah Bangkrut" deactivates a customer; words that merely mention it do not.
2. **Replying to the reminder counts.** When the message quotes ("replies to") one of our reminders (`replyTo` matches the
   sent message's id), it is an answer to *that* reminder: free text without a number applies to every customer of it
   still waiting, and each one's activity is updated. Without a quote, unnumbered free text is treated as chatter (it would
   otherwise apply to every customer); a message that quotes some other message says "mengutip pesan lain" in Log Audit.
   The raw quoted id is stored (`inbound_messages.reply_to`, migration 0008) to see why a quote did not match.
3. **The reminder tells people how to reply**: press Balas, "number + reason" for some customers, the reason alone for all,
   the offered reasons, or your own words (template version 3, migration 0009). Migration 0009 replaces the text only where
   the one in use is still a text this project shipped (0003's or 0006's); an admin's own text is kept.
4. **Privacy and abuse limits** (found in the security review): WAHA forwards every message the account receives, customers'
   chats included, so a message from a number that is not a salesman's is logged without its text and only the latest 200 are
   kept; a salesman's messages are kept 180 days; bodies over 1 MB are refused (413); parsed and stored text is cut at 2,000
   characters. With no secret the endpoint is still open (DEBT-020).
