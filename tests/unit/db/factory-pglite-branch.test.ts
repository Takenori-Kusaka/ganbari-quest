// tests/unit/db/factory-pglite-branch.test.ts
// EPIC #3620 AC-C2 (ADR-0064 案 C) / cutover 配線 / 設計 SSOT: pglite/connection.ts
//
// factory.ts の DATA_SOURCE=pglite 分岐のテスト。実 PGlite は open せず `./pglite/connection` を
// vi.mock して以下を検証する (factory-dsql-branch.test.ts と同型):
//
//   [FP1] DATA_SOURCE=pglite: getRepos() が Repositories 全 key を dsql repos で埋め、
//         db / runner は getPgliteDbSync() / getPgliteTransactionRunnerSync() (mock) から取得
//   [FP2] DATA_SOURCE=sqlite / demo / dsql: getPglite*Sync が呼ばれない (pglite 分岐内のみ、
//         他 backend で PGlite を open させない契約)
//
// module cache 注意: factory.ts は `_repos` singleton を持つため、各テストで vi.resetModules()
// + dynamic import で新しい module instance を得る。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/server/db/pglite/connection', () => {
	// 実 PGlite を open しない fake。repo factory は db.execute / runner.runInTransaction を保持する
	// だけ (getRepos 時点で SQL 未発行) のため最小 shape で足りる。
	const fakeDb = {
		execute: vi.fn(async () => ({ rows: [] })),
		transaction: vi.fn(),
	};
	const fakeRunner = {
		runInTransaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(fakeDb)),
	};
	return {
		getPgliteDbSync: vi.fn(() => fakeDb),
		getPgliteTransactionRunnerSync: vi.fn(() => fakeRunner),
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
	'usageLog',
	'viewerToken',
	'voice',
	'webhookEvent', // #3985: Stripe webhook の event.id dedup 台帳
] as const;

async function importFreshFactory() {
	const factory = await import('../../../src/lib/server/db/factory');
	const connection = await import('../../../src/lib/server/db/pglite/connection');
	return { factory, connection };
}

describe('factory DATA_SOURCE=pglite 分岐 (connection mock、実 PGlite を open しない)', () => {
	const originalDataSource = process.env.DATA_SOURCE;

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
		else process.env.DATA_SOURCE = originalDataSource;
	});

	it('[FP1] pglite: 全 repo key が dsql repos で埋まり、db/runner は pglite の sync getter から取得', async () => {
		process.env.DATA_SOURCE = 'pglite';
		const { factory, connection } = await importFreshFactory();

		const repos = factory.getRepos();

		// db / runner は mock 経由 (= 実 PGlite は open されない、案 C = dsql repos verbatim 再利用)
		expect(connection.getPgliteDbSync).toHaveBeenCalledTimes(1);
		expect(connection.getPgliteTransactionRunnerSync).toHaveBeenCalledTimes(1);

		// Repositories 全 field が漏れなく実装オブジェクトで埋まる (キー網羅)
		expect(Object.keys(repos).sort()).toEqual([...REPOSITORY_KEYS].sort());
		for (const key of REPOSITORY_KEYS) {
			const repo = (repos as unknown as Record<string, unknown>)[key];
			expect(repo, `repos.${key} が未配線`).toBeTruthy();
			expect(typeof repo, `repos.${key} が object でない`).toBe('object');
		}
		// dsql repos を再利用しているため spot check も dsql と同型
		expect(typeof repos.child.insertChild).toBe('function');
		expect(typeof repos.point.spendPointsAtomic).toBe('function');

		// singleton: 2 回目は同一 instance を返し、sync getter を再度呼ばない
		expect(factory.getRepos()).toBe(repos);
		expect(connection.getPgliteDbSync).toHaveBeenCalledTimes(1);
	});

	it('[FP2] sqlite/demo/dsql: getPglite*Sync は呼ばれない (pglite 分岐内のみ、他 backend で open させない)', async () => {
		for (const ds of ['sqlite', 'demo'] as const) {
			vi.resetModules();
			vi.clearAllMocks();
			process.env.DATA_SOURCE = ds;
			const { factory, connection } = await importFreshFactory();
			factory.getRepos();
			expect(connection.getPgliteDbSync, `${ds} で PGlite を open`).not.toHaveBeenCalled();
			expect(connection.getPgliteTransactionRunnerSync).not.toHaveBeenCalled();
		}
	});
});
