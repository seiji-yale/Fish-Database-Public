import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { messages } from './messages';

/**
 * The one error shape every API response uses:
 * `{ error: { code, message, hint?, details? } }` — `message` is plain English for the user.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly hint?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorResponse(c: Context, error: ApiError): Response {
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    error.status,
  );
}

/** `app.onError`: known errors keep their shape; anything else is logged with a short id. */
export function handleError(error: Error, c: Context): Response {
  if (error instanceof ApiError) return errorResponse(c, error);
  if (error instanceof ZodError)
    return errorResponse(c, new ApiError(400, 'INVALID_INPUT', messages.invalidInput));
  const id = crypto.randomUUID().slice(0, 8);
  console.error(`[${id}]`, error);
  return errorResponse(c, new ApiError(500, 'INTERNAL_ERROR', messages.internalError(id)));
}
