// tests/unit/services/questionnaire-preset-idempotent-4863.test.ts
//
// `/setup/questionnaire` を 2 周してもチェックリストが二重に積まれないことを固定する
// (#4863 / adversarial 実測)。
//
// なぜ致命的だったか: 本 PR は**中断した親をこの step へ戻す**。つまりここは
// 現実に 2 周する着地点そのもの。`applyChecklistPresets` → `createTemplate` →
// `insertTemplate` は `sourcePresetId` の重複を一切見ないため、2 周すると
// **子供のチェックリスト画面に「あさのしたく」「よるのじゅんび」が 2 つずつ並ぶ**
// (adversarial 実測: template 3 → 6 / 明示選択でも 1 → 2、item 5 → 10)。
//
// 冪等性の表から**着地点が丸ごと落ちていた**のがこの欠陥の本質で、
// 「2 周しても大丈夫」と書いた側が 2 周する当の画面を数えていなかった。
//
// 固定する不変条件:
//   [Q1] 1 周目は preset を適用する
//   [Q2] 2 周目は同じ preset を適用しない
//   [Q3] 同一呼び出しで同じ preset を 2 回渡しても 1 回しか作らない
//   [Q4] 別の子には独立に適用される (子供ごとの判定であること)

import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeTemplate = {
	id: string;
	childId: string;
	sourcePresetId: string | null;
	isArchived?: boolean;
};

let templates: FakeTemplate[] = [];

vi.mock('$lib/server/db/checklist-repo', () => ({
	// 既定 (includeInactive=false / includeArchived=false) では archive 済を返さない。
	// service 側が両方 true で呼んでいることを、この mock が区別して確かめる。
	findTemplatesByChild: vi.fn(
		async (childId: string, _tenantId: string, _inactive = false, includeArchived = false) =>
			templates.filter((t) => t.childId === childId && (includeArchived || t.isArchived !== true)),
	),
}));

const mockCreateTemplate = vi.fn(
	async (input: { childId: string; sourcePresetId?: string | null }) => {
		const t = {
			id: `t-${templates.length + 1}`,
			childId: input.childId,
			sourcePresetId: input.sourcePresetId ?? null,
		};
		templates.push(t);
		return t;
	},
);

vi.mock('$lib/server/services/checklist-service', () => ({
	createTemplate: (...args: unknown[]) => mockCreateTemplate(...(args as [never])),
	addTemplateItem: vi.fn(async () => undefined),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { applyChecklistPresets } = await import(
	'../../../src/lib/server/services/questionnaire-service'
);

beforeEach(() => {
	templates = [];
	vi.clearAllMocks();
});

// biome-ignore lint/suspicious/noExplicitAny: ChildId は branded 型で、test では素の文字列を渡す
const childId = (v: string) => v as any;

describe('[Q1][Q2] 同じ preset を 2 周しても増えない', () => {
	it('1 周目は作る', async () => {
		const created = await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		expect(created).toBe(1);
		expect(templates).toHaveLength(1);
	});

	it('2 周目は作らない (中断→再開でここを必ず 2 周する)', async () => {
		await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		const second = await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		expect(second, '2 周目でも作っている = 子供の画面に同じチェックリストが 2 つ並ぶ').toBe(0);
		expect(templates).toHaveLength(1);
	});
});

describe('[Q3] 同一呼び出しの重複入力', () => {
	it('同じ preset を 2 回渡しても 1 回しか作らない', async () => {
		const created = await applyChecklistPresets(
			childId('c-1'),
			['morning-routine', 'morning-routine'],
			't-1',
		);
		expect(created).toBe(1);
		expect(templates).toHaveLength(1);
	});
});

describe('[Q4] 子供ごとに独立', () => {
	it('別の子には適用される (飛ばしすぎない)', async () => {
		await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		const created = await applyChecklistPresets(childId('c-2'), ['morning-routine'], 't-1');
		expect(created, '別の子にまで「配信済み」を適用している').toBe(1);
		expect(templates).toHaveLength(2);
	});
});

describe('[Q5] archive 済も見る (親が消したものを黙って復活させない)', () => {
	it('archive 済の preset は再作成しない', async () => {
		// #3106: archive は親にとって通常の削除経路。archive を見ずに判定すると、
		// 歩き直したときに**親が消したはずのチェックリストが黙って復活する**。
		templates.push({
			id: 't-archived',
			childId: 'c-1',
			sourcePresetId: 'morning-routine',
			isArchived: true,
		});
		const created = await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		expect(created, 'archive 済を見落として再作成している = 親が消したものが戻ってくる').toBe(0);
	});
});
