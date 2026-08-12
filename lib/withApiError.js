// Wraps a Next.js Route Handler so an unexpected throw (missing env var,
// storage backend failure, etc.) becomes a clean JSON 500 with a pointer to
// /api/health, instead of an opaque crash that's hard to debug from the
// client side. The real error always still goes to console.error — that's
// what shows up in Vercel's function logs.
export function withApiError(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error('[API ERROR]', err);
      return Response.json(
        { error: 'Internal server error. Check server logs, and GET /api/health for common configuration issues.' },
        { status: 500 }
      );
    }
  };
}
