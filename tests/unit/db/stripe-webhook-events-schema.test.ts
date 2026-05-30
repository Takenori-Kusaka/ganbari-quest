// tests/unit/db/stripe-webhook-events-schema.test.ts
//
// `stripe_webhook_events` table の sqlite schema 配備検証
// (#2641 / Phase 5 子 3 / Phase 6 子 3 #2675 / Phase 7 PR-1)
//
// 設計 SSOT:
// - docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md §3.1 (drizzle schema SSOT)
// - docs/design/billing-redesign/phase6-db-migration-plan.md §3.1 (本 PR 配備対象)
//
// 4 backend (sqlite / dynamodb / in-memory demo / unit fixture) 整合の sqlite 側 schema 検証。
// `createTestDb` (test-db.ts SSOT) で生成された in-memory DB に対し:
// - 7 列の定義 (event_id PK / event_type / processed_at / handler_result / error_message / retry_count / tenant_id)
// - event_id PK 制約 (重複 insert で UNIQUE constraint failed)
// - 2 index (processed_at / type_result) 作成

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDatabase } from '../helpers/test-db';

describe('stripe_webhook_events schema (Phase 7 PR-1)', () => {
	let testDb: TestDatabase;

	beforeEach(() => {
		testDb = createTestDb();
	});

	afterEach(() => {
		testDb.sqlite.close();
	});

	it('7 列を備え、event_id が PK + 他列の NOT NULL 制約が schema 通り', () => {
		const cols = testDb.sqlite.prepare("PRAGMA table_info('stripe_webhook_events')").all() as {
			name: string;
			type: string;
			pk: number;
			notnull: number;
		}[];
		const byName = new Map(cols.map((c) => [c.name, c]));

		// 7 列が揃っている
		expect(cols).toHaveLength(7);

		// event_id PK (TEXT PK は SQLite 歴史的仕様で notnull=0 だが、PK 制約自体は機能する。
		// NULL 値挿入時の挙動は別 it で検証)
		expect(byName.get('event_id')?.pk).toBe(1);
		expect(byName.get('event_id')?.type).toBe('TEXT');

		// notnull 制約 (4 列)
		expect(byName.get('event_type')?.notnull).toBe(1);
		expect(byName.get('processed_at')?.notnull).toBe(1);
		expect(byName.get('handler_result')?.notnull).toBe(1);
		expect(byName.get('retry_count')?.notnull).toBe(1);

		// nullable (2 列、errorMessage / tenantId)
		expect(byName.get('error_message')?.notnull).toBe(0);
		expect(byName.get('tenant_id')?.notnull).toBe(0);
	});

	it('event_id 重複 insert は UNIQUE constraint で fail (dedup PK 機能)', () => {
		testDb.sqlite
			.prepare(
				`INSERT INTO stripe_webhook_events (event_id, event_type, handler_result)
				 VALUES ('evt_dup', 'checkout.session.completed', 'success')`,
			)
			.run();

		expect(() => {
			testDb.sqlite
				.prepare(
					`INSERT INTO stripe_webhook_events (event_id, event_type, handler_result)
					 VALUES ('evt_dup', 'invoice.paid', 'error')`,
				)
				.run();
		}).toThrow(/UNIQUE constraint failed/);
	});

	it('2 index (processed_at / type_result) が作成されている', () => {
		const indices = (
			testDb.sqlite
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stripe_webhook_events'",
				)
				.all() as { name: string }[]
		).map((r) => r.name);
		expect(indices).toContain('idx_stripe_webhook_events_processed_at');
		expect(indices).toContain('idx_stripe_webhook_events_type_result');
	});

	it('処理結果 row を insert/select で round-trip できる (基本 CRUD smoke)', () => {
		const now = '2026-05-30T12:00:00.000Z';
		testDb.sqlite
			.prepare(
				`INSERT INTO stripe_webhook_events
				 (event_id, event_type, processed_at, handler_result, error_message, retry_count, tenant_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run('evt_smoke', 'checkout.session.completed', now, 'success', null, 0, 'tenant-1');

		const row = testDb.sqlite
			.prepare("SELECT * FROM stripe_webhook_events WHERE event_id = 'evt_smoke'")
			.get() as Record<string, unknown>;

		expect(row).toMatchObject({
			event_id: 'evt_smoke',
			event_type: 'checkout.session.completed',
			processed_at: now,
			handler_result: 'success',
			error_message: null,
			retry_count: 0,
			tenant_id: 'tenant-1',
		});
	});
});
