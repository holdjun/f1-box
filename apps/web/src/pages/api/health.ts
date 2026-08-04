import { env } from "cloudflare:workers";

export async function GET(): Promise<Response> {
  const manifest = await env.F1_DATA.get("v1/seasons/2026/latest.json");
  return Response.json({
    status: "ok",
    seasonData: manifest ? "available" : "missing",
  });
}
