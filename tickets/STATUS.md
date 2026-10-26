# Ticket board (public repository)

Tickets T-001 … T-030 were completed in the private history. New tickets start at T-031.
Workflow: one ticket, one branch (`ticket/T-0NN-slug`), one PR; steps with a report and a review in each
ticket's Review Log; run `npm run check:public` and `npm run check` before every PR (`AGENTS.md`).
Migration numbers follow the repository: 0012 is taken (`0012_cryo_use_undo`), so Phase 5 uses 0013 and 0014.

| Ticket | Title                                                    | State | Depends on |
| ------ | -------------------------------------------------------- | ----- | ---------- |
| T-031  | Feeder role and capability model                         | Ready | —          |
| T-032  | Restricted view for Guests and Feeders                   | Draft | T-031      |
| T-033  | Feeding Schedule data and API                            | Draft | T-031      |
| T-034  | Feeding Schedule page                                    | Draft | T-033      |
| T-035  | Monthly summary export and Notes & links                 | Draft | T-034      |
| T-036  | Google Sheet import tool and cut-over                    | Draft | T-033      |
| T-037  | Schedule events, weekly repeat                           | Draft | T-034      |
| T-038  | Sequence file uploads (.ab1 / .fasta / .seq)             | Draft | —          |
| T-039  | Undo Start Breeding (Breeding to Current)                | Draft | —          |
| T-040  | Restore Version dialog: Restore button cannot be pressed | Draft | —          |

See `tickets/HANDOFF.md` for the current state and next steps.
