/** Checks the files that Git would publish. Run in the clean public repository, not the private source. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { parse } from 'smol-toml';

const binaryFixtures: Record<string, string> = {
  'tests/fixtures/gel.png': 'b87db0be682df2ce4bdff2529b564d3ec93c6fa187fdc91e8eb59c28631be03f',
  'tests/fixtures/gel2.png': 'bd4cf526d0a75c1ded221e29c5fab5e3bc4298711742619acc952648d21b2531',
  'tests/fixtures/method.pdf': '5a838678058f6de375e8635b5f2fea47a4e5f07cb1a882a44b10f39abc6f34ff',
  'tests/fixtures/not-an-image.exe':
    '7bc66557ad137c5286b2a4c9e78e1e3e23b98f84cf875d7d68ee75a353ded57d',
};
const forbiddenPaths = [
  /(^|\/)\.dev\.vars(?:\.|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)wrangler\.jsonc?$/,
  /(^|\/)mapping\.private\.json$/,
  /\.(?:xlsx?|sqlite3?|db|pem|key)$/i,
];
const patterns: [string, RegExp][] = [
  [
    'an e-mail address',
    /[A-Za-z0-9._%+-]+@(?!example\.com\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  ],
  ['a deployed workers.dev host', /\b[a-z0-9-]+\.(?!your-account\.)[a-z0-9-]+\.workers\.dev\b/g],
  [
    'a non-placeholder UUID',
    /\b(?!0{8}-0{4}-0{4}-0{4}-0{11}[0-9a-f]\b)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
  ],
];

const listed = execFileSync('git', [
  'ls-files',
  '-z',
  '--cached',
  '--others',
  '--exclude-standard',
]);
const files = listed.toString('utf8').split('\0').filter(Boolean);
let failures = 0;

for (const path of files) {
  if (path !== '.dev.vars.example' && forbiddenPaths.some((pattern) => pattern.test(path))) {
    console.error(`Forbidden file: ${path}`);
    failures += 1;
    continue;
  }
  if (lstatSync(path).isSymbolicLink()) {
    console.error(`Unexpected symbolic link: ${path}`);
    failures += 1;
    continue;
  }
  const bytes = readFileSync(path);
  const expected = binaryFixtures[path];
  if (expected !== undefined) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) {
      console.error(`Changed binary fixture: ${path}`);
      failures += 1;
    }
    continue;
  }
  if (bytes.includes(0)) {
    console.error(`Unreviewed binary file: ${path}`);
    failures += 1;
    continue;
  }
  const text = bytes.toString('utf8');
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(`${path}\n${text}`)) {
      console.error(`Possible ${label}: ${path}`);
      failures += 1;
    }
  }
}

const required = [
  'wrangler.toml',
  'worker/db/migrations/0002_seed_users.sql',
  'tests/fixtures/lines.small.json',
  'tests/fixtures/users.sql',
];
for (const path of required)
  if (!files.includes(path)) {
    console.error(`Missing public fixture or configuration: ${path}`);
    failures += 1;
  }

if (required.every((path) => files.includes(path))) {
  const wrangler = parse(readFileSync('wrangler.toml', 'utf8')) as {
    env?: Record<
      string,
      {
        name?: string;
        d1_databases?: { database_id?: string; database_name?: string }[];
        r2_buckets?: { bucket_name?: string }[];
      }
    >;
  };
  const placeholderId = /^00000000-0000-0000-0000-00000000000[0-9]$/;
  for (const environment of ['preview', 'production', 'rehearsal']) {
    const config = wrangler.env?.[environment];
    const database = config?.d1_databases?.[0];
    const bucket = config?.r2_buckets?.[0];
    const base = environment === 'rehearsal' ? 'your-rehearsal' : `your-${environment}`;
    if (
      config?.name !== (environment === 'rehearsal' ? base : `${base}-worker`) ||
      database?.database_name !== (environment === 'rehearsal' ? base : `${base}-db`) ||
      !placeholderId.test(database.database_id ?? '') ||
      bucket?.bucket_name !== `${base}-files`
    ) {
      console.error(`Non-placeholder ${environment} deployment configuration in wrangler.toml.`);
      failures += 1;
    }
  }
  const seed = readFileSync('worker/db/migrations/0002_seed_users.sql', 'utf8');
  const seededNames = [...seed.matchAll(/'([^']+)', '(?:admin|guest|member)'/g)].map(
    (match) => match[1],
  );
  if (seededNames.sort().join(',') !== 'Admin,Guest') {
    console.error('Hosted migration must seed built-in Admin and Guest only.');
    failures += 1;
  }
  const fixture = JSON.parse(readFileSync('tests/fixtures/lines.small.json', 'utf8')) as {
    lines?: { name?: string }[];
  };
  if (
    fixture.lines?.length !== 5 ||
    fixture.lines.some((line) => !/^demo_[a-z][0-9]$/i.test(line.name ?? ''))
  ) {
    console.error('Line fixture must contain only five synthetic demo names.');
    failures += 1;
  }
  const users = readFileSync('tests/fixtures/users.sql', 'utf8');
  const userNames = [...users.matchAll(/'([^']+)', 'member'/g)].map((match) => match[1]);
  if (userNames.sort().join(',') !== 'Alice,Bob,Carol,Dan,Erin') {
    console.error('Local account fixture must contain synthetic members only.');
    failures += 1;
  }
}

console.log(`check:public — scanned ${String(files.length)} files; ${String(failures)} issue(s).`);
process.exitCode = failures === 0 ? 0 : 1;
