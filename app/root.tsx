import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { ensureCronScheduler } from "~/lib/cron.server";
import { seedIfEmpty } from "~/db/seed.server";
import "./app.css";

export const links: Route.LinksFunction = () => [];

/**
 * Headers on every page. No CSP yet (the framework's inline hydration script needs a nonce; DEBT-019).
 * HSTS only in a production build, where the site is served over HTTPS behind Caddy, and without
 * `includeSubDomains`: the other hosts under the same domain are not ours to pin.
 */
export const headers: Route.HeadersFunction = () => ({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(import.meta.env.PROD ? { "Strict-Transport-Security": "max-age=15552000" } : {}),
});

export async function loader() {
  await seedIfEmpty();
  ensureCronScheduler();
  return null;
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Error";
  let details = "Terjadi kesalahan tak terduga.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : `Error ${error.status}`;
    details =
      error.status === 404
        ? "Halaman tidak ditemukan."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container-fluid p-6 mx-auto">
      <h1 className="text-2xl font-bold">{message}</h1>
      <p className="mt-2 text-slate-600">{details}</p>
      {stack ? (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  );
}
