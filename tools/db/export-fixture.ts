/**
 * Writes the export (`fish-database.json`) of the small test fixture to a file: a real exporter output for
 * the restore tool's tests (tools/import/test_restore_from_export.py). Not used outside tests.
 *
 *   npx tsx tools/db/export-fixture.ts <output.json>
 */
import { writeFileSync } from 'node:fs';
import fixture from '../../tests/fixtures/lines.small.json';
import { loadFixture } from '../../worker/db/fixtures';
import { createMigratedDb } from '../../worker/db/testing/testDb';
import { buildExportFiles } from '../../worker/export/build';
import { exportLinesCsv } from '../../worker/export/linesCsv';

const output = process.argv[2];
if (output === undefined) {
  console.error('Usage: npx tsx tools/db/export-fixture.ts <output.json>');
  process.exit(2);
}
const db = createMigratedDb();
await loadFixture(db, fixture);
const { json } = await buildExportFiles(db, new Date('2026-10-05T15:30:00Z'), exportLinesCsv);
writeFileSync(output, `${JSON.stringify(json, null, 2)}\n`);
console.log(`Wrote ${output}`);
