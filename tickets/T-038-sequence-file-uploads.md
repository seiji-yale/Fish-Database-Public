# T-038 — Sequence file uploads (.ab1 / .fasta / .seq) for ID Protocols and References

|                  |                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- |
| State            | Ready                                                                                       |
| Size             | M                                                                                           |
| Phase            | 5 (independent of T-031 … T-037; schedule it between T-032 and T-033 so no lane is blocked) |
| Depends on       | — (builds on the attachments module, T-016)                                                 |
| Branch           | `ticket/T-038-sequence-files`                                                               |
| Owner acceptance | required on preview URL                                                                     |

## Goal

Let people attach sequencing data to **ID Protocols** and **References**: Sanger trace files (`.ab1`,
also `.abi`), FASTA (`.fasta`, `.fa`, `.fas`) and plain sequence files (`.seq`). Today only JPG, PNG,
WebP, HEIC, PDF and DOCX are accepted, and the ID protocol form takes images only.

## Assumptions (confirm with the owner on the preview)

- "`.ab`" means the ABI trace format `.ab1` (and its `.abi` variant). Plain `.ab` is not a known format and is not accepted.
- Sequence files are downloaded, never displayed: they are always served with `Content-Disposition: attachment`.
- Limit stays 15 MB per file.

## Scope

- `domain/attachments.ts`: new `UploadKind` values `sequence-trace` (binary) and `sequence-text`;
  `ACCEPTED_TYPES` gains `application/octet-stream`-style entries keyed by extension (see Step 1);
  content checks: `.ab1`/`.abi` start with `ABIF`; text types contain no NUL byte in the first 4 KB and
  are valid UTF-8/ASCII; FASTA's first non-blank character is `>`; `.seq` is plain text.
  New message `uploadMessages.wrongType` lists the new types.
- `worker/lib/attachmentWrite.ts` / `worker/routes/attachments.ts`: store with kind `sequence_result`
  (already in the schema CHECK; no migration); serve as `attachment`, `nosniff`, a safe MIME type.
- ID Protocols (`ProtocolManager`, `ProtocolForm*`): a "Sequence files" slot next to the gel image slot;
  list with file name, size, download link, remove (soft delete). Genotyping records keep accepting images only.
- References (`ReferenceManager`): file picker accepts the new types.
- Dropbox mirror, export ZIP, `restore_images.py`: files are mirrored like other attachments (verify; no code change expected).
- Restricted roles (T-032): sequence files are `attachments.read_files`, not `read_refs`, **except** a
  sequence file attached to a Reference, which stays readable by restricted roles like any reference file.
- Docs: `01-requirements.md` FR-REF-02 / upload section, `03-data-model.md` §2.10, `04-ui-spec.md`, user guide.

## Out of scope

- Viewing or parsing traces or alignments in the browser. TIFF (still refused).

## Steps

### Step 1 — Domain rules and tests

Accepted types by extension (browsers report no MIME type for these); `checkUpload` / `contentMatchesType`
extended; table-driven tests per type (valid, wrong extension, renamed binary, empty, > 15 MB); 100 % domain coverage.

### Step 2 — Worker storage and serving

Upload route accepts the types; kind `sequence_result`; download headers; route tests (including a renamed `.exe` refused).

### Step 3 — ID Protocols and References UI

`FilePicker` accept list per slot; sequence list on the protocol card; strings in `strings.ts`; e2e at 375 / 768 / 1280 px.

### Step 4 — Mirror, restore, docs

Mirror path check, restore test with a sequence file, docs folded.

## Acceptance criteria (owner verifies on preview)

1. On an ID Protocol, upload an `.ab1`, a `.fasta` and a `.seq` file; each appears in the list and downloads byte-identical.
2. On a Reference, upload the same three types; they download from the Line Detail page.
3. A text file renamed `x.ab1`, a binary renamed `x.fasta`, and a 16 MB file are refused with a clear message.
4. Removing a file hides it and keeps it in storage (soft delete); History shows the change.
5. Export now (mirror) lists the files; `npm run check` and e2e are green.

