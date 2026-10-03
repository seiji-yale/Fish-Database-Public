import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import type { LineRow } from './db/types';
import { markMessageRead } from './db/queries/chatReads';
import { createMigratedDb, insertRaw } from './db/testing/testDb';
import { loadFixture } from './db/fixtures';
import {
  makeActivity,
  makeChatMessage,
  makeCryoRecord,
  makeLine,
  USER_ID,
} from './db/testing/builders';
import { buildDashboardLists } from './lib/dashboard';
import { guestFetch } from './testBrowser';
import type { Bindings } from './middleware/session';

function makeLinesForAcceptance(): LineRow[] {
  const upcomingNames = ['demo_c3', 'demo_006', 'demo_008', 'demo_010', 'demo_b2', 'demo_027'];
  const breedingNames = ['demo_002', 'demo_009', 'demo_036'];
  const upcoming = upcomingNames.map((name, index) =>
    makeLine({ id: `up-${String(index)}`, name, dob: '2025-09-25', updated_by: USER_ID.bob }),
  );
  const breeding = breedingNames.map((name, index) =>
    makeLine({
      id: `breed-${String(index)}`,
      name,
      status: 'Breeding',
      dob: '2024-01-01',
      breeding_started_at: '2026-09-01',
    }),
  );
  const closed = Array.from({ length: 19 }, (_, index) =>
    makeLine({
      id: `closed-${String(index)}`,
      name: `closed-${String(index)}`,
      status: 'Closed',
      dob: '2024-01-01',
    }),
  );
  const younger = Array.from({ length: 14 }, (_, index) =>
    makeLine({ id: `new-${String(index)}`, name: `new-${String(index)}`, dob: '2026-01-25' }),
  );
  return [...upcoming, ...breeding, ...closed, ...younger];
}

async function setup() {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  const bindings = { DB: db, SESSION_SIGNING_KEY: 'test-signing-key' } satisfies Bindings;
  const get = await guestFetch(bindings);
  return { db, get };
}

