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

type FakeChallenge = { sourceTemplateId: string | null; childId?: string };

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
const fakeChildren: { id: string; nickname: string; age: number; uiMode: string }[] = [
	{ id: 'c-1', nickname: 'まさと', age: 7, uiMode: 'elementary' },
];
vi.mock('$lib/server/auth/factory', () => ({ requireTenantId: () => 't-1' }));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn(async () => fakeChildren),
}));
vi.mock('$lib/server/db/child-repo', () => ({ findAllChildren: vi.fn(async () => fakeChildren) }));
vi.mock('$lib/server/services/setup-funnel-service', () => ({ trackSetupFunnel: vi.fn() }));

const { findAppliedSetupPresetChildIds, SETUP_PRESET_SOURCE_PREFIX } = await import(
	'../../../src/lib/server/services/child-challenge-service'
);

beforeEach(() => {
	stored = [];
	vi.clearAllMocks();
});

describe('[I1][I2][I3] setup preset の配信済み判定', () => {
	it('[I1] 何も配信していなければ空', async () => {
		expect((await findAppliedSetupPresetChildIds('t-1')).size).toBe(0);
	});

	it('[I2] 配信済みの preset id を返す (2 周目はこれで飛ばす)', async () => {
		stored = [
			{ sourceTemplateId: `${SETUP_PRESET_SOURCE_PREFIX}family-walk`, childId: 'c-1' },
			{ sourceTemplateId: `${SETUP_PRESET_SOURCE_PREFIX}family-walk`, childId: 'c-2' },
			{ sourceTemplateId: `${SETUP_PRESET_SOURCE_PREFIX}morning-routine`, childId: 'c-1' },
		];
		const applied = await findAppliedSetupPresetChildIds('t-1');
		expect(applied.get('family-walk')).toEqual(new Set(['c-1', 'c-2']));
		expect(applied.get('morning-routine')).toEqual(new Set(['c-1']));
		expect(applied.size, 'preset は 1 件と数え、受け取った子を集合で持つ').toBe(2);
	});

	it('[I3] setup 由来でない challenge を「配信済み」と誤認しない', async () => {
		stored = [
			{ sourceTemplateId: 'auto:weekly' },
			{ sourceTemplateId: null },
			{ sourceTemplateId: 'marketplace:family-walk' },
		];
		const applied = await findAppliedSetupPresetChildIds('t-1');
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
const addChallengesAction = challengesRoute.actions.addChallenges;
if (!addChallengesAction)
	throw new Error('addChallenges action が見つからない (action 名が変わった?)');
const addChallenges = addChallengesAction;

function formEvent(presetIds: string[]) {
	const fd = new FormData();
	for (const id of presetIds) fd.append('presetIds', id);
	return {
		request: { formData: () => Promise.resolve(fd) },
		locals: { context: { tenantId: 't-1', licenseStatus: 'none', role: 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: route action の event 型は route ごとに異なる
	} as any;
}

/** action は redirect を throw するので、それは成功として扱う。遷移先も返す。 */
async function runAddChallenges(presetIds: string[]): Promise<string> {
	try {
		await addChallenges(formEvent(presetIds));
	} catch (e) {
		// SvelteKit の redirect は throw される
		if (!(e && typeof e === 'object' && 'status' in e)) throw e;
		return String((e as { location?: string }).location ?? '');
	}
	return '';
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

describe('[I4] 後から加わった子にも配る (preset 単位で飛ばさない)', () => {
	it('1 人目に配信済みでも、2 人目には配信される', async () => {
		// #4868 adversarial 実測: preset id だけを鍵にすると、「戻る」で子供を追加してから
		// 前進し直した親の**後から加わった子だけが 1 件も受け取らない**。しかも skip は
		// 静かに continue するので、親には challengesAdded=0 としか見えない。
		fakeChildren.length = 0;
		fakeChildren.push({ id: 'c-1', nickname: 'まさと', age: 7, uiMode: 'elementary' });
		await runAddChallenges(['preset-hinamatsuri']);
		const afterFirst = stored.length;
		expect(afterFirst, '1 人目に配信されていない').toBeGreaterThan(0);

		// ここで子供を 1 人足して、同じ preset をもう一度通す
		fakeChildren.push({ id: 'c-2', nickname: 'はな', age: 5, uiMode: 'preschool' });
		await runAddChallenges(['preset-hinamatsuri']);

		const forSecond = stored.filter((c) => c.childId === 'c-2');
		expect(
			forSecond.length,
			'後から加わった子が setup チャレンジを 1 件も受け取っていない',
		).toBeGreaterThan(0);
		const forFirst = stored.filter((c) => c.childId === 'c-1');
		expect(forFirst.length, '1 人目に二重に積んでいる').toBe(afterFirst);
	});
});

describe('[I5] 直前の step の結果が次の画面に届く', () => {
	// #4868 adversarial: 旧実装は `?challengesAdded=N` を付けて redirect しながら
	// **その param を読むコードが `src/` に 1 つも無かった** (書き手 4 / 読み手 0)。
	// 親は「追加する」を押しても、追加された / すでにある のどちらの feedback も
	// 受け取らない (ADR-0062 §1 未達)。しかも 2 周目は必ず 0 件になるので、
	// 歩き直した親には**押しても何も起きない画面**に見えていた。
	//
	// `added` だけでは足りない — 0 の意味が「飛ばした」と「すでにある」の 2 つあると、
	// 次画面が正しい文言を選べない。`requested` を併せて渡す。
	it('1 周目は added>0 / requested>0 を渡す', async () => {
		const location = await runAddChallenges(['preset-hinamatsuri']);
		const params = new URLSearchParams(location.split('?')[1] ?? '');
		expect(location.startsWith('/setup/first-adventure')).toBe(true);
		expect(Number(params.get('challengesAdded')), '追加できたのに 0 を渡している').toBeGreaterThan(
			0,
		);
		expect(Number(params.get('challengesRequested'))).toBe(1);
	});

	it('2 周目は added=0 / requested>0 を渡す (「すでにある」と言えるようにする)', async () => {
		await runAddChallenges(['preset-hinamatsuri']);
		const location = await runAddChallenges(['preset-hinamatsuri']);
		const params = new URLSearchParams(location.split('?')[1] ?? '');
		expect(Number(params.get('challengesAdded'))).toBe(0);
		expect(
			Number(params.get('challengesRequested')),
			'requested が無いと「飛ばした」と区別できず、次画面が無言になる',
		).toBe(1);
	});

	it('何も選ばなかったときは param を付けない (要求していないので 0 件も嘘になる)', async () => {
		const location = await runAddChallenges([]);
		expect(location).toBe('/setup/first-adventure');
	});
});

describe('[I6] 全部失敗したときに「すでに追加ずみ」と言わない', () => {
	// #4868 adversarial round 4: `errors` は書き手 3 / 読み手 0 で、失敗が親に一度も
	// 届いていなかった。`added=0` の意味は「すでにある」だけでなく「作れなかった」もある。
	it('未知の preset を渡すと challengesFailed が付く', async () => {
		const location = await runAddChallenges(['preset-does-not-exist']);
		const params = new URLSearchParams(location.split('?')[1] ?? '');
		expect(Number(params.get('challengesAdded'))).toBe(0);
		expect(
			Number(params.get('challengesFailed')),
			'作れなかったのに「すでに追加ずみ」と表示されてしまう',
		).toBeGreaterThan(0);
	});

	it('成功したときは challengesFailed を付けない', async () => {
		const location = await runAddChallenges(['preset-hinamatsuri']);
		const params = new URLSearchParams(location.split('?')[1] ?? '');
		expect(params.get('challengesFailed')).toBeNull();
	});
});
