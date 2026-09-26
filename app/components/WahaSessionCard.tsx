import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { StatusPill } from "~/components/AppShell";
import { formatStamp } from "~/lib/activity-format";
import {
  WAHA_SESSION_STATUSES,
  canLogin,
  canLogout,
  describeSessionState,
  type WahaSessionResult,
  type WahaSessionState,
} from "~/lib/waha-session";

const ENDPOINT = "/admin/settings/waha-session";
/** Fast enough that a fresh QR or a completed scan shows up within a moment. */
const POLL_MS = 4000;

/**
 * WhatsApp session panel, the same controls as the WAHA dashboard: live status,
 * Login (shows the QR to scan) and Logout. It talks only to
 * `admin.settings.waha-session` and shows the session of the *saved* WAHA
 * settings. Polls while the browser tab is visible.
 */
export function WahaSessionCard() {
  const fetcher = useFetcher<WahaSessionResult>();
  const { load, submit } = fetcher;
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  // The failure is remembered with the state it happened in, so it goes away
  // by itself once the session moves on (e.g. someone logs in from elsewhere).
  const [failure, setFailure] = useState<{
    message: string;
    state: WahaSessionState;
  } | null>(null);

  const view = fetcher.data?.view;
  // Polling loads also take the fetcher out of "idle"; only a POST is "acting".
  const acting = fetcher.state !== "idle" && fetcher.formMethod !== undefined;
  const idle = fetcher.state === "idle";
  const idleRef = useRef(idle);
  useEffect(() => {
    idleRef.current = idle;
  }, [idle]);

  useEffect(() => {
    load(ENDPOINT);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      // A poll must not interrupt a login/logout that is still in flight.
      if (document.visibilityState === "visible" && idleRef.current) {
        load(ENDPOINT);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const result = fetcher.data;
  useEffect(() => {
    if (result?.error) {
      setFailure({ message: result.error, state: result.view.state });
    }
  }, [result]);

  const state = view?.state;
  useEffect(() => {
    setConfirmingLogout(false);
  }, [state]);

  function act(intent: "login" | "logout") {
    setFailure(null);
    setConfirmingLogout(false);
    submit({ intent }, { method: "post", action: ENDPOINT });
  }

  function refresh() {
    setFailure(null);
    load(ENDPOINT);
  }

  // A failure that only repeats the status message is already on screen.
  const failureMessage =
    failure && failure.state === state && failure.message !== view?.message
      ? failure.message
      : null;
  const shown = view ? describeSessionState(view.state) : null;
  const rawStatus =
    view && (WAHA_SESSION_STATUSES as readonly string[]).includes(view.state)
      ? view.state
      : null;

  return (
    <section
      className="card waha-session mt-6 max-w-2xl"
      aria-labelledby="waha-session-title"
    >
      <div className="waha-session__head">
        <h2
          id="waha-session-title"
          className="text-lg font-semibold text-slate-800"
        >
          Sesi WhatsApp
        </h2>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={refresh}
          disabled={!idle}
        >
          Muat ulang
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Status dan login sesi{" "}
        <code className="font-mono">{view?.session ?? "…"}</code> di WAHA, sama
        seperti di dashboard WAHA. Mengikuti pengaturan yang sudah disimpan di
        atas.
      </p>

      {!view || !shown ? (
        <p className="text-sm text-slate-500" role="status">
          Memeriksa status WAHA…
        </p>
      ) : (
        <>
          <div role="status" aria-live="polite">
            <div className="waha-session__status">
              <StatusPill tone={shown.tone}>{shown.label}</StatusPill>
              {rawStatus ? (
                <span className="waha-session__raw">{rawStatus}</span>
              ) : null}
            </div>
            {view.account ? (
              <p className="mb-2 text-sm text-slate-700">
                Terhubung sebagai{" "}
                <strong>{view.account.name ?? "(tanpa nama)"}</strong>
                {view.account.number ? ` · ${view.account.number}` : ""}
              </p>
            ) : null}
            <p className="text-sm text-slate-500">{shown.hint}</p>
          </div>

          {view.restriction ? (
            <div className="alert alert-warn mt-3" role="alert">
              <strong>WhatsApp membatasi nomor ini.</strong> Untuk sementara pesan
              hanya sampai ke kontak yang lebih dulu mengirim pesan ke nomor ini
              {view.restriction.until
                ? `, sampai ${formatStamp(view.restriction.until)} WIB`
                : ""}
              . Pengingat ke salesman yang belum pernah menghubungi nomor ini ditolak
              WhatsApp — minta salesman mengirim satu pesan ke nomor ini lebih dulu.
            </div>
          ) : null}
          {view.message ? (
            <div className="alert alert-danger mt-3" role="alert">
              {view.message}
            </div>
          ) : null}
          {failureMessage ? (
            <div className="alert alert-danger mt-3" role="alert">
              {failureMessage}
            </div>
          ) : null}

          {view.state === "SCAN_QR_CODE" ? (
            <div className="waha-session__qr">
              {view.qr ? (
                <img
                  src={`data:${view.qr.mimetype};base64,${view.qr.data}`}
                  alt="Kode QR untuk menautkan WhatsApp"
                  width={256}
                  height={256}
                />
              ) : (
                <div className="waha-session__qr-placeholder">
                  Menyiapkan kode QR…
                </div>
              )}
              <ol className="waha-session__steps">
                <li>Buka WhatsApp di ponsel yang memegang nomor pengirim.</li>
                <li>Buka Pengaturan → Perangkat tertaut.</li>
                <li>
                  Ketuk Tautkan perangkat, lalu arahkan kamera ke kode ini.
                </li>
                <li>Kode diperbarui otomatis bila kedaluwarsa.</li>
              </ol>
            </div>
          ) : null}

          <div className="action-row mt-4">
            {canLogin(view.state) ? (
              <button
                type="button"
                className="btn"
                onClick={() => act("login")}
                disabled={acting}
              >
                {acting ? "Memproses…" : "Login WhatsApp"}
              </button>
            ) : null}
            {canLogout(view.state) && !confirmingLogout ? (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setConfirmingLogout(true)}
                disabled={acting}
              >
                Logout
              </button>
            ) : null}
          </div>

          {canLogout(view.state) && confirmingLogout ? (
            <div
              className="waha-session__confirm mt-4"
              role="group"
              aria-label="Konfirmasi logout"
            >
              <span className="text-sm text-slate-700">
                Logout memutus nomor WhatsApp dari SiGula. Pengiriman pengingat
                berhenti sampai login ulang dengan scan QR.
              </span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => act("logout")}
                disabled={acting}
              >
                {acting ? "Memproses…" : "Ya, logout"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setConfirmingLogout(false)}
                disabled={acting}
              >
                Batal
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
