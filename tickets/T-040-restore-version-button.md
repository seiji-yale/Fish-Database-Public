# T-040 — Restore Version dialog: the Restore button cannot be pressed

|                  |                               |
| ---------------- | ----------------------------- |
| State            | Draft                         |
| Size             | S                             |
| Phase            | Fixes                         |
| Depends on       | —                             |
| Branch           | `ticket/T-040-restore-button` |
| Owner acceptance | required on preview URL       |

## Problem (reported on the public version)

In the Restore version confirmation dialog, Cancel works but **Restore** cannot be pressed, so a version cannot be restored.

## Findings so far (from reading the code, not yet reproduced)

`HistoryPanel.tsx` `RestoreFlow` disables the button while `busy || preview === null || preview.changes.length === 0`.
Likely causes, in order of probability:

1. **Empty preview.** Restore only applies descriptive fields (`descriptiveFromSnapshot`, `previewDescriptive`): name, gene, phenotypes, DOB, attributes, notes. Status and breeding dates are not restored. Restoring a version that differs only in status (for example the version before Start Breeding, which is the natural way to try to undo it) gives `changes = []`; the dialog then disables Restore and shows "no difference". The user sees a dead button. (Related to T-039.)
2. The preview request failed or is still pending (`preview === null` forever when the request errors; only a message is shown).
3. A CSS / stacking problem making the button unclickable at some widths.
4. `busy` stuck true after an error.

## Scope

- Step 1: reproduce with a Playwright test (versions with a descriptive change, with a status-only change, and a failing preview) at 375 / 768 / 1280 px. Record which cause applies.
- Fix according to the cause. Whatever the cause:
  - When there is nothing to restore, explain why in the dialog: `This version differs only in status or breeding dates, which Restore does not change.` and offer a link to the relevant action (Cancel Breeding, Reopen).
  - When the preview fails, show the error and a Retry; never leave the button disabled with no explanation.
  - The disabled button shows a reason (text, not only colour).
- `app/src/strings.ts` for all new text; component test for each state.

## Out of scope

- Making Restore revert status or breeding fields (decide separately; T-039 covers undoing Breeding).

## Acceptance criteria

1. Restoring a version with descriptive changes works from the dialog on phone and desktop.
2. For a status-only difference the dialog says why nothing can be restored and points to the right action.
3. A failed preview shows the error and a Retry.
4. A regression test covers each state.

## Review Log
