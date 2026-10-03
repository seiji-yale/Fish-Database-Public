/** `README.txt` at the top of the Dropbox copy (docs/06-operations.md §1.2). Plain text, English. */
import { DEFAULT_APP_NAME } from '../lib/appName';

export function buildMirrorReadme(appName = DEFAULT_APP_NAME): string {
  return `${appName} - automatic copy
${'='.repeat(appName.length + ' - automatic copy'.length)}

This folder is written by the Fish Database app. It is a COPY for reading and for safekeeping.
Do not edit anything here: the app overwrites these files, and changes made here are lost.
To change data, use the app.

What is here
------------
latest/
  snapshot.html         Open this in any browser, even offline. Search the lines and read the details.
  lines.csv             The Line List "All" view; opens in Excel.
  fish-database.json    Everything, including history and removed items (used to rebuild the app).
  id_protocols.csv, genotyping_records.csv, cryo_records.csv, cryo_vial_uses.csv,
  line_references.csv, attachments.csv, chat_messages.csv, line_versions.csv, users.csv
                        One table per file.
  images/<line>/        Uploaded images and files, in one folder per line.
archive/<date>/         A full copy taken every night. Copies older than 90 days are removed.
logs/mirror.log         One line per copy run: when, ok or failed, how many files.
import/                 The frozen Excel sheet and the import report from launch.

How fresh is it?
----------------
A change in the app appears here within about 5 minutes. If logs/mirror.log shows "failed" for a
long time, tell the Admin: Settings > Data & Backup in the app shows the same status.
`;
}
