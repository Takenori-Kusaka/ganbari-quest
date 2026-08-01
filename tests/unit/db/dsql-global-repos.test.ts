// tests/unit/db/dsql-global-repos.test.ts
// EPIC #3424 / M4-E PR8c / 設計 SSOT: dsql-data-model.md §1.10 / §11.2 /
// billing-redesign/phase5-webhook-idempotency-architecture.md §3.4
//
// DSQL グローバル表 2 repo (tenant 非依存、自然キー PK) のテスト (実 schema pushSchema)。
// 設計判断の要点:
//   - **email_login_lockouts は専用表**: sqlite は settings 表に `lockout:` プレフィクス JSON で
//     間借りしていたが、DSQL は列展開した専用表 (schema §1.10)。email 小文字正規化の挙動
//     (sqlite の lockoutSettingKey / value 双方 toLowerCase) を踏襲することを [AL2] で検証。
//   - **stripe_webhook_events の冪等性 (first-writer-wins)**: PK (event_id) への
//     ON CONFLICT DO NOTHING で二重 insert を物理拒否 (interface SSOT「INSERT OR IGNORE」契約、
//     二重課金防止)。sqlite backend は未実装 (Phase 7 PR-4a で同時実装予定) のため、
//     interface SSOT + in-memory demo backend を挙動の正とする。
//
// ── Canon TDD test list ──
// ── IAccountLockoutRepo ──
//   [AL1] getLockout null → upsert insert round-trip (timestamptz 秒精度) → upsert 上書き (1 行維持)
//   [AL2] email 大文字小文字正規化 (書込/読出両方で lowercase、1 行に収束)
// ── IWebhookEventRepo ──
//   [WE1] insert + findByEventId round-trip (shape / processedAt verbatim / tenantId null 許容)
//   [WE2] 冪等性: 同一 event_id 二重 insert は throw せず初回値が残る (first-writer-wins)
//   [WE3] incrementRetryCount (+1、未知 event_id は no-op)
//   [WE4] deleteOlderThan (strict less than 境界 + 削除行数)

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDsqlAccountLockoutRepo } from '../../../src/lib/server/db/dsql/account-lockout-repo';
import { createDsqlWebhookEventRepo } from '../../../src/lib/server/db/dsql/webhook-event-repo';
import type { IAccountLockoutRepo } from '../../../src/lib/server/db/interfaces/account-lockout-repo.interface';
import type {
	IWebhookEventRepo,
	WebhookEventRecord,
} from '../../../src/lib/server/db/interfaces/webhook-event-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const makeEvent = (over: Partial<WebhookEventRecord> = {}): WebhookEventRecord => ({
	eventId: 'evt_default',
	eventType: 'checkout.session.completed',
	processedAt: '2026-07-01T10:00:00.000Z',
	handlerResult: 'processing',
	errorMessage: null,
	retryCount: 0,
	tenantId: null,
	...over,
});

