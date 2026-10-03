/**
 * Every Settings change: runs the request, shows the API's answer as a toast or inline field errors.
 * (Until ADR-0005 it also asked "Who is making this change?"; the signed-in Admin is the author now.)
 */
import { type ReactNode, useState } from 'react';
import { HttpError } from './api';
import { strings } from './strings';

export interface AdminWriteOptions {
  /** Shown as a toast when the change was saved (a function gets the API's answer). */
  doneMessage: string | ((result: unknown) => string);
  onSuccess?: (result: unknown) => void;
  /** Field errors from the API (`fields`), for showing next to the inputs. */
  onFields?: (fields: Record<string, string>) => void;
}

export function useAdminWrite() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function write(run: () => Promise<unknown>, options: AdminWriteOptions): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await run();
      options.onFields?.({});
      setMessage(
        typeof options.doneMessage === 'function'
          ? options.doneMessage(result)
          : options.doneMessage,
      );
      options.onSuccess?.(result);
    } catch (cause: unknown) {
      const fields = cause instanceof HttpError ? cause.body?.details?.['fields'] : undefined;
      if (fields !== undefined && options.onFields !== undefined)
        options.onFields(fields as Record<string, string>);
      else
        setMessage(
          cause instanceof HttpError && cause.body !== null
            ? cause.body.message
            : strings.activityFailed,
        );
    } finally {
      setBusy(false);
    }
  }

  const dialog: ReactNode = null;
  return { write, busy, message, setMessage, dialog };
}
