import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findViolations, isTextFile, type Violation } from './english';

// Tracked plus untracked-but-not-ignored files; node_modules and dist are git-ignored.
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);

const violations: Violation[] = [];
for (const file of files) {
  let content: Buffer;
  try {
    content = readFileSync(file);
  } catch {
    continue; // deleted but still listed by git
  }
  if (!isTextFile(file, content)) continue;
  violations.push(...findViolations(file, content.toString('utf8')));
}

if (violations.length > 0) {
  console.error('check:english failed. Only English (Latin script) is allowed:');
  for (const v of violations) console.error(`  ${v.file}:${String(v.line)}  "${v.character}"`);
  process.exit(1);
}
console.log(`check:english passed (${String(files.length)} files scanned).`);
