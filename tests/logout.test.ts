import { beforeEach, describe, expect, it } from "vitest";

import { action, loader } from "~/routes/logout";

import { requestAs, resetDb, seedOrg } from "./helpers/fixtures";

describe("/logout", () => {
  beforeEach(() => resetDb());

  it("a GET (a link, an image on another page) cannot end a session: it only redirects", async () => {
    const res = (await loader()) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("a POST (the Keluar button) clears the session cookie and sends the user to the login page", async () => {
    const { admin } = await seedOrg();
    const request = await requestAs(admin.id);

    const res = (await action({ request: new Request(request, { method: "POST" }) } as never)) as Response;

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/login");
    expect(res.headers.get("Set-Cookie")).toMatch(/__sigula_session=;.*(Max-Age=0|Expires=)/);
  });
});
