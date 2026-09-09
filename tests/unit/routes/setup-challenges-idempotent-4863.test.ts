// tests/unit/routes/setup-challenges-idempotent-4863.test.ts
//
// `/setup/challenges` を 2 周しても challenge が二重に積まれないことを固定する
// (#4863 / PO 決裁 2026-09-09)。
//
// なぜここだけ守るのか (9 step を 1 つずつ当たった結果):
//
//   packs               取込は冪等 (adversarial 実測: 2 周で child_activities は 42 のまま、
//                       2 周目は packsImported=0 & packsSkipped=91)
//   rewards             `sourcePresetId` の重複検知 (#1254 G1) を strategy が持つ
//   rules               `alreadyImported` 判定 + `skipped` 計上を strategy が持つ
//   activities-defaults `setSetting` の upsert なので、何度実行しても値は 1 つ
//   **challenges**      `createChildChallengesBulk` は `insertBulk` するだけで
//                       **重複を見ない** ← ここだけが例外
//
// 中断した親の「続きをする」がウィザードへ戻るようになった (PO 決裁 Q2 = (b)) ので、
// この step は現実に 2 周する。
//
// 固定する不変条件:
//   [I1] 1 周目は preset を配信する
//   [I2] 2 周目は **同じ preset を配信しない** (skip される)
//   [I3] 配信済み判定は `sourceTemplateId` の接頭辞で行い、他の経路で作られた
//        challenge (手動 / auto:weekly) を誤って「配信済み」と数えない

import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeChallenge = { sourceTemplateId: string | null };

let stored: FakeChallenge[] = [];

const mockInsertBulk = vi.fn(async (inputs: FakeChallenge[]) => {
	stored.push(...inputs);
	return inputs;
});

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		childChallenge: {
			findAllByTenant: vi.fn(async () => stored),
			insertBulk: mockInsertBulk,
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// --- route の action を実際に 2 周させるための周辺 mock ---
const fakeChildren = [{ id: 'c-1', nickname: 'まさと', age: 7, uiMode: 'elementary' }];
vi.mock('$lib/server/auth/factory', () => ({ requireTenantId: () => 't-1' }));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn(async () => fakeChildren),
}));
vi.mock('$lib/server/db/child-repo', () => ({ findAllChildren: vi.fn(async () => fakeChildren) }));
vi.mock('$lib/server/services/setup-funnel-service', () => ({ trackSetupFunnel: vi.fn() }));

const { findAppliedSetupPresetIds, SETUP_PRESET_SOURCE_PREFIX } = await import(
	'../../../src/lib/server/services/child-challenge-service'
);

beforeEach(() => {
	stored = [];
	vi.clearAllMocks();
});

describe('[I1][I2][I3] setup preset の配信済み判定', () => {
	it('[I1] 何も配信していなければ空', async () => {
		expect((await findAppliedSetupPresetIds('t-1')).size).toBe(0);
	});

	it('[I2] 配信済みの preset id を返す (2 周目はこれで飛ばす)', async () => {
		stored = [
			{ sourceTemplateId: `${SETUP_PRESET_SOURCE_PREFIX}family-walk` },
			{ sourceTemplateId: `${SETUP_PRESET_SOURCE_PREFIX}family-walk` },
			{ sourceTemplateId: `${SETUP_PRESET_SOURCE_PREFIX}morning-routine` },
		];
		const applied = await findAppliedSetupPresetIds('t-1');
		expect(applied.has('family-walk')).toBe(true);
		expect(applied.has('morning-routine')).toBe(true);
		expect(applied.size, '子供の人数だけ instance があっても preset は 1 件と数える').toBe(2);
	});

	it('[I3] setup 由来でない challenge を「配信済み」と誤認しない', async () => {
		stored = [
			{ sourceTemplateId: 'auto:weekly' },
			{ sourceTemplateId: null },
			{ sourceTemplateId: 'marketplace:family-walk' },
		];
		const applied = await findAppliedSetupPresetIds('t-1');
		expect(
			applied.size,
			'接頭辞を見ずに拾うと、手動で作った challenge のせいで preset が配信されなくなる',
		).toBe(0);
	});

	it('接頭辞は route と service で同じ文字列を使う (片方だけ変わると重複配信に戻る)', () => {
		expect(SETUP_PRESET_SOURCE_PREFIX).toBe('setup-preset:');
	});
});

// --- 呼び出し側 (route) を実際に 2 周させる ---
// helper だけを test しても、route が `alreadyApplied` を見なくなれば二重配信に戻る
// (このセッションで繰り返し踏んだ「契約は正しいが呼ぶ側が呼ばない」型)。
const challengesRoute = await import('../../../src/routes/setup/challenges/+page.server');
const addChallenges = challengesRoute.actions.addChallenges;
if (!addChallenges) throw new Error('addChallenges action が見つからない (action 名が変わった?)');

function formEvent(presetIds: string[]) {
	const fd = new FormData();
	for (const id of presetIds) fd.append('presetIds', id);
	return {
		request: { formData: () => Promise.resolve(fd) },
		locals: { context: { tenantId: 't-1', licenseStatus: 'none', role: 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: route action の event 型は route ごとに異なる
	} as any;
}

/** action は redirect を throw するので、それは成功として扱う。 */
async function runAddChallenges(presetIds: string[]): Promise<void> {
	try {
		await addChallenges(formEvent(presetIds));
	} catch (e) {
		// SvelteKit の redirect は throw される
		if (!(e && typeof e === 'object' && 'status' in e)) throw e;
	}
}

describe('[I1][I2] route を 2 周しても二重に積まない', () => {
	it('2 周目は insertBulk を呼ばない', async () => {
		await runAddChallenges(['preset-hinamatsuri']);
		const afterFirst = mockInsertBulk.mock.calls.length;
		expect(afterFirst, '1 周目で配信されていない (前提が崩れている)').toBeGreaterThan(0);
		const storedAfterFirst = stored.length;

		await runAddChallenges(['preset-hinamatsuri']);
		expect(
			mockInsertBulk.mock.calls.length,
			'2 周目でも insertBulk が呼ばれている = 同じ preset が二重に積まれる。' +
				'中断者の「続きをする」がウィザードへ戻るようになったので、この step は現実に 2 周する',
		).toBe(afterFirst);
		expect(stored.length, '行が増えている').toBe(storedAfterFirst);
	});

	it('未配信の preset は 2 周目でも配信される (飛ばしすぎない)', async () => {
		await runAddChallenges(['preset-hinamatsuri']);
		const afterFirst = stored.length;
		await runAddChallenges(['preset-hinamatsuri', 'preset-kodomonohi']);
		expect(stored.length, '新しい preset まで飛ばしている').toBeGreaterThan(afterFirst);
	});
});
