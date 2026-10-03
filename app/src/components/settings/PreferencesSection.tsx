/**
 * Preferences tab (FR-ADM-03): the Upcoming Breeding threshold and PCR defaults, and the Guest link
 * (ADR-0005). Passwords are personal now: everyone changes theirs from the account menu.
 */
import { useState } from 'react';
import { rotateGuestLink, saveSettings } from '../../adminApi';
import { APP_NAME_CHANGED } from '../../session';
import { setProtocolDefaults } from '../../protocolDefaults';
import { strings } from '../../strings';
import { TextField } from '../formFields';
import { ConfirmDialog } from '../shared';
import type { SectionProps } from './types';

export function PreferencesSection({ overview, admin, reload }: SectionProps) {
  const { settings } = overview;
  const [databaseName, setDatabaseName] = useState(settings.databaseName);
  const [threshold, setThreshold] = useState(String(settings.upcomingBreedingMonths));
  const [annealing, setAnnealing] = useState(String(settings.defaultAnnealingC));
  const [cycles, setCycles] = useState(String(settings.defaultCycles));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rotating, setRotating] = useState(false);

  return (
    <div className="settings-section">
      <form
        noValidate
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void admin.write(
            () =>
              saveSettings({
                databaseName,
                upcomingBreedingMonths: threshold,
                defaultAnnealingC: annealing,
                defaultCycles: cycles,
              }),
            {
              doneMessage: strings.prefDone,
              onSuccess: () => {
                window.dispatchEvent(new Event(APP_NAME_CHANGED));
                // The forms of this browser pick up the new defaults at once.
                setProtocolDefaults({ annealing_c: Number(annealing), cycles: Number(cycles) });
                reload();
              },
              onFields: setErrors,
            },
          );
        }}
      >
        <TextField
          id="sp-database-name"
          label={strings.prefDatabaseName}
          hint={strings.prefDatabaseNameHint}
          value={databaseName}
          error={errors['databaseName']}
          maxLength={80}
          onChange={setDatabaseName}
        />
        <TextField
          id="sp-threshold"
          label={strings.prefThreshold}
          hint={strings.prefThresholdHint}
          inputMode="numeric"
          value={threshold}
          error={errors['upcomingBreedingMonths'] ?? errors['form']}
          onChange={setThreshold}
        />
        <TextField
          id="sp-annealing"
          label={strings.prefAnnealing}
          hint={strings.prefDefaultsHint}
          inputMode="decimal"
          value={annealing}
          error={errors['defaultAnnealingC']}
          onChange={setAnnealing}
        />
        <TextField
          id="sp-cycles"
          label={strings.prefCycles}
          inputMode="numeric"
          value={cycles}
          error={errors['defaultCycles']}
          onChange={setCycles}
        />
        <button type="submit" className="button--primary" disabled={admin.busy}>
          {strings.prefSave}
        </button>
      </form>

      <h2>{strings.guestLinkHeading}</h2>
      <p>{strings.guestLinkBody}</p>
      <div className="settings-buttons">
        <button
          type="button"
          disabled={admin.busy}
          onClick={() => {
            setRotating(true);
          }}
        >
          {strings.guestLinkRotate}
        </button>
      </div>
      {rotating ? (
        <ConfirmDialog
          title={strings.guestLinkRotateTitle}
          confirmLabel={strings.guestLinkRotate}
          onCancel={() => {
            setRotating(false);
          }}
          onConfirm={() => {
            setRotating(false);
            void admin.write(() => rotateGuestLink(), {
              doneMessage: strings.guestLinkRotated,
              onSuccess: reload,
            });
          }}
        >
          {strings.guestLinkRotateBody}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
