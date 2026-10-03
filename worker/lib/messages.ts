/**
 * Every user-visible API message in one place (AGENTS.md: strings are proofread in one pass).
 * Each message says what happened and what to do next (FR-GLB-03).
 */
export const messages = {
  invalidInput: 'Check the information and try again.',
  userNotFound: 'Choose an active user.',
  // Accounts (ADR-0005, T-027)
  loginRequired: 'Sign in to continue.',
  signInFailed: 'The name or password is not correct. Try again.',
  accountLocked: 'Too many wrong passwords. Wait 15 minutes, then try again, or ask an Admin.',
  inviteRequired:
    'Your account is waiting for its first sign-in. Open the invite link you were sent, or ask an Admin for a new one.',
  inviteInvalid: 'This invite link is not valid any more. Ask an Admin to send you a new one.',
  guestLinkInvalid: 'This guest link is not valid any more. Ask a lab member for the current link.',
  passwordChangeRequired: 'Choose a new password before you continue.',
  passwordWrong: 'The current password is not correct. Try again.',
  passwordTooShort: 'Use at least 8 characters.',
  messageNotFound: 'This message could not be found.',
  chatInvalidMessage: 'Enter a message of 1 to 4000 characters.',
  chatRequestType: 'Choose a request type from the available list.',
  chatEditExpired: 'Messages can only be edited or removed within 15 minutes of posting.',
  chatEditNotAllowed: 'Only the message author can edit or remove this message.',
  chatReadOwn: 'You cannot mark your own message as read.',
  chatMessageRequired: 'This message is no longer available.',
  guestCannotEdit: 'Guests can read but cannot change anything. Sign in with your own account.',
  lineNotFound: 'This line does not exist. Go back to the line list and try again.',
  fileNotFound:
    'This file is not available. Reload the page, and ask the Admin if it is still missing.',
  adminOnly: 'Only an Admin can do this. Ask an Admin.',
  versionNotFound: 'This version does not exist. Reload the page and try again.',
  versionNotRestorable:
    'This version cannot be restored because its content is not in a known format. Ask the Admin.',
  versionConflict: (changedBy: string, changedAt: string) =>
    `This line was changed by ${changedBy} at ${changedAt} — reload to see the changes.`,
  userNotFoundAdmin: 'This user does not exist. Reload the page and try again.',
  listValueNotFound: 'This list entry does not exist. Reload the page and try again.',
  deletedNotFound: 'This deleted item no longer exists or was already restored. Reload the list.',
  deletedNotRestorable: (why: string) => `This item cannot be restored: ${why}`,
  storageUnavailable: 'File storage is not available here. Ask the Admin.',
  uploadMissingFile: 'Choose a file to upload.',
  attachmentNotFound: 'This file does not exist on this line. Reload the page and try again.',
  attachmentNotStaged: 'This upload cannot be used here. Upload the file again.',
  referenceNotFound: 'This reference does not exist. Reload the page and try again.',
  cryoNotFound: 'This cryopreservation record does not exist. Reload the page and try again.',
  protocolNotFound: 'This ID method does not exist on this line. Reload the page and try again.',
  protocolNotRemoved: 'This ID method is not in the removed items. Reload the page and try again.',
  protocolNotOnLine: 'Choose an ID method that belongs to this line.',
  readOnly: 'The database is read-only right now: the Admin is restoring it.',
  readOnlyHint: 'You can still look at everything. Try again when the banner at the top is gone.',
  mirrorNotSetUp: 'The Dropbox copy is not connected on this server.',
  mirrorNotSetUpHint: 'Download the ZIP instead, or ask the maintainer to add the Dropbox secrets.',
  mirrorBusy: 'A Dropbox copy is already running. Wait a minute and check the status below.',
  mirrorFailed: (why: string) => `The Dropbox copy failed: ${why}`,
  internalError: (id: string) => `Something went wrong (id ${id}). Please try again.`,
} as const;
