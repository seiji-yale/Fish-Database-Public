/** The one screen a restricted role sees for a page it may not open (FR-GUEST-04). */
import type { ReactNode } from 'react';
import { strings } from '../strings';
import type { Capability } from '../../../domain/permissions';
import { useActingUser } from '../useActingUser';

export function NotAvailablePage() {
  const acting = useActingUser();
  return (
    <section className="not-available-page">
      <h1>
        {acting.role === 'guest' ? strings.notAvailableGuestTitle : strings.notAvailableTitle}
      </h1>
      <p>{strings.notAvailableHint}</p>
      <a className="button--primary" href="/">
        {strings.backToDashboard}
      </a>
    </section>
  );
}

/** Shows `children` only to a role with the capability; everyone else gets the standard screen. */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const acting = useActingUser();
  return acting.can(capability) ? <>{children}</> : <NotAvailablePage />;
}
