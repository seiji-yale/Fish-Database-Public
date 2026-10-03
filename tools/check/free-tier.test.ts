import { describe, expect, it } from 'vitest';
import { findFreeTierProblems } from './free-tier';

const base = 'name = "x"\nmain = "worker/index.ts"\n';

describe('findFreeTierProblems', () => {
  it('accepts a compliant file with D1, R2, assets and cron triggers', () => {
    const toml = `${base}
[[d1_databases]]
binding = "DB"
[[r2_buckets]]
binding = "FILES"
[triggers]
crons = ["* * * * *"]
[assets]
directory = "./app/dist"
`;
    expect(findFreeTierProblems(toml)).toEqual([]);
  });

  it('flags kv_namespaces', () => {
    expect(findFreeTierProblems(`${base}\n[[kv_namespaces]]\nbinding = "K"\n`)).toEqual([
      'kv_namespaces',
    ]);
  });

  it('flags durable_objects', () => {
    expect(findFreeTierProblems(`${base}\n[durable_objects]\nbindings = []\n`)).toEqual([
      'durable_objects',
    ]);
  });

  it('flags queues', () => {
    expect(
      findFreeTierProblems(`${base}\n[[queues.producers]]\nqueue = "q"\nbinding = "Q"\n`),
    ).toEqual(['queues']);
  });

  it('flags routes and route', () => {
    expect(findFreeTierProblems(`${base}routes = ["example.com/*"]\n`)).toEqual(['routes']);
    expect(findFreeTierProblems(`${base}route = "example.com/*"\n`)).toEqual(['route']);
  });

  it('flags forbidden keys inside an environment', () => {
    const toml = `${base}\n[env.production]\nroutes = ["example.com/*"]\n`;
    expect(findFreeTierProblems(toml)).toEqual(['env.production.routes']);
  });
});
