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
	deleteOlderThan,
	findByEventId,
	incrementRetryCount,
	insert,
} from '$lib/server/db/sqlite/webhook-event-repo';

function makeRecord(overrides: Partial<WebhookEventRecord> = {}): WebhookEventRecord {
	return {
		eventId: 'evt_1ABCxyz',
		eventType: 'checkout.session.completed',
		processedAt: '2026-05-30T12:00:00.000Z',
		handlerResult: 'success',
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

describe('sqlite webhookEventRepo (#3985)', () => {
	it('未処理の event.id には null を返す (dedup primary check)', async () => {
		expect(await findByEventId('evt_unknown')).toBeNull();
	});

	it('insert した record を全列そのまま読み戻せる', async () => {
		const record = makeRecord({ tenantId: 't-test', eventType: 'invoice.paid' });
		await insert(record);
		expect(await findByEventId(record.eventId)).toEqual(record);
	});

	it('同一 event.id の二重 insert は first-writer-wins で無視される (dsql の ON CONFLICT と同契約)', async () => {
		await insert(makeRecord({ handlerResult: 'success' }));
		await insert(makeRecord({ handlerResult: 'skipped', eventType: 'invoice.paid' }));

		// 後着が上書きしない = 並列同時到達でも初回の処理結果が正
		expect(await findByEventId('evt_1ABCxyz')).toMatchObject({
			handlerResult: 'success',
			eventType: 'checkout.session.completed',
		});
	});

	it('incrementRetryCount が既存 row の retryCount を +1 する', async () => {
		await insert(makeRecord());
		await incrementRetryCount('evt_1ABCxyz');
		expect((await findByEventId('evt_1ABCxyz'))?.retryCount).toBe(1);
		await incrementRetryCount('evt_1ABCxyz');
		expect((await findByEventId('evt_1ABCxyz'))?.retryCount).toBe(2);
	});

	it('incrementRetryCount は未存在 event.id で throw しない (silent no-op)', async () => {
		await expect(incrementRetryCount('evt_missing')).resolves.toBeUndefined();
	});

	it('deleteOlderThan が cutoff より古い row のみ削除し件数を返す (30 日 retention)', async () => {
		await insert(makeRecord({ eventId: 'evt_old', processedAt: '2026-04-01T00:00:00.000Z' }));
		await insert(makeRecord({ eventId: 'evt_new', processedAt: '2026-05-30T00:00:00.000Z' }));

		expect(await deleteOlderThan('2026-05-01T00:00:00.000Z')).toBe(1);
		expect(await findByEventId('evt_old')).toBeNull();
		expect(await findByEventId('evt_new')).not.toBeNull();
	});

	it('deleteOlderThan は削除対象なしなら 0 を返す', async () => {
		await insert(makeRecord({ processedAt: '2026-05-30T00:00:00.000Z' }));
		expect(await deleteOlderThan('2026-01-01T00:00:00.000Z')).toBe(0);
	});
});

// vitest の worker 終了時に sqlite handle を閉じる
process.on('exit', () => {
	if (dbHolder.sqlite) closeDb(dbHolder.sqlite);
});
