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
