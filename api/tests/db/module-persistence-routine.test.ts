import { describe, expect, test } from 'vitest'
import {
  canonicalizePersistenceRoutineSql,
  type CanonicalPersistenceRoutine,
} from '../../src/db/module-persistence-routine.js'

describe('module persistence routine canonicalization', () => {
  test('normalizes formatting and source locations into one semantic fingerprint', async () => {
    const compact = await canonicalize(readRoutineSql("input ->> 'value'"))
    const formatted = await canonicalize(readRoutineSql("input\n      ->> 'value'"))
    const explicitInputMode = await canonicalize(
      readRoutineSql("input ->> 'value'").replace('(input jsonb)', '(in input jsonb)'),
    )

    expect(formatted).toEqual(compact)
    expect(explicitInputMode).toEqual(compact)
    expect(compact.identity).toEqual({
      moduleId: 'alpha',
      operationId: 'read-snapshot',
      revision: 1,
      mode: 'read',
      schemaName: 'eve_module_alpha',
      routineName: 'persist_read_snapshot',
    })
    expect(compact.definitionFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(compact.canonicalDefinition).not.toContain('location')
  })

  test('includes revision, mode-relevant attributes, and structured body changes', async () => {
    const baseline = await canonicalize(readRoutineSql("input ->> 'value'"))
    const changedBody = await canonicalize(readRoutineSql("input ->> 'other'"))
    const changedRevision = await canonicalize(readRoutineSql("input ->> 'value'"), 2)
    const changedVolatility = await canonicalize(
      readRoutineSql("input ->> 'value'").replace('stable', 'volatile'),
    )

    expect(
      uniqueFingerprints([baseline, changedBody, changedRevision, changedVolatility]).size,
    ).toBe(4)
  })

  test('normalizes PostgreSQL omitted routine option defaults', async () => {
    const explicit = await canonicalizePersistenceRoutineSql({
      moduleId: 'alpha',
      operationId: 'read-snapshot',
      revision: 1,
      mode: 'write',
      sql: readRoutineSql('input').replace('stable', 'volatile'),
    })
    const omitted = await canonicalizePersistenceRoutineSql({
      moduleId: 'alpha',
      operationId: 'read-snapshot',
      revision: 1,
      mode: 'write',
      sql: readRoutineSql('input').replace('stable', '').replace('parallel unsafe', ''),
    })

    expect(omitted).toEqual(explicit)
  })

  test('normalizes PostgreSQL parameter qualification and implicit target aliases', async () => {
    const source = await canonicalizeWriteRoutine(`
      begin atomic
        insert into routine_records (value) select (input ->> 'value'::text)::bigint;
        select coalesce(
          jsonb_build_object(
            'unexpected'::text,
            true,
            'at'::text,
            '2026-09-07T10:00:00Z'::timestamptz
          ),
          '{}'::jsonb
        );
      end
    `)
    const deparsed = await canonicalizeWriteRoutine(`
      begin atomic
        insert into routine_records (value)
          select (persist_write_record.input ->> 'value'::text)::bigint as int8;
        select coalesce(
          jsonb_build_object(
            'unexpected'::text,
            true,
            'at'::text,
            '2026-09-07T10:00:00Z'::timestamp with time zone
          ),
          '{}'::jsonb
        ) as coalesce;
      end
    `)

    expect(deparsed.definitionFingerprint).toBe(source.definitionFingerprint)
  })

  test('normalizes owning-schema relation qualification added by PostgreSQL', async () => {
    const unqualified = await canonicalizeWriteRoutine(`
      begin atomic
        insert into routine_records (value) values ('kept');
        select '{}'::jsonb;
      end
    `)
    const qualified = await canonicalizeWriteRoutine(`
      begin atomic
        insert into eve_module_alpha.routine_records (value) values ('kept');
        select '{}'::jsonb;
      end
    `)

    expect(qualified.definitionFingerprint).toBe(unqualified.definitionFingerprint)
  })

  test('requires exactly one canonical routine identity', async () => {
    await expect(
      canonicalizePersistenceRoutineSql({
        moduleId: 'alpha',
        operationId: 'read-snapshot',
        revision: 1,
        mode: 'read',
        sql: readRoutineSql("input ->> 'value'").replace('persist_read_snapshot', 'other_routine'),
      }),
    ).rejects.toThrow('Persistence routine definition mismatch: alpha/read-snapshot')
  })
})

function canonicalize(sql: string, revision = 1) {
  return canonicalizePersistenceRoutineSql({
    moduleId: 'alpha',
    operationId: 'read-snapshot',
    revision,
    mode: 'read',
    sql,
  })
}

function readRoutineSql(expression: string) {
  return `
    create function eve_module_alpha.persist_read_snapshot(input jsonb)
    returns jsonb
    language sql
    stable
    parallel unsafe
    return jsonb_build_object('value', ${expression})
  `
}

function canonicalizeWriteRoutine(body: string) {
  return canonicalizePersistenceRoutineSql({
    moduleId: 'alpha',
    operationId: 'write-record',
    revision: 1,
    mode: 'write',
    sql: `
      create function eve_module_alpha.persist_write_record(input jsonb)
      returns jsonb
      language sql
      volatile
      parallel unsafe
      ${body}
    `,
  })
}

function uniqueFingerprints(routines: readonly CanonicalPersistenceRoutine[]) {
  return new Set(routines.map(({ definitionFingerprint }) => definitionFingerprint))
}
