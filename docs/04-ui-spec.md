# UI guide

The client has Dashboard, Lines, Line Detail, New Line, and Settings pages. Forms use labels, visible
focus, text status indicators, and responsive layouts. The browser tests exercise phone, tablet, and
desktop widths.

## 4. Line list

Show searchable lines with status and summary details. Narrow screens use cards; wider screens use
a table. A line opens its detail page.

Restricted roles (Guest, Feeder) see nine columns (Line, Gene, Phenotype(s), DOB, Status, ID Method,
Last ID Date, IDed Number, Reference(s)), the ID Method filter only, an `Age (months)` column toggle,
and no Cryopreserved filter, Breed soon indicator or Export CSV.

## 5. Line detail

### 5.1 Summary

Show name, status, birth date and age, identification count and date, cryopreservation summary,
notes, and other attributes.

### 5.2 Identification

Show protocol cards, fields, image attachments, and genotyping history.

### 5.3 Cryopreservation

Show each freezer record with date, place, range, count, and unknown-details state.

### 5.4 References

Show linked documents and attachments.

### 5.5 Activity

Show dated events and breeding-cycle actions.

### 5.7 History

Show version snapshots and the actor responsible for each change.

### 5.8 Restricted view

Guests and Feeders get one overview card instead of sections 5.1 to 5.7: name, status and gene, then
DOB, age, IDed number, last ID date, current ID method names and phenotypes, then the references with
`Open`. There is no Edit, Change Activity, Export, section bar or side panel, and one line of hint:
`Guest view: details, records and history are not shown.` (Feeders: `Overview only.`).

The Dashboard shows the greeting, the Active, Closed and Cryopreserved counters and the buttons
`See Active Lines` and `See All Lines`. The header has `Dashboard` and `Lines` only: no New Line, Lab
Chat or Settings. `/settings`, `/lines/new`, `/lines/:id/print` and `/feeding` (for roles without it)
show one "Not available" screen with a `Back to Dashboard` link.

## 6. New line

Collect core fields and optional child records in a responsive form. Validate before saving.

## 7. Settings

Admins manage members, lists, and exports. Ordinary members do not see administrative actions.
