/** Lists tab (FR-ADM-02): add / rename / enable / disable entries of each pick-list. */
import { useState } from 'react';
import { addListEntry, updateListEntry, type AdminList, type AdminListEntry } from '../../adminApi';
import { strings } from '../../strings';
import { TextField } from '../formFields';
import { RowMenu } from '../RowMenu';
import { PromptDialog } from './PromptDialog';
import type { SectionProps } from './types';

export function ListsSection({ overview, admin, reload }: SectionProps) {
  const [kind, setKind] = useState<AdminList['kind']>('fluorophore');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<AdminListEntry | null>(null);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);
  const list = overview.lists.find((entry) => entry.kind === kind) ?? overview.lists[0];
  if (list === undefined) return null;

  function change(entry: AdminListEntry, body: Record<string, unknown>, after?: () => void) {
    void admin.write(() => updateListEntry(entry.id, body), {
      doneMessage: strings.listDoneChanged,
      onSuccess: () => {
        after?.();
        reload();
      },
      onFields: (fields) => {
        setRenameError(fields['value']);
      },
    });
  }

  return (
    <div className="settings-section">
      <label className="form-field" htmlFor="sl-kind">
        <span>{strings.listsPick}</span>
        <select
          id="sl-kind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as AdminList['kind']);
            setErrors({});
          }}
        >
          {overview.lists.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {strings.listKindLabels[entry.kind]}
            </option>
          ))}
        </select>
      </label>
      {list.editable ? (
        <>
          <form
            noValidate
            className="settings-add"
            onSubmit={(event) => {
              event.preventDefault();
              void admin.write(() => addListEntry({ kind, value }), {
                doneMessage: strings.listDoneAdded,
                onSuccess: () => {
                  setValue('');
                  reload();
                },
                onFields: setErrors,
              });
            }}
          >
            <TextField
              id="sl-value"
              label={strings.listAddField}
              value={value}
              error={errors['value'] ?? errors['form']}
              onChange={setValue}
            />
            <button type="submit" className="button--primary" disabled={admin.busy}>
              {strings.listAdd}
            </button>
          </form>
          <p className="form-field__hint">{strings.listRenameNote}</p>
        </>
      ) : (
        <p className="form-field__hint">{strings.listFixedNote}</p>
      )}
      <ul className="settings-list">
        {list.entries.map((entry) => (
          <li key={entry.id} className="settings-row">
            <span className="settings-row__main">
              <strong>{entry.value}</strong>
              {entry.isActive ? null : (
                <span className="chip chip--muted">{strings.listDisabledTag}</span>
              )}
            </span>
            {list.editable ? (
              <RowMenu
                label={strings.listEntryActionsFor(entry.value)}
                items={[
                  {
                    label: strings.listRename,
                    onSelect: () => {
                      setRenameError(undefined);
                      setRenaming(entry);
                    },
                  },
                  entry.isActive
                    ? {
                        label: strings.listDisable,
                        danger: true,
                        onSelect: () => {
                          change(entry, { isActive: false });
                        },
                      }
                    : {
                        label: strings.listEnable,
                        onSelect: () => {
                          change(entry, { isActive: true });
                        },
                      },
                ]}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {renaming === null ? null : (
        <PromptDialog
          title={strings.listRenameTitle(renaming.value)}
          label={strings.listAddField}
          initial={renaming.value}
          error={renameError}
          onCancel={() => {
            setRenaming(null);
          }}
          onSubmit={(next) => {
            change(renaming, { value: next }, () => {
              setRenaming(null);
            });
          }}
        />
      )}
    </div>
  );
}