describe('Dashboard assembly (T-010, BR-3)', () => {
  it('uses the shared calendar-month rule and matches the imported-set acceptance names', () => {
    const result = buildDashboardLists({
      lines: makeLinesForAcceptance(),
      protocols: [],
      cryoRecords: [],
      thresholdMonths: 11,
      today: '2026-09-25',
    });
    expect(result.upcoming.map((line) => line.name).sort()).toEqual(
      ['demo_c3', 'demo_006', 'demo_008', 'demo_010', 'demo_b2', 'demo_027'].sort(),
    );
    expect(result.currentlyBreeding.map((line) => line.name).sort()).toEqual(
      ['demo_002', 'demo_036', 'demo_009'].sort(),
    );
    expect(result.counters).toEqual({ active: 23, closed: 19, cryopreserved: 0 });
  });

  it('sorts oldest first, excludes Closed and Breeding from upcoming, and warns on missing DOB', () => {
    const lines = [
      makeLine({ id: 'newest', name: 'newest', dob: '2025-10-25' }),
      makeLine({ id: 'oldest', name: 'oldest', dob: '2024-01-01' }),
      makeLine({ id: 'breeding', name: 'breeding', status: 'Breeding', dob: '2024-01-01' }),
      makeLine({ id: 'closed', name: 'closed', status: 'Closed', dob: '2024-01-01' }),
      makeLine({ id: 'missing-current', name: 'missing-current', dob: null }),
      makeLine({ id: 'missing-breeding', name: 'missing-breeding', status: 'Breeding', dob: null }),
    ];
    const result = buildDashboardLists({
      lines,
      protocols: [],
      cryoRecords: [],
      thresholdMonths: 11,
      today: '2026-09-25',
    });
    expect(result.upcoming.map((line) => line.name)).toEqual(['oldest', 'newest']);
    expect(result.missingDob.map((line) => line.name)).toEqual([
      'missing-breeding',
      'missing-current',
    ]);
    expect(result.currentlyBreeding.map((line) => line.name)).toEqual([
      'breeding',
      'missing-breeding',
    ]);
  });

  it('uses the current protocol label, counts distinct cryopreserved lines, and clamps future start dates', () => {
    const result = buildDashboardLists({
      lines: [
        makeLine({
          id: 'current',
          name: 'current',
          dob: '2024-01-01',
          current_protocol_id: 'protocol-current',
        }),
        makeLine({
          id: 'breeding',
          name: 'breeding',
          status: 'Breeding',
          breeding_started_at: '2026-09-26',
        }),
      ],
      protocols: [
        {
          id: 'protocol-current',
          line_id: 'current',
          protocol_type: 'pcr',
          label: 'PCR insertion check',
          fields: '{}',
          notes: null,
          sort_order: 0,
          is_current: 1,
          deleted_at: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      cryoRecords: [
        makeCryoRecord({ id: 'cryo-a', line_id: 'current' }),
        makeCryoRecord({ id: 'cryo-b', line_id: 'current' }),
      ],
      thresholdMonths: 11,
      today: '2026-09-25',
    });
    expect(result.upcoming[0]?.idMethod).toBe('PCR insertion check');
    expect(result.counters.cryopreserved).toBe(1);
    expect(result.currentlyBreeding[0]?.days).toBe(0);
  });
});

describe('Dashboard API (T-010, FR-DASH-02…05)', () => {
  it('returns counters, lists, threshold, and the first activity page in one response', async () => {
    const { db, get } = await setup();
    const response = await get('/api/dashboard');
    expect(response.status).toBe(200);
    const body = await response.json<{
      thresholdMonths: number;
      counters: {
        active: number;
        closed: number;
        cryopreserved: number;
        unreadMessages: number;
        openRequests: number;
      };
      upcoming: { name: string }[];
      currentlyBreeding: unknown[];
      recentActivity: { items: { lineName: string | null; userName: string }[] };
    }>();
    expect(body.thresholdMonths).toBe(11);
    expect(body.counters).toMatchObject({
      active: 4,
      closed: 1,
      cryopreserved: 3,
      unreadMessages: 0,
      openRequests: 0,
    });
    expect(body.upcoming.map((line) => line.name)).toContain('demo_c3');
    expect(body.currentlyBreeding).toEqual([]);
    const fixtureAuthor = await db
      .prepare(
        `SELECT name FROM users WHERE is_active = 1 AND is_builtin = 0
         AND role IN ('admin', 'member')
         ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at, id LIMIT 1`,
      )
      .first<{ name: string }>();
    expect(body.recentActivity.items[0]).toMatchObject({
      lineName: 'demo_a1',
      userName: fixtureAuthor?.name,
    });
  });

  it('returns open request summaries with direct line or lab context', async () => {
    const { db, get } = await setup();
    await insertRaw(
      db,
      'chat_messages',
      makeChatMessage({
        id: 'open-line-request',
        line_id: 'fx-demo_c3',
        user_id: USER_ID.bob,
        body: 'Please set up an out-cross.',
        request_type: 'Set up cross',
        request_status: 'open',
      }),
    );
    await insertRaw(
      db,
      'chat_messages',
      makeChatMessage({
        id: 'open-lab-request',
        line_id: null,
        user_id: USER_ID.guest,
        body: 'Please review the schedule.',
        request_type: 'Other',
        request_status: 'open',
      }),
    );
    await insertRaw(
      db,
      'chat_messages',
      makeChatMessage({
        id: 'done-line-request',
        line_id: 'fx-demo_c3',
        request_type: 'Genotyping',
        request_status: 'done',
      }),
    );
    const body = await (
      await get('/api/dashboard')
    ).json<{
      counters: { openRequests: number };
      openRequests: {
        id: string;
        lineId: string | null;
        lineName: string | null;
        body: string;
        requestType: string;
        authorName: string;
      }[];
    }>();
    expect(body.counters.openRequests).toBe(2);
    expect(body.openRequests).toHaveLength(2);
    expect(body.openRequests).toContainEqual(
      expect.objectContaining({
        id: 'open-line-request',
        lineId: 'fx-demo_c3',
        lineName: 'demo_c3',
        body: 'Please set up an out-cross.',
        requestType: 'Set up cross',
        authorName: 'Bob',
      }),
    );
    expect(body.openRequests).toContainEqual(
      expect.objectContaining({
        id: 'open-lab-request',
        lineId: null,
        lineName: null,
        requestType: 'Other',
      }),
    );
  });

  it('limits the dashboard activity preview to 10 and provides a cursor for expansion', async () => {
    const { db, get } = await setup();
    for (let index = 0; index < 15; index += 1) {
      await insertRaw(
        db,
        'activities',
        makeActivity({
          id: `preview-${String(index).padStart(2, '0')}`,
          line_id: 'fx-demo_c3',
          created_at: '2026-09-29T12:00:00Z',
        }),
      );
    }
    const preview = await (
      await get('/api/dashboard')
    ).json<{
      recentActivity: { items: { id: string }[]; nextBefore: string | null };
    }>();
    expect(preview.recentActivity.items).toHaveLength(10);
    expect(preview.recentActivity.nextBefore).not.toBeNull();
  });

  it('keeps chat, request and settings events out of Recent Activity but lists line changes', async () => {
    const { db, get } = await setup();
    const rows: [string, string][] = [
      ['chat', 'chat_posted'],
      ['request', 'request_opened'],
      ['settings', 'settings_changed'],
      ['breeding', 'breeding_started'],
      ['genotyping', 'genotyping_new_gen'],
      ['closed', 'closed'],
    ];
    for (const [id, type] of rows)
      await insertRaw(
        db,
        'activities',
        makeActivity({
          id: `filter-${id}`,
          type: type as never,
          line_id: 'fx-demo_c3',
          created_at: '2026-09-29T12:00:00Z',
        }),
      );
    const page = await (
      await get('/api/dashboard')
    ).json<{ recentActivity: { items: { id: string }[] } }>();
    const ids = page.recentActivity.items
      .map((item) => item.id)
      .filter((id) => id.startsWith('filter-'));
    expect(ids.sort()).toEqual(['filter-breeding', 'filter-closed', 'filter-genotyping']);
    const more = await (await get('/api/activities?limit=100')).json<{ items: { id: string }[] }>();
    expect(more.items.some((item) => item.id === 'filter-chat')).toBe(false);
  });

  it('counts unread messages per acting user and ignores already-read, own, and removed messages', async () => {
    const { db, get } = await setup();
    await insertRaw(
      db,
      'chat_messages',
      makeChatMessage({ id: 'unread-1', line_id: 'fx-demo_c3', user_id: USER_ID.bob }),
    );
    await insertRaw(db, 'chat_mentions', {
      id: 'mention-unread-1',
      message_id: 'unread-1',
      user_id: USER_ID.guest,
      created_at: '2026-09-29T00:00:00Z',
      deleted_at: null,
    });
    await insertRaw(
      db,
      'chat_messages',
      makeChatMessage({ id: 'read-1', line_id: 'fx-demo_c3', user_id: USER_ID.bob }),
    );
    await insertRaw(db, 'chat_mentions', {
      id: 'mention-read-1',
      message_id: 'read-1',
      user_id: USER_ID.guest,
      created_at: '2026-09-29T00:00:00Z',
      deleted_at: null,
    });
    await insertRaw(
      db,
      'chat_messages',
      makeChatMessage({ id: 'own-1', line_id: 'fx-demo_c3', user_id: USER_ID.guest }),
    );
    await insertRaw(
      db,
      'chat_messages',
      makeChatMessage({
        id: 'deleted-1',
        line_id: 'fx-demo_c3',
        user_id: USER_ID.bob,
        deleted_at: '2026-09-29T00:00:00Z',
      }),
    );
    await markMessageRead(db, 'read-1', USER_ID.guest, '2026-09-29T00:00:00Z');
    const body = await (
      await get('/api/dashboard')
    ).json<{
      counters: { unreadMessages: number };
      unreadMessages: {
        id: string;
        lineName: string | null;
        body: string;
        authorName: string;
      }[];
    }>();
    expect(body.counters.unreadMessages).toBe(1);
    expect(body.unreadMessages).toEqual([
      expect.objectContaining({
        id: 'unread-1',
        lineName: 'demo_c3',
        body: 'Please set up an out-cross of demo_c3',
        authorName: 'Bob',
      }),
    ]);
  });

  it('paginates by created_at and id without skipping same-time rows', async () => {
    const { db, get } = await setup();
    for (let index = 0; index < 25; index += 1) {
      await insertRaw(
        db,
        'activities',
        makeActivity({
          id: `cursor-${String(index).padStart(2, '0')}`,
          line_id: 'fx-demo_c3',
          created_at: '2026-09-29T12:00:00Z',
        }),
      );
    }
    const first = await (
      await get('/api/activities')
    ).json<{
      items: { id: string }[];
      nextBefore: string | null;
    }>();
    expect(first.items).toHaveLength(20);
    expect(first.nextBefore).not.toBeNull();
    const query = new URLSearchParams({ before: first.nextBefore ?? '' }).toString();
    const second = await (
      await get(`/api/activities?${query}`)
    ).json<{
      items: { id: string }[];
      nextBefore: string | null;
    }>();
    expect(second.items).toHaveLength(10);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(30);
    expect(second.nextBefore).toBeNull();
  });

  it('rejects a malformed activity cursor', async () => {
    const { get } = await setup();
    const response = await get('/api/activities?before=bad');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('does not offer a next cursor when the result fits on exactly one page', async () => {
    const { db, get } = await setup();
    for (let index = 0; index < 15; index += 1) {
      await insertRaw(
        db,
        'activities',
        makeActivity({
          id: `exact-${String(index).padStart(2, '0')}`,
          line_id: 'fx-demo_c3',
          created_at: '2026-09-29T12:00:00Z',
        }),
      );
    }
    const page = await (
      await get('/api/activities?limit=20')
    ).json<{
      items: { id: string }[];
      nextBefore: string | null;
    }>();
    expect(page.items).toHaveLength(20);
    expect(page.nextBefore).toBeNull();
  });
});
