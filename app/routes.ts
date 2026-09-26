import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("salesman", "routes/salesman._index.tsx"),
  route("comments", "routes/comments.tsx"),
  route("webhooks/waha", "routes/webhooks.waha.tsx"),
  route(
    "salesman/customers/:id/record-order",
    "routes/salesman.customers.$id.record-order.tsx",
  ),
  route("supervisor", "routes/supervisor._index.tsx"),
  route("supervisor/salesmen/:id", "routes/supervisor.salesmen.$id.tsx"),
  route(
    "supervisor/customers/:id/reactivate",
    "routes/supervisor.customers.$id.reactivate.tsx",
  ),
  route("management", "routes/management._index.tsx"),
  route("admin/dashboard", "routes/admin.dashboard.tsx"),
  route("admin/reminders", "routes/admin.reminders.redirect.tsx"),
  route("admin/transaksi", "routes/admin.transaksi.tsx"),
  route("admin/transaksi/template.xlsx", "routes/admin.transaksi.template.tsx"),
  route("admin/imports", "routes/admin.imports.redirect.tsx"),
  route("admin/masterdata", "routes/admin.masterdata.tsx"),
  route("admin/audit", "routes/admin.audit.tsx"),
  route("admin/settings", "routes/admin.settings.tsx"),
  route(
    "admin/settings/waha-session",
    "routes/admin.settings.waha-session.tsx",
  ),
  route("reports/salesman/:id", "routes/reports.salesman.$id.tsx"),
  route("reports/supervisor/:id", "routes/reports.supervisor.$id.tsx"),
  route("reports/management", "routes/reports.management.tsx"),
] satisfies RouteConfig;
