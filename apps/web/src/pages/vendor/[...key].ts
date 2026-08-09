import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { vendorContentType } from "../../lib/vendor.js";

const KEY_SEGMENT = /^[A-Za-z0-9@._-]+$/;

// vendor/ 策展资产的只读出口；键段白名单校验，只允许固定字符集。
export const GET: APIRoute = async ({ params }) => {
  if (import.meta.env.DEV) {
    return new Response(null, { status: 404 });
  }

  const segments = (params.key ?? "").split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..") ||
    segments.some((segment) => !KEY_SEGMENT.test(segment))
  ) {
    return new Response(null, { status: 404 });
  }

  const object = await env.F1_DATA.get(`vendor/${segments.join("/")}`);
  if (!object) {
    return new Response(null, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "content-type": vendorContentType(segments[segments.length - 1]),
      "cache-control": "public, max-age=86400",
    },
  });
};
