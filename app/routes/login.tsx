import { Form, redirect, useActionData, useSearchParams } from "react-router";

import type { Route } from "./+types/login";
import {
  checkLoginThrottle,
  clearLoginFailures,
  createUserSession,
  getAuthUser,
  homeForRole,
  recordLoginFailure,
  verifyLogin,
} from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getAuthUser(request);
  if (user) throw redirect(homeForRole(user.role));
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const key = `${ip}:${username.toLowerCase()}`;
  if (!checkLoginThrottle(key)) {
    return { error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." };
  }

  const user = await verifyLogin(username, password);
  if (!user) {
    recordLoginFailure(key);
    return { error: "Username atau password salah." };
  }
  clearLoginFailures(key);
  return createUserSession(user.id, next.startsWith("/") ? next : "/");
}

export default function LoginPage() {
  const data = useActionData<typeof action>();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">SiGula</div>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Pantau siklus reorder pelanggan dan follow-up sales.
        </p>
        {data?.error ? (
          <div className="alert alert-danger mb-4" role="alert">
            {data.error}
          </div>
        ) : null}
        <Form method="post">
          <input type="hidden" name="next" value={next} />
          <div className="form-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              className="form-control"
              autoComplete="username"
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              className="form-control"
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn w-full">
            Masuk
          </button>
        </Form>
        <p className="mt-4 text-xs text-slate-400">
          Demo: admin / salesman / supervisor / management — password{" "}
          <code>sigula123</code>
        </p>
      </div>
    </div>
  );
}
