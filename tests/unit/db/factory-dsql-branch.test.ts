// tests/unit/db/factory-dsql-branch.test.ts
// EPIC #3424 / cutover 配線 / 設計 SSOT: dsql-data-model.md §8 / connection.ts (lazy singleton)
//
// factory.ts の DATA_SOURCE=dsql 分岐のテスト。実 DSQL pool は作らず、`./dsql/connection` を
// vi.mock して以下を検証する:
//
//   [F1] DATA_SOURCE=dsql: getRepos() が Repositories 全 key を実装オブジェクトで埋め、
//        db / runner は getDsqlDb() / getDsqlTransactionRunner() (mock) から取得される
//   [F2] DATA_SOURCE=sqlite / demo: getDsqlDb() / getDsqlTransactionRunner() が呼ばれない
//        (dsql 分岐内でのみ lazy 呼び出し。sqlite/demo 環境で pool を作らせない契約)
//
// module cache 注意: factory.ts は `_repos` singleton を持つため、各テストで
// vi.resetModules() + dynamic import で新しい module instance を得る (vi.mock 登録は
// resetModules 後も有効で、mock factory が再実行され呼び出し回数もリセットされる)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/server/db/dsql/connection', () => {
	// 実 AuroraDSQLPool を作らない fake。repo factory は db.execute / runner.runInTransaction を
	// 保持するだけ (getRepos 時点で SQL は発行されない) ため、この最小 shape で足りる。
	const fakeDb = {
		execute: vi.fn(async () => ({ rows: [] })),
		transaction: vi.fn(),
	};
	const fakeRunner = {
		runInTransaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(fakeDb)),
	};
	return {
		getDsqlDb: vi.fn(() => fakeDb),
		getDsqlTransactionRunner: vi.fn(() => fakeRunner),
	};
});

/** Repositories interface の全 key (factory.ts の interface 定義と同期)。 */
const REPOSITORY_KEYS = [
	'accountLockout',
	'activationFunnel',
	'battle',
	'cancellationReason',
	'certificate',
	'auth',
	'activity',
	'activityMastery',
	'activityPref',
	'childActivity',
	'childChallenge',
	'checklist',
	'child',
	'cloudExport',
	'dailyMission',
	'evaluation',
	'graduationConsent',
	'image',
	'inquiry',
	'loginBonus',
	'message',
	'point',
	'pushSubscription',
	'reportDailySummary',
	'siblingCheer',
	'settings',
	'rewardRedemption',
	'specialReward',
	'stampCard',
	'status',
	'storage',
	'trialHistory',
	'viewerToken',
	'voice',
] as const;

async function importFreshFactory() {
	const factory = await import('../../../src/lib/server/db/factory');
	const connection = await import('../../../src/lib/server/db/dsql/connection');
	return { factory, connection };
}

describe('factory DATA_SOURCE=dsql 分岐 (connection mock、実 pool を作らない)', () => {
	const originalDataSource = process.env.DATA_SOURCE;

	beforeEach(() => {
		// factory の _repos singleton を破棄する。mock instance 自体は resetModules 後も同一の
		// ことがあるため、呼び出し回数は clearAllMocks で明示リセットする (テスト間の持ち越し防止)。
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
		else process.env.DATA_SOURCE = originalDataSource;
	});

	it('[F1] dsql: 全 repo key が実装で埋まり、db/runner は connection の lazy getter から取得', async () => {
		process.env.DATA_SOURCE = 'dsql';
		const { factory, connection } = await importFreshFactory();

		const repos = factory.getRepos();

		// db / runner は mock 経由 (= 実 AuroraDSQLPool は生成されない)
		expect(connection.getDsqlDb).toHaveBeenCalledTimes(1);
		expect(connection.getDsqlTransactionRunner).toHaveBeenCalledTimes(1);

		// Repositories 全 field が漏れなく実装オブジェクトで埋まる (キー網羅)
		expect(Object.keys(repos).sort()).toEqual([...REPOSITORY_KEYS].sort());
		for (const key of REPOSITORY_KEYS) {
			const repo = (repos as unknown as Record<string, unknown>)[key];
			expect(repo, `repos.${key} が未配線`).toBeTruthy();
			expect(typeof repo, `repos.${key} が object でない`).toBe('object');
		}

		// 新規配線 (compute-on-read repo) の spot check
		expect(typeof repos.reportDailySummary.findByChildAndDateRange).toBe('function');
		expect(typeof repos.reportDailySummary.upsert).toBe('function');
		// storage は s3/ の S3 実装を再利用 (DB backend 非依存、#3438 Phase 1 で dynamodb/ から移設済)
		expect(typeof repos.storage.saveFile).toBe('function');
		expect(typeof repos.storage.getDownloadUrl).toBe('function');

		// singleton: 2 回目は同一 instance を返し、connection getter を再度呼ばない
		expect(factory.getRepos()).toBe(repos);
		expect(connection.getDsqlDb).toHaveBeenCalledTimes(1);
	});

	it('[F2] sqlite: getDsqlDb / getDsqlTransactionRunner は呼ばれない (lazy 契約)', async () => {
		process.env.DATA_SOURCE = 'sqlite';
		const { factory, connection } = await importFreshFactory();

		const repos = factory.getRepos();
		expect(Object.keys(repos).sort()).toEqual([...REPOSITORY_KEYS].sort());
		expect(connection.getDsqlDb).not.toHaveBeenCalled();
		expect(connection.getDsqlTransactionRunner).not.toHaveBeenCalled();
	});

	it('[F2] demo: getDsqlDb / getDsqlTransactionRunner は呼ばれない (lazy 契約)', async () => {
		process.env.DATA_SOURCE = 'demo';
		const { factory, connection } = await importFreshFactory();

		const repos = factory.getRepos();
		expect(Object.keys(repos).sort()).toEqual([...REPOSITORY_KEYS].sort());
		expect(connection.getDsqlDb).not.toHaveBeenCalled();
		expect(connection.getDsqlTransactionRunner).not.toHaveBeenCalled();
	});
});
