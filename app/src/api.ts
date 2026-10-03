/** The API's error shape (`worker/lib/errors.ts`): what a failed write tells the form. */
export interface ApiErrorBody {
  code: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

/** Thrown by `request` on a non-2xx response; `status` lets a caller tell e.g. 404 from other
 * failures without parsing the message text. `body` is the API's `{ error }` object when the
 * response had one (validation fields, the existing line of a duplicate name, ...). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | null = null,
  ) {
    super(`Request failed with ${String(status)}.`);
    this.name = 'HttpError';
  }
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    const parsed = (await response.json()) as { error?: ApiErrorBody };
    return typeof parsed.error?.code === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

/** The one `fetch` wrapper every API call in the app goes through: same error handling everywhere. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await readErrorBody(response);
    // The session ended (signed out elsewhere, user removed): the shell shows the sign-in page.
    if (response.status === 401 && body?.code === 'LOGIN_REQUIRED')
      window.dispatchEvent(new Event('login-required'));
    throw new HttpError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
