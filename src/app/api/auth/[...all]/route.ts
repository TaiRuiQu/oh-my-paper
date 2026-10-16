import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { errorResponse } from "@/server/http/errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return await toNextJsHandler(getAuth()).GET(request);
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function POST(request: Request) {
  try {
    return await toNextJsHandler(getAuth()).POST(request);
  } catch (error) {
    return errorResponse(error, request);
  }
}
