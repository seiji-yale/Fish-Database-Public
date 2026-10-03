import { describe, expect, it } from 'vitest';
import { buildSnapshot, diffSnapshots, summarize } from './versioning';

describe('summarize with a written sentence (T-016)', () => {
  it("uses the caller's text for changes the diff cannot describe, but never for created/imported", () => {
    const text = 'Uploaded gel image for PCR.';
    expect(summarize('protocol_changed', [], { text })).toBe(text);
    expect(summarize('reference_changed', [], { text })).toBe(text);
    expect(summarize('created', [], { text })).toBe('Line created.');
    expect(summarize('imported', [], { text })).toBe('Line imported.');
  });
});

describe('summarize cryo_changed (T-015)', () => {
  it('names what happened to which record', () => {
    const line = (cryoAction: 'added' | 'updated' | 'removed' | 'used' | 'use_undone') =>
      summarize('cryo_changed', [], {
        cryoAction,
        cryoLabel: 'C0637–C0644 (8) at Demo freezer shelf',
      });
    expect([
      line('added'),
      line('updated'),
      line('removed'),
      line('used'),
      line('use_undone'),
      summarize('cryo_changed', []),
    ]).toEqual([
      'Added cryo record C0637–C0644 (8) at Demo freezer shelf.',
      'Updated cryo record C0637–C0644 (8) at Demo freezer shelf.',
      'Removed cryo record C0637–C0644 (8) at Demo freezer shelf.',
      'Used cryo vials C0637–C0644 (8) at Demo freezer shelf.',
      'Undid a cryo vial use C0637–C0644 (8) at Demo freezer shelf.',
      'Cryopreservation information updated.',
    ]);
  });
});

describe('summarize protocol_changed (T-014)', () => {
  it('names what happened to which ID method', () => {
    const line = (protocolAction: Parameters<typeof summarize>[2] extends infer C ? C : never) =>
      summarize('protocol_changed', [], protocolAction);
    expect([
      line({ protocolAction: 'added', protocolLabel: 'PCR – wt' }),
      line({ protocolAction: 'updated', protocolLabel: 'PCR – wt' }),
      line({ protocolAction: 'removed', protocolLabel: 'PCR – wt' }),
      line({ protocolAction: 'restored', protocolLabel: 'PCR – wt' }),
      line({ protocolAction: 'marked_current', protocolLabel: 'PCR – wt' }),
      line({ protocolAction: 'unmarked_current', protocolLabel: 'PCR – wt' }),
      line({ protocolAction: 'reordered' }),
    ]).toEqual([
      'Added ID method: PCR – wt.',
      'Updated ID method: PCR – wt.',
      'Removed ID method: PCR – wt.',
      'Restored ID method: PCR – wt.',
      'Now a current ID method: PCR – wt.',
      'No longer a current ID method: PCR – wt.',
      'ID methods reordered.',
    ]);
  });
});

describe('version snapshots', () => {
  it('sorts keys and excludes update bookkeeping', () => {
    expect(
      buildSnapshot({
        z: 1,
        updatedAt: 'now',
        version: 2,
        nested: { updated_at: 'then', a: 1 },
        a: 2,
      }),
    ).toEqual({ a: 2, nested: { a: 1 }, z: 1 });
  });
  it('keeps array items stable while snapshotting', () => {
    expect(buildSnapshot({ values: [{ z: 1, a: 2 }, 'text'] })).toEqual({
      values: [{ a: 2, z: 1 }, 'text'],
    });
  });
  it('returns stable, leaf-level differences', () => {
    expect(
      diffSnapshots(
        { status: 'Current', nested: { a: 1 } },
        { status: 'Breeding', nested: { a: 2, b: true } },
      ),
    ).toEqual([
      { path: 'nested.a', before: 1, after: 2 },
      { path: 'nested.b', before: undefined, after: true },
      { path: 'status', before: 'Current', after: 'Breeding' },
    ]);
  });
  it('ignores updated_at and version differences', () => {
    expect(diffSnapshots({ updated_at: 'a', version: 1 }, { updated_at: 'b', version: 2 })).toEqual(
      [],
    );
  });
  it('uses canonical history wording for every change type', () => {
    const diff = [{ path: 'status', before: 'Current', after: 'Breeding' }];
    expect({
      created: summarize('created', diff),
      breeding: summarize('breeding_started', diff),
      same: summarize('genotyping_same_gen', diff, { positiveCount: 6, idedNumber: 12 }),
      next: summarize('genotyping_new_gen', diff, { positiveCount: 8, idedNumber: 8 }),
      closed: summarize('closed', diff),
      reopened: summarize('reopened', diff),
      protocol: summarize('protocol_changed', diff),
      cryo: summarize('cryo_changed', diff),
      reference: summarize('reference_changed', diff),
      restored: summarize('restored', diff),
      imported: summarize('imported', diff),
      edited: summarize('edited', diff),
      emptyEdited: summarize('edited', []),
    }).toMatchInlineSnapshot(`
      {
        "breeding": "Breeding started.",
        "closed": "Line closed.",
        "created": "Line created.",
        "cryo": "Cryopreservation information updated.",
        "edited": "Line details updated: status.",
        "emptyEdited": "Line details updated.",
        "imported": "Line imported.",
        "next": "Genotyping: +8 positive (total 8), new generation.",
        "protocol": "ID method updated.",
        "reference": "Reference updated.",
        "reopened": "Line reopened.",
        "restored": "Item restored.",
        "same": "Genotyping: +6 positive (total 12), same generation.",
      }
    `);
  });
  it('uses zero defaults for genotyping summaries and names two edited fields', () => {
    expect(summarize('genotyping_same_gen', [])).toBe(
      'Genotyping: +0 positive (total 0), same generation.',
    );
    expect(summarize('genotyping_new_gen', [])).toBe(
      'Genotyping: +0 positive (total 0), new generation.',
    );
    expect(
      summarize('edited', [
        { path: 'a_b', before: 1, after: 2 },
        { path: 'c', before: 1, after: 2 },
        { path: 'ignored', before: 1, after: 2 },
      ]),
    ).toBe('Line details updated: a b, c.');
  });
});

describe('summarize restored (T-012)', () => {
  it('names the version whose content was put back', () => {
    expect(summarize('restored', [], { restoredVersionNo: 3 })).toBe(
      'Restored the content of version 3.',
    );
  });
});
