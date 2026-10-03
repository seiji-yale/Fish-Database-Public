/**
 * Users tab (FR-ADM-01, ADR-0005): add a person with an initial password and get a one-time invite link,
 * send a new invite, rename, set Member/Admin, remove/reactivate (with confirm).
 */
import { useState } from 'react';
import { addInvite, addUser, deleteUser, updateUser, type AdminUser } from '../../adminApi';
import { inviteUrl } from '../../session';
import { strings } from '../../strings';
import { USERS_CHANGED } from '../../useActingUser';
import { TextField } from '../formFields';
import { RowMenu } from '../RowMenu';
import { ConfirmDialog } from '../shared';
import { Modal } from '../Modal';
import { PromptDialog } from './PromptDialog';
import type { SectionProps } from './types';

const ROLE_LABEL = {
  admin: strings.roleAdmin,
  member: strings.roleMember,
  guest: strings.roleGuest,
} as const;

export function UsersSection({ overview, admin, reload: reloadOverview }: SectionProps) {
  /** Also tells the pages that list people (user lists, mentions) about the change. */
  function reload() {
    reloadOverview();
    window.dispatchEvent(new Event(USERS_CHANGED));
  }
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [initialPassword, setInitialPassword] = useState('');
  /** The invite link of the person just added (shown once: only its hash is stored). */
  const [invite, setInvite] = useState<{ name: string; token: string } | null>(null);
  const [inviting, setInviting] = useState<AdminUser | null>(null);
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<AdminUser | null>(null);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const removedCount = overview.users.filter((user) => !user.isActive && !user.isBuiltin).length;
  // Removed people are hidden unless asked for (the retired built-in Admin entry never shows).
  const visibleUsers = overview.users.filter(
    (user) => user.isActive || (showRemoved && !user.isBuiltin),
  );

  function change(user: AdminUser, body: Record<string, unknown>, after?: () => void) {
    void admin.write(() => updateUser(user.id, body), {
      doneMessage: strings.userDoneChanged,
      onSuccess: () => {
        after?.();
        reload();
      },
      onFields: (fields) => {
        setRenameError(fields['name']);
      },
    });
  }

  return (
    <div className="settings-section">
      <h2>{strings.usersAddHeading}</h2>
      <form
        noValidate
        className="settings-add"
        onSubmit={(event) => {
          event.preventDefault();
          const person = name.trim();
          void admin.write(() => addUser({ name, role, initialPassword }), {
            doneMessage: strings.userDoneAdded,
            onSuccess: (result) => {
              setInvite({ name: person, token: (result as { inviteToken: string }).inviteToken });
              setName('');
              setInitialPassword('');
              reload();
            },
            onFields: setErrors,
          });
        }}
      >
        <TextField
          id="su-name"
          label={strings.userNameField}
          value={name}
          error={errors['name']}
          onChange={setName}
        />
        <label className="form-field" htmlFor="su-role">
          <span>{strings.userRoleField}</span>
          <select
            id="su-role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as 'member' | 'admin');
            }}
          >
            <option value="member">{strings.roleMember}</option>
            <option value="admin">{strings.roleAdmin}</option>
          </select>
          {errors['role'] === undefined ? null : <span role="alert">{errors['role']}</span>}
        </label>
        <TextField
          id="su-password"
          label={strings.userInitialPassword}
          type="password"
          value={initialPassword}
          error={errors['initialPassword']}
          onChange={setInitialPassword}
          autoComplete="new-password"
        />
        <button type="submit" className="button--primary" disabled={admin.busy}>
          {strings.userAdd}
        </button>
      </form>

      <h2>{strings.tabUsers}</h2>
      {removedCount === 0 ? null : (
        <p>
          <button
            type="button"
            aria-pressed={showRemoved}
            onClick={() => {
              setShowRemoved((current) => !current);
            }}
          >
            {showRemoved ? strings.userHideRemoved : strings.userShowRemoved(removedCount)}
          </button>
        </p>
      )}
      <ul className="settings-list">
        {visibleUsers.map((user) => (
          <li key={user.id} className="settings-row">
            <span className="settings-row__main">
              <strong>{user.name}</strong>
              <span className="chip">{ROLE_LABEL[user.role]}</span>
              {user.isBuiltin ? <span className="chip">{strings.userBuiltin}</span> : null}
              {user.isActive && user.invitePending ? (
                <span className="chip">{strings.userWaiting}</span>
              ) : null}
              {user.isActive && !user.isBuiltin && !user.canSignIn ? (
                <span className="chip chip--muted">{strings.userNoPassword}</span>
              ) : null}
              <span className={user.isActive ? 'chip' : 'chip chip--muted'}>
                {user.isActive ? strings.userActive : strings.userInactive}
              </span>
            </span>
            {user.isBuiltin ? null : (
              <RowMenu
                label={strings.userActionsFor(user.name)}
                items={[
                  {
                    label: strings.userRename,
                    onSelect: () => {
                      setRenameError(undefined);
                      setRenaming(user);
                    },
                  },
                  ...(user.isActive
                    ? [
                        {
                          label: strings.userInviteNew,
                          onSelect: () => {
                            setInviteErrors({});
                            setInviting(user);
                          },
                        },
                      ]
                    : []),
                  user.role === 'admin'
                    ? {
                        label: strings.userMakeMember,
                        onSelect: () => {
                          change(user, { role: 'member' });
                        },
                      }
                    : {
                        label: strings.userMakeAdmin,
                        onSelect: () => {
                          change(user, { role: 'admin' });
                        },
                      },
                  user.isActive
                    ? {
                        label: strings.userDeactivate,
                        danger: true,
                        onSelect: () => {
                          setDeactivating(user);
                        },
                      }
                    : {
                        label: strings.userReactivate,
                        onSelect: () => {
                          change(user, { isActive: true });
                        },
                      },
                  ...(user.isActive
                    ? []
                    : [
                        {
                          label: strings.userDelete,
                          danger: true,
                          onSelect: () => {
                            setDeleting(user);
                          },
                        },
                      ]),
                ]}
              />
            )}
          </li>
        ))}
      </ul>

      {invite === null ? null : (
        <InviteDialog
          {...invite}
          onClose={() => {
            setInvite(null);
          }}
        />
      )}
      {inviting === null ? null : (
        <PromptDialog
          title={strings.userInviteNewTitle(inviting.name)}
          label={strings.userInitialPassword}
          initial=""
          secret
          error={inviteErrors['initialPassword']}
          submitLabel={strings.userInviteCreate}
          onCancel={() => {
            setInviting(null);
          }}
          onSubmit={(value) => {
            void admin.write(() => addInvite(inviting.id, { initialPassword: value }), {
              doneMessage: strings.userDoneChanged,
              onSuccess: (result) => {
                setInvite({
                  name: inviting.name,
                  token: (result as { inviteToken: string }).inviteToken,
                });
                setInviting(null);
                reload();
              },
              onFields: setInviteErrors,
            });
          }}
        />
      )}
      {renaming === null ? null : (
        <PromptDialog
          title={strings.userRenameTitle(renaming.name)}
          label={strings.userNameField}
          initial={renaming.name}
          error={renameError}
          onCancel={() => {
            setRenaming(null);
          }}
          onSubmit={(value) => {
            change(renaming, { name: value }, () => {
              setRenaming(null);
            });
          }}
        />
      )}
      {deleting === null ? null : (
        <ConfirmDialog
          title={strings.userDeleteTitle(deleting.name)}
          confirmLabel={strings.userDeleteConfirm}
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            const person = deleting;
            setDeleting(null);
            void admin.write(() => deleteUser(person.id), {
              doneMessage: strings.userDoneDeleted,
              onSuccess: reload,
            });
          }}
        >
          {strings.userDeleteBody}
        </ConfirmDialog>
      )}
      {deactivating === null ? null : (
        <ConfirmDialog
          title={strings.userDeactivateTitle(deactivating.name)}
          confirmLabel={strings.userDeactivate}
          onCancel={() => {
            setDeactivating(null);
          }}
          onConfirm={() => {
            change(deactivating, { isActive: false }, () => {
              setDeactivating(null);
            });
          }}
        >
          {strings.userDeactivateBody}
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The invite link, shown once after adding a person or sending a new invite. */
function InviteDialog({
  name,
  token,
  onClose,
}: {
  name: string;
  token: string;
  onClose: () => void;
}) {
  const url = inviteUrl(token);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={strings.userInviteTitle(name)} titleId="invite-title" onClose={onClose} wide>
      <p>{strings.userInviteBody}</p>
      <div className="invite-box">
        <input
          readOnly
          value={url}
          aria-label={strings.userInviteTitle(name)}
          onFocus={(event) => {
            event.target.select();
          }}
        />
        <button
          type="button"
          className="button--primary"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? strings.userInviteCopied : strings.userInviteCopy}
        </button>
      </div>
      <div className="dialog__actions">
        <button type="button" onClick={onClose}>
          {strings.close}
        </button>
      </div>
    </Modal>
  );
}
