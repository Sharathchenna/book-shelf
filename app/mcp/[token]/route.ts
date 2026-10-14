import { handle, notAllowed, options } from "@/lib/mcp";

/** The shelf's MCP server (lib/mcp.ts), for clients that only take a URL: the token is its last part. */
export async function POST(request: Request, ctx: RouteContext<"/mcp/[token]">) {
  return handle(request, (await ctx.params).token);
}
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = options;
