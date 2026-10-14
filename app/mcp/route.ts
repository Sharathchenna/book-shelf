import { handle, notAllowed, options } from "@/lib/mcp";

/** The shelf's MCP server (lib/mcp.ts), with its token in the Authorization header. */
export const POST = (request: Request) => handle(request);
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = options;
