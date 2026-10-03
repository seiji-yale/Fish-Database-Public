import { readFileSync } from 'node:fs';
import { findFreeTierProblems } from './free-tier';

const problems = findFreeTierProblems(readFileSync('wrangler.toml', 'utf8'));
if (problems.length > 0) {
  console.error('check:free-tier failed. wrangler.toml declares paid or budget-risk features:');
  for (const p of problems) console.error(`  ${p}`);
  console.error('Running cost must stay $0 (NFR-08). Ask the owner before changing this.');
  process.exit(1);
}
console.log('check:free-tier passed.');
