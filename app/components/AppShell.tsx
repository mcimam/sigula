import { Form, Link, NavLink } from "react-router";

import type { AuthUser } from "~/lib/auth.server";
import type { Role } from "~/db/schema";

const NAV: Record<Role, { to: string; label: string }[]> = {
  admin: [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/transaksi", label: "Transaksi" },
    { to: "/admin/masterdata", label: "Data Master" },
    { to: "/admin/audit", label: "Log Audit" },
    { to: "/admin/settings", label: "Pengaturan" },
  ],
  salesman: [
    { to: "/salesman", label: "Dashboard" },
    { to: "/reports/salesman/me", label: "Export Reminder" },
  ],
  supervisor: [
    { to: "/supervisor", label: "Tim Saya" },
    { to: "/reports/supervisor/me", label: "Export Tim" },
  ],
  management: [
    { to: "/management", label: "Ringkasan" },
    { to: "/reports/management", label: "Export Ringkasan" },
  ],
};

function NavItems({ role }: { role: Role }) {
  return (
    <>
      {NAV[role].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `app-nav-link${isActive ? " app-nav-link--active" : ""}`
          }
          end={item.to === "/salesman" || item.to === "/supervisor" || item.to === "/management"}
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export function AppShell({
  user,
  flash,
  children,
}: {
  user: AuthUser;
  flash?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar hidden md:flex">
        <div className="app-sidebar__brand">
          <Link to="/">SiGula</Link>
        </div>
        <nav className="app-sidebar__nav">
          <NavItems role={user.role} />
        </nav>
        <div className="app-sidebar__user">
          <div className="text-sm font-medium">{user.displayName}</div>
          <div className="text-xs text-slate-500 capitalize">{user.role}</div>
          <Form method="post" action="/logout" className="mt-2">
            <button type="submit" className="btn btn-ghost btn-sm w-full">
              Keluar
            </button>
          </Form>
        </div>
      </aside>

      <div className="min-w-0 flex-1" data-nav>
        <div className="app-topbar flex md:hidden">
          <details className="relative">
            <summary className="btn btn-outline btn-sm list-none cursor-pointer">
              ☰ Menu
            </summary>
            <div className="app-nav-drawer absolute left-0 top-full z-40 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <nav className="app-sidebar__nav" onClick={(e) => {
                const details = (e.currentTarget.closest("details") as HTMLDetailsElement | null);
                if (details) details.open = false;
              }}>
                <NavItems role={user.role} />
              </nav>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="text-sm font-medium">{user.displayName}</div>
                <Form method="post" action="/logout" className="mt-2">
                  <button type="submit" className="btn btn-ghost btn-sm w-full">
                    Keluar
                  </button>
                </Form>
              </div>
            </div>
          </details>
          <span className="font-bold text-teal-800">SiGula</span>
        </div>

        <main className="container-fluid p-3 pb-10 md:p-6">
          {flash ? (
            <div className="alert alert-ok mb-4" role="status">
              {flash}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      <span className="status-pill__dot" aria-hidden />
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "danger" | "muted";
}) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile--${tone}` : ""}`}>
      <div className="stat-tile__value">{value}</div>
      <div className="stat-tile__label">{label}</div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">
          {title}
        </h1>
        {subtitle ? (
          <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
