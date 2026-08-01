// tests/unit/db/sqlite/webhook-event-repo.test.ts
//
// #3985: sqlite backend の IWebhookEventRepo 実装。
//
// `stripe_webhook_events` は schema / create-tables / lazy-migration / e2e global-setup に
// 配備済みだったが、**sqlite backend の repo 実装だけが欠落**していた (dsql / demo のみ存在)。
// factory から dedup 台帳を注入するにあたり、demo (in-memory) / dsql と同一契約で振る舞うことを
// backend ごとに固定する (interface SSOT:
// src/lib/server/db/interfaces/webhook-event-repo.interface.ts)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, createTestDb, resetDb, type TestSqlite } from '../../helpers/test-db';

const dbHolder: { sqlite: TestSqlite | null; db: ReturnType<typeof createTestDb>['db'] | null } = {
	sqlite: null,
	db: null,
};

vi.mock('$lib/server/db/client', () => ({
	get db() {
		if (!dbHolder.db) throw new Error('test db not initialized');
		return dbHolder.db;
	},
}));

// import after mock
import type { WebhookEventRecord } from '$lib/server/db/interfaces/webhook-event-repo.interface';
import {
	claim,
	deleteOlderThan,
	finalize,
	findByEventId,
	incrementRetryCount,
	releaseClaim,
} from '$lib/server/db/sqlite/webhook-event-repo';

/** stale 判定を確実に外す (= 死んだ claim を奪わせない) 基準時刻 */
const NEVER_STALE = '2000-01-01T00:00:00.000Z';

function makeRecord(overrides: Partial<WebhookEventRecord> = {}): WebhookEventRecord {
	return {
		eventId: 'evt_1ABCxyz',
		eventType: 'checkout.session.completed',
		processedAt: '2026-05-30T12:00:00.000Z',
		handlerResult: 'processing',
		errorMessage: null,
		retryCount: 0,
		tenantId: null,
		...overrides,
	};
}

beforeEach(() => {
	if (!dbHolder.sqlite) {
		const created = createTestDb();
		dbHolder.sqlite = created.sqlite;
		dbHolder.db = created.db;
	} else {
		resetDb(dbHolder.sqlite);
	}
});

/** 「掴んで完了させた」状態を作る。 */
async function seedCompleted(overrides: Partial<WebhookEventRecord> = {}): Promise<void> {
	const record = makeRecord(overrides);
	await claim(record, NEVER_STALE);
	await finalize(record.eventId, 'success', record.processedAt);
}

describe('sqlite webhookEventRepo (#3985 / #4128 insert-first)', () => {
	it('未処理の event.id には null を返す (dedup primary check)', async () => {
		expect(await findByEventId('evt_unknown')).toBeNull();
	});

	it('claim した record を全列そのまま読み戻せる', async () => {
		const record = makeRecord({ tenantId: 't-test', eventType: 'invoice.paid' });
		expect(await claim(record, NEVER_STALE)).toBe(true);
		expect(await findByEventId(record.eventId)).toEqual(record);
	});

	it('同一 event.id の 2 度目は処理権を取れない (並列到達で handler を二重実行させない)', async () => {
		await claim(makeRecord(), NEVER_STALE);

		expect(await claim(makeRecord({ eventType: 'invoice.paid' }), NEVER_STALE)).toBe(false);
		// 後着が上書きしない = 初回の処理が正
		expect(await findByEventId('evt_1ABCxyz')).toMatchObject({
			eventType: 'checkout.session.completed',
		});
	});

	it('完了済 row は「十分古い」基準を渡しても奪えない (冪等性を壊さない)', async () => {
		await seedCompleted({ processedAt: '2020-01-01T00:00:00.000Z' });

		expect(await claim(makeRecord(), '2030-01-01T00:00:00.000Z')).toBe(false);
		expect((await findByEventId('evt_1ABCxyz'))?.handlerResult).toBe('success');
	});

	it('processing のまま古くなった claim は奪える (処理中に死んだ Lambda の引き取り)', async () => {
		await claim(makeRecord({ processedAt: '2026-05-30T12:00:00.000Z' }), NEVER_STALE);

		expect(
			await claim(
				makeRecord({ processedAt: '2026-05-30T13:00:00.000Z' }),
				'2026-05-30T12:30:00.000Z',
			),
		).toBe(true);
	});

	it('processing でもまだ新しい claim は奪えない (実行中の処理を横取りしない)', async () => {
		await claim(makeRecord({ processedAt: '2026-05-30T12:00:00.000Z' }), NEVER_STALE);

		expect(
			await claim(
				makeRecord({ processedAt: '2026-05-30T12:05:00.000Z' }),
				'2026-05-30T11:50:00.000Z',
			),
		).toBe(false);
	});

	it('finalize が handlerResult / processedAt を確定する', async () => {
		await claim(makeRecord(), NEVER_STALE);
		await finalize('evt_1ABCxyz', 'skipped', '2026-05-30T12:00:05.000Z');

		expect(await findByEventId('evt_1ABCxyz')).toMatchObject({
			handlerResult: 'skipped',
			processedAt: '2026-05-30T12:00:05.000Z',
		});
	});

	it('releaseClaim が processing の row を消す / 完了済 row は消さない', async () => {
		await claim(makeRecord(), NEVER_STALE);
		await releaseClaim('evt_1ABCxyz');
		expect(await findByEventId('evt_1ABCxyz')).toBeNull();

		await seedCompleted();
		await releaseClaim('evt_1ABCxyz');
		expect(await findByEventId('evt_1ABCxyz')).not.toBeNull();
	});

	it('incrementRetryCount が既存 row の retryCount を +1 する', async () => {
		await seedCompleted();
		await incrementRetryCount('evt_1ABCxyz');
		expect((await findByEventId('evt_1ABCxyz'))?.retryCount).toBe(1);
		await incrementRetryCount('evt_1ABCxyz');
		expect((await findByEventId('evt_1ABCxyz'))?.retryCount).toBe(2);
	});

	it('incrementRetryCount は未存在 event.id で throw しない (silent no-op)', async () => {
		await expect(incrementRetryCount('evt_missing')).resolves.toBeUndefined();
	});

	it('deleteOlderThan が cutoff より古い row のみ削除し件数を返す (30 日 retention)', async () => {
		await seedCompleted({ eventId: 'evt_old', processedAt: '2026-04-01T00:00:00.000Z' });
		await seedCompleted({ eventId: 'evt_new', processedAt: '2026-05-30T00:00:00.000Z' });

		expect(await deleteOlderThan('2026-05-01T00:00:00.000Z')).toBe(1);
		expect(await findByEventId('evt_old')).toBeNull();
		expect(await findByEventId('evt_new')).not.toBeNull();
	});

	it('deleteOlderThan は削除対象なしなら 0 を返す', async () => {
		await seedCompleted({ processedAt: '2026-05-30T00:00:00.000Z' });
		expect(await deleteOlderThan('2026-01-01T00:00:00.000Z')).toBe(0);
	});
});

// vitest の worker 終了時に sqlite handle を閉じる
process.on('exit', () => {
	if (dbHolder.sqlite) closeDb(dbHolder.sqlite);
});
