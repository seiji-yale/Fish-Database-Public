/**
 * `npm run deploy:preview` runs this first. The preview is one shared URL, so a build made from a
 * branch that does not contain the latest `origin/main` silently takes away what was merged since
 * (two agents deploying from two worktrees did exactly that). The guard refuses such a deploy.
 * Set ALLOW_STALE_PREVIEW=1 to deploy anyway (for example to test an old build on purpose).
 */
import { execFileSync } from 'node:child_process';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

try {
  git('fetch', '--quiet', 'origin', 'main');
} catch {
  console.warn('preview-guard: could not reach origin; checking against the last fetched main.');
}

let contains = true;
try {
  git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
} catch {
  contains = false;
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const dirty = git('status', '--porcelain') !== '';
if (!contains && process.env['ALLOW_STALE_PREVIEW'] !== '1') {
  console.error(
    `preview-guard: "${branch}" does not contain origin/main, so this deploy would remove merged work from the shared preview.\n` +
      'Rebase or merge origin/main first (git rebase origin/main), or set ALLOW_STALE_PREVIEW=1 to deploy anyway.',
  );
  process.exit(1);
}
if (dirty) console.warn('preview-guard: note — the working tree has uncommitted changes.');
console.log(
  `preview-guard: deploying "${branch}" at ${git('rev-parse', '--short', 'HEAD')} (contains origin/main).`,
);
