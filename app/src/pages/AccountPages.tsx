/**
 * The pages that need no sign-in or are shown instead of the app (ADR-0005): sign in, the invite
 * link (`/join/<token>`: initial password, then the person's own), the Guest link (`/guest/<token>`)
 * and the forced password change. They are plain pages without the app header.
 */
import { type FormEvent, useEffect, useState } from 'react';
import { HttpError } from '../api';
import { TextField } from '../components/formFields';
import {
  acceptInvite,
  changeOwnPassword,
  enterAsGuest,
  getInvite,
  signIn,
  SESSION_CHANGED,
} from '../session';
import { strings } from '../strings';

function fieldsOf(cause: unknown): Record<string, string> {
  const fields = cause instanceof HttpError ? cause.body?.details?.['fields'] : undefined;
  return (fields ?? {}) as Record<string, string>;
}

function messageOf(cause: unknown): string {
  return cause instanceof HttpError && cause.body !== null
    ? cause.body.message
    : strings.requestFailed;
}

function done(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

export function SignInPage({ notice }: { notice?: string | undefined }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    signIn(name, password)
      .then(done)
      .catch((cause: unknown) => {
        setError(
          cause instanceof HttpError && cause.body?.code === 'INVITE_REQUIRED'
            ? strings.signInInviteHint
            : messageOf(cause),
        );
      })
      .finally(() => {
        setBusy(false);
      });
  }
  return (
    <main className="account-screen">
      <form className="account-card" onSubmit={submit}>
        <h1>{strings.signInTitle}</h1>
        <p>{notice ?? strings.signInHelp}</p>
        <TextField
          id="sign-in-name"
          label={strings.signInName}
          value={name}
          onChange={setName}
          autoComplete="username"
        />
        <TextField
          id="sign-in-password"
          label={strings.signInPassword}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <button className="button--primary" type="submit" disabled={busy}>
          {busy ? strings.signInBusy : strings.signInButton}
        </button>
        {error === null ? null : <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

/** Shown instead of the app while the Admin's initial password is still in use. */
export function ChangePasswordPage({ forced }: { forced: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    changeOwnPassword(current, next)
      .then(done)
      .catch((cause: unknown) => {
        const fields = fieldsOf(cause);
        setErrors(fields);
        setError(Object.keys(fields).length === 0 ? messageOf(cause) : null);
      });
  }
  return (
    <main className="account-screen">
      <form className="account-card" onSubmit={submit}>
        <h1>{strings.changePasswordTitle}</h1>
        {forced ? <p>{strings.changePasswordForced}</p> : null}
        <TextField
          id="cp-current"
          label={strings.passwordCurrent}
          type="password"
          value={current}
          error={errors['currentPassword']}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <TextField
          id="cp-new"
          label={strings.passwordNew}
          type="password"
          value={next}
          error={errors['newPassword']}
          onChange={setNext}
          autoComplete="new-password"
        />
        <button className="button--primary" type="submit">
          {strings.passwordSave}
        </button>
        {error === null ? null : <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

export function JoinPage({ token }: { token: string }) {
  const [who, setWho] = useState<{ name: string } | 'invalid' | null>(null);
  const [initial, setInitial] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getInvite(token)
      .then(setWho)
      .catch(() => {
        setWho('invalid');
      });
  }, [token]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    acceptInvite(token, initial, next)
      .then(() => {
        window.location.replace('/');
      })
      .catch((cause: unknown) => {
        const fields = fieldsOf(cause);
        setErrors(fields);
        setError(Object.keys(fields).length === 0 ? messageOf(cause) : null);
      });
  }
  if (who === null) return <main className="account-screen" aria-busy="true" />;
  if (who === 'invalid')
    return (
      <main className="account-screen">
        <div className="account-card">
          <p role="alert">{strings.joinInvalid}</p>
          <a href="/">{strings.signInButton}</a>
        </div>
      </main>
    );
  return (
    <main className="account-screen">
      <form className="account-card" onSubmit={submit}>
        <h1>{strings.joinTitle(who.name)}</h1>
        <p>{strings.joinHelp}</p>
        <TextField
          id="join-initial"
          label={strings.joinInitial}
          type="password"
          value={initial}
          error={errors['initialPassword']}
          onChange={setInitial}
          autoComplete="current-password"
        />
        <TextField
          id="join-new"
          label={strings.joinNew}
          type="password"
          value={next}
          error={errors['newPassword']}
          onChange={setNext}
          autoComplete="new-password"
        />
        <button className="button--primary" type="submit">
          {strings.joinButton}
        </button>
        {error === null ? null : <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

export function GuestEntryPage({ token }: { token: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void enterAsGuest(token)
      .then(() => {
        window.location.replace('/');
      })
      .catch(() => {
        setFailed(true);
      });
  }, [token]);
  return (
    <main className="account-screen">
      <div className="account-card">
        {failed ? <p role="alert">{strings.guestInvalid}</p> : <p>{strings.guestEntering}</p>}
      </div>
    </main>
  );
}
