import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Behind Caddy the app sees http://host while the browser Origin is https://host.
  // React Router's action CSRF check compares full origins, so allow the public host.
  // DEBT-022: the wildcard also lets sibling subdomains post actions; narrow to sigula.ceater.cc once verified on production.
  allowedActionOrigins: ["sigula.ceater.cc", "*.ceater.cc"],
} satisfies Config;