describe('DSQL グローバル repos (M4-E PR8c、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let lockoutRepo: IAccountLockoutRepo;
	let webhookRepo: IWebhookEventRepo;

	const countRows = async (query: ReturnType<typeof sql>): Promise<number> => {
		const r = await t.db.execute(query);
		return Number((r.rows[0] as { c: unknown }).c);
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		lockoutRepo = createDsqlAccountLockoutRepo(t.db);
		webhookRepo = createDsqlWebhookEventRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── IAccountLockoutRepo ───────────────────

	it('[AL1] getLockout null → upsert insert round-trip → upsert 上書き (1 行維持)', async () => {
		expect(await lockoutRepo.getLockout('nobody@example.com')).toBe(null);

		const lockedUntil = '2026-07-08T12:34:56.000Z';
		const lastFailedAt = '2026-07-08T12:30:00.000Z';
		await lockoutRepo.upsertLockout({
			email: 'parent@example.com',
			failedCount: 3,
			lockedUntil,
			lastFailedAt,
		});
		const rec = await lockoutRepo.getLockout('parent@example.com');
		expect(rec?.email).toBe('parent@example.com');
		expect(rec?.failedCount).toBe(3);
		expect(Date.parse(rec?.lockedUntil ?? '')).toBe(Date.parse(lockedUntil)); // timestamptz 往復
		expect(Date.parse(rec?.lastFailedAt ?? '')).toBe(Date.parse(lastFailedAt));

		// upsert 上書き (PK ON CONFLICT DO UPDATE、行は 1 本のまま)
		await lockoutRepo.upsertLockout({
			email: 'parent@example.com',
			failedCount: 0,
			lockedUntil: null,
			lastFailedAt: null,
		});
		const cleared = await lockoutRepo.getLockout('parent@example.com');
		expect(cleared?.failedCount).toBe(0);
		expect(cleared?.lockedUntil).toBe(null);
		expect(cleared?.lastFailedAt).toBe(null);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM email_login_lockouts WHERE email = 'parent@example.com'`,
			),
		).toBe(1);
	});

	it('[AL2] email 大文字小文字正規化: 書込/読出両方で lowercase、1 行に収束', async () => {
		await lockoutRepo.upsertLockout({
			email: 'Mixed.Case@Example.COM',
			failedCount: 1,
			lockedUntil: null,
			lastFailedAt: '2026-07-08T00:00:00.000Z',
		});
		// 別 casing で読んでも同一レコード (sqlite の lockoutSettingKey 正規化と同挙動)
		const rec = await lockoutRepo.getLockout('mixed.case@example.com');
		expect(rec?.failedCount).toBe(1);
		expect(rec?.email).toBe('mixed.case@example.com'); // 格納値も lowercase

		// 別 casing の upsert も同一行を更新する (2 行に割れない)
		await lockoutRepo.upsertLockout({
			email: 'MIXED.CASE@example.com',
			failedCount: 2,
			lockedUntil: null,
			lastFailedAt: null,
		});
		expect((await lockoutRepo.getLockout('Mixed.Case@Example.COM'))?.failedCount).toBe(2);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM email_login_lockouts WHERE email ILIKE 'mixed.case@example.com'`,
			),
		).toBe(1);
	});

	// ─────────────────── IWebhookEventRepo ───────────────────

	/** stale 判定を確実に外す (= 死んだ claim を奪わせない) 基準時刻 */
	const NEVER_STALE = '2000-01-01T00:00:00.000Z';

	/** 「掴んで完了させた」状態を作る。 */
	const seedCompleted = async (over: Partial<WebhookEventRecord> = {}): Promise<void> => {
		const record = makeEvent(over);
		await webhookRepo.claim(record, NEVER_STALE);
		await webhookRepo.finalize(record.eventId, 'success', record.processedAt);
	};

	it('[WE1] claim + findByEventId round-trip (processedAt verbatim / tenantId null 許容)', async () => {
		expect(await webhookRepo.findByEventId('evt_missing')).toBe(null);

		expect(
			await webhookRepo.claim(
				makeEvent({
					eventId: 'evt_001',
					eventType: 'invoice.paid',
					errorMessage: 'stripe api down',
					retryCount: 2,
					tenantId: 'tenant-xyz',
				}),
				NEVER_STALE,
			),
		).toBe(true);
		const rec = await webhookRepo.findByEventId('evt_001');
		expect(rec?.eventId).toBe('evt_001');
		expect(rec?.eventType).toBe('invoice.paid');
		expect(rec?.handlerResult).toBe('processing');
		expect(rec?.errorMessage).toBe('stripe api down');
		expect(rec?.retryCount).toBe(2);
		expect(rec?.tenantId).toBe('tenant-xyz');
		expect(Date.parse(rec?.processedAt ?? '')).toBe(Date.parse('2026-07-01T10:00:00.000Z'));

		// tenantId null (handler が tenant を解決できなかった event) も許容
		await webhookRepo.claim(makeEvent({ eventId: 'evt_002' }), NEVER_STALE);
		expect((await webhookRepo.findByEventId('evt_002'))?.tenantId).toBe(null);
	});

	it('[WE2] 冪等性: 完了済 event_id は処理権を取れず初回値が残る (first-writer-wins)', async () => {
		await seedCompleted({ eventId: 'evt_dup' });

		// replay / 並列同時到達を模した 2 度目 — 完了済なので奪えない
		expect(
			await webhookRepo.claim(
				makeEvent({ eventId: 'evt_dup', errorMessage: '後着' }),
				'2030-01-01T00:00:00.000Z',
			),
		).toBe(false);

		const rec = await webhookRepo.findByEventId('evt_dup');
		expect(rec?.handlerResult).toBe('success'); // 初回の handler 結果が正 (二重課金防止)
		expect(rec?.errorMessage).toBe(null);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM stripe_webhook_events WHERE event_id = 'evt_dup'`,
			),
		).toBe(1);
	});

	it('[WE2b] processing のまま古くなった claim だけを奪える (実 SQL の ON CONFLICT ... WHERE 検証)', async () => {
		await webhookRepo.claim(
			makeEvent({ eventId: 'evt_stale', processedAt: '2026-07-01T10:00:00.000Z' }),
			NEVER_STALE,
		);

		// まだ新しい (実行中かもしれない) claim は奪わない
		expect(
			await webhookRepo.claim(
				makeEvent({ eventId: 'evt_stale', processedAt: '2026-07-01T10:05:00.000Z' }),
				'2026-07-01T09:50:00.000Z',
			),
		).toBe(false);

		// 十分古くなった claim は引き取れる (Lambda が処理中に死んだケース)
		expect(
			await webhookRepo.claim(
				makeEvent({ eventId: 'evt_stale', processedAt: '2026-07-01T11:00:00.000Z' }),
				'2026-07-01T10:30:00.000Z',
			),
		).toBe(true);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM stripe_webhook_events WHERE event_id = 'evt_stale'`,
			),
		).toBe(1);
	});

	it('[WE2c] finalize / releaseClaim (完了済は releaseClaim で消えない)', async () => {
		await webhookRepo.claim(makeEvent({ eventId: 'evt_fin' }), NEVER_STALE);
		await webhookRepo.finalize('evt_fin', 'skipped', '2026-07-01T10:00:30.000Z');
		expect((await webhookRepo.findByEventId('evt_fin'))?.handlerResult).toBe('skipped');

		await webhookRepo.releaseClaim('evt_fin');
		expect(await webhookRepo.findByEventId('evt_fin')).not.toBe(null);

		await webhookRepo.claim(makeEvent({ eventId: 'evt_rel' }), NEVER_STALE);
		await webhookRepo.releaseClaim('evt_rel');
		expect(await webhookRepo.findByEventId('evt_rel')).toBe(null);
	});

	it('[WE3] incrementRetryCount: +1 (未知 event_id は no-op)', async () => {
		await seedCompleted({ eventId: 'evt_retry' });
		await webhookRepo.incrementRetryCount('evt_retry');
		await webhookRepo.incrementRetryCount('evt_retry');
		expect((await webhookRepo.findByEventId('evt_retry'))?.retryCount).toBe(2);
		// 未知 event_id は no-op (throw しない)
		await expect(webhookRepo.incrementRetryCount('evt_unknown')).resolves.toBe(undefined);
	});

	it('[WE4] deleteOlderThan: strict less than 境界 + 削除行数', async () => {
		await seedCompleted({ eventId: 'evt_old_1', processedAt: '2026-05-01T00:00:00.000Z' });
		await seedCompleted({ eventId: 'evt_old_2', processedAt: '2026-05-15T00:00:00.000Z' });
		await seedCompleted({ eventId: 'evt_boundary', processedAt: '2026-06-01T00:00:00.000Z' });
		// cutoff ちょうどの行は残る (processed_at < cutoff の strict less than)
		const deleted = await webhookRepo.deleteOlderThan('2026-06-01T00:00:00.000Z');
		expect(deleted).toBe(2);
		expect(await webhookRepo.findByEventId('evt_old_1')).toBe(null);
		expect(await webhookRepo.findByEventId('evt_old_2')).toBe(null);
		expect(await webhookRepo.findByEventId('evt_boundary')).not.toBe(null);
	});
});
