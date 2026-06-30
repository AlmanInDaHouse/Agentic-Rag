/**
 * A10-W.8b — tolerant application/json body parser. A bodyless POST (e.g. the integrated
 * runtime's /start | /cancel | /recover) sent by a browser `fetch` still carries a
 * `content-type: application/json` header; Fastify's default parser rejects an empty body
 * with FST_ERR_CTP_EMPTY_JSON_BODY (400). This parser treats an empty/blank body as `{}`
 * and otherwise parses JSON normally (a malformed non-empty body still 400s).
 */

import type { FastifyInstance } from "fastify";

export function registerTolerantJsonParser(app: FastifyInstance): void {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body.trim() : "";
    if (text === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
}