## Review Log

<!-- Append Step Reports, Step Reviews, Ticket Review, Owner feedback here, newest at the bottom. -->

### Steps 1 to 4 — 2026-10-26 — implementer

- Step 1: `domain/attachments.ts` gains `sequence-trace` and `sequence-text` kinds, the types `application/x-abif` (.ab1, .abi), `text/x-fasta` (.fasta, .fa, .fas) and `text/x-sequence` (.seq), `UploadScope` (`any` / `images` / `sequence`) in place of the old `imagesOnly` flag, `SEQUENCE_ACCEPT_ATTRIBUTE`, and content checks (ABIF header; FASTA first non-blank `>`; text without NUL and valid UTF-8, with a UTF-8 BOM allowed). The extension decides for sequence files because systems report `text/plain`, `chemical/x-fasta` and the like; the content check guards them. Table-driven tests; domain coverage stays 100 %.
- Step 2: `storeUpload` reads the first 4 KB for the content check; the upload route picks the scope from the kind (`reference_file` any, `sequence_result` sequence files only, the rest images only). Stored as `sequence_result` on a protocol and `reference_file` on a reference; no migration. Served as downloads only (not an inline type, `nosniff`). Line detail attachments now carry `sizeBytes`. Route tests cover each extension, renamed binaries and text, a NUL byte, an empty file, 16 MB, slot separation, references, soft delete with History, and Guest access (refused on a protocol, open through a reference).
- Step 3: `SequenceFiles` list on the protocol card (name, size, download, remove for editors) with its own upload button; the image list no longer shows sequence results. The reference form accepts the new types. `e2e/sequenceFiles.write.spec.ts` at 375, 768 and 1280 px covers the three acceptance cases.
- Step 4: the mirror and the export copy attachments by `r2_key`, so no code change; added a mirror test and a `restore_images.py` test with `.ab1` and `.fasta`. Docs: `01-requirements.md`, `03-data-model.md`, `04-ui-spec.md`. No `user-guide.md` exists in this repository.
- Note: a hand-made 16 MB file is refused by the size check before any upload starts.

### Owner feedback round 1 — 2026-10-26 — implementer

- Several files at once: the file pickers on a protocol (images and sequence files) and in the Add reference dialog take several files. Protocol uploads go one after the other, each from the version the last one returned; a file that fails or is refused is named in the message and the rest still go up. In the Add reference dialog, several files make one reference each, titled with the file name (the link must stay empty); Edit still takes one file.
- File name on a reference: the list (and the Guest/Feeder overview card) shows the uploaded file name with its extension under the title; choosing one file fills an empty title with the file name.
- Link label: a web link says `Open`, an uploaded file says `Download` (list and overview card).
- Tests: e2e for several files, title fill, the file name under the title and `Open` for a link; existing e2e updated for the `Download` label; overview keys now include `fileName`.

### Owner feedback round 2 — 2026-10-26 — implementer

- Icons: new `Icons.tsx` (upload, camera, trash, pencil, copy) and an icon-only button with an accessible name and a tooltip. Upload is an icon in the heading of the Images and Sequence files boxes (and a camera icon on phones); remove is a trash icon on each picture and file row; copy is an icon. "Upload another ..." text buttons are gone.
- Confirmation: removing a gel image or a sequence file asks "Remove this file?" first (Cancel keeps it); the message says the file stays in storage and History records the change.
- ID Protocols design: every item is one box of the same look in a grid (labels inside the box, sequences with their copy icon, long ones on a full row). "Latest image" is now "Images": a gallery of the newest five pictures in one row (about the same height as before), the rest under "Other images (n)".
- Bottom row: `Edit` (with a pencil) and a `...` menu holding Mark as current / Remove from current, Move up, Move down and Remove. Move up/down are in the menu and only offered where they can apply.
- Tests: e2e updated (menu, confirmation, gallery of seven pictures, icon buttons).
