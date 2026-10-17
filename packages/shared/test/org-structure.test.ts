import { describe, expect, it } from 'vitest';
import { archiveStructureSchema, updateDepartmentSchema, updateLocationSchema } from '../src/index.ts';

const id = '7d1b2c3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('structure edit schemas', () => {
  it('require the row id', () => {
    expect(updateDepartmentSchema.safeParse({ code: 'ENG', name: 'Engineering' }).success).toBe(false);
    expect(updateDepartmentSchema.safeParse({ id: 'not-a-uuid', code: 'ENG', name: 'Engineering' }).success).toBe(false);
  });

  it('turn a cleared optional field into undefined, so the server can clear it', () => {
    const r = updateDepartmentSchema.parse({ id, code: ' eng ', name: 'Engineering', parentId: '' });
    expect(r).toEqual({ id, code: 'ENG', name: 'Engineering', parentId: undefined });
    expect(updateLocationSchema.parse({ id, code: 'BLR', name: 'Bengaluru', city: '', stateCode: 'ka' }))
      .toEqual({ id, code: 'BLR', name: 'Bengaluru', city: undefined, stateCode: 'KA' });
  });
});

describe('archiveStructureSchema', () => {
  it('accepts known kinds and parses the flag', () => {
    expect(archiveStructureSchema.parse({ kind: 'location', id, archive: 'false' })).toEqual({ kind: 'location', id, archive: false });
    expect(archiveStructureSchema.safeParse({ kind: 'legal_entity', id, archive: 'true' }).success).toBe(false);
  });
});
