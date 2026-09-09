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
//   [Q5] archive 済も見る (親が消したものを黙って復活させない)
//   [Q6] 配信先を外された孤児 template を作り直さず配信し直す (二重の名前と孤児を作らない)
//   [Q7] ただし**中身がプリセットのまま**の孤児だけ拾う — 子供を削除しても孤児はできるので、
//        名前や item を書き換えたものを拾うと「別の子のために書いた内容」が新しい子に出る

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 実体に合わせて **family template + assignments** で持つ (#4868 adversarial 指摘)。
// 旧 mock は template に childId を直接持たせていたため、
// 「配信先を外す」= assignment だけ消える経路を表現できなかった。
type FakeTemplate = {
	id: string;
	/** 親が書き換えられる。書き換えられていたら「その子のためのもの」= 拾わない。 */
	name: string;
	sourcePresetId: string | null;
	isArchived?: boolean;
};

let templates: FakeTemplate[] = [];
/** templateId -> 配信先 childId 群 */
let assignments: Map<string, Set<string>> = new Map();
/** templateId -> item 名 (親が足す・書き換えることがある) */
let itemsByTemplate: Map<string, string[]> = new Map();

const childrenOf = (templateId: string) => assignments.get(templateId) ?? new Set<string>();

vi.mock('$lib/server/db/checklist-repo', () => ({
	// 既定 (includeInactive=false / includeArchived=false) では archive 済を返さない。
	// service 側が両方 true で呼んでいることを、この mock が区別して確かめる。
	findTemplatesByChild: vi.fn(
		async (childId: string, _tenantId: string, _inactive = false, includeArchived = false) =>
			templates.filter(
				(t) => childrenOf(t.id).has(childId) && (includeArchived || t.isArchived !== true),
			),
	),
	// family scope。実装と同じく **archive 済は返さない** (repo の実挙動)。
	findTemplatesByTenant: vi.fn(async (_tenantId: string, _includeInactive = false) =>
		templates.filter((t) => t.isArchived !== true),
	),
	findAssignmentsByTemplate: vi.fn(async (templateId: string) =>
		[...childrenOf(templateId)].map((childId) => ({ templateId, childId })),
	),
	findTemplateItems: vi.fn(async (templateId: string) =>
		(itemsByTemplate.get(templateId) ?? []).map((name, i) => ({ id: `i-${i}`, name })),
	),
	assignTemplateToChildren: vi.fn(async (templateId: string, childIds: readonly string[]) => {
		const set = assignments.get(templateId) ?? new Set<string>();
		for (const c of childIds) set.add(c);
		assignments.set(templateId, set);
		return childIds.map((childId) => ({ templateId, childId }));
	}),
}));

const mockCreateTemplate = vi.fn(
	async (input: { childId: string; name: string; sourcePresetId?: string | null }) => {
		const t = {
			id: `t-${templates.length + 1}`,
			name: input.name,
			sourcePresetId: input.sourcePresetId ?? null,
		};
		templates.push(t);
		// 実装の createTemplate は insertTemplate + assignTemplateToChildren を行う
		assignments.set(t.id, new Set([input.childId]));
		itemsByTemplate.set(t.id, []);
		return t;
	},
);

vi.mock('$lib/server/services/checklist-service', () => ({
	createTemplate: (...args: unknown[]) => mockCreateTemplate(...(args as [never])),
	addTemplateItem: vi.fn(async (input: { templateId: string; name: string }) => {
		const cur = itemsByTemplate.get(input.templateId) ?? [];
		cur.push(input.name);
		itemsByTemplate.set(input.templateId, cur);
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { applyChecklistPresets } = await import(
	'../../../src/lib/server/services/questionnaire-service'
);

beforeEach(() => {
	templates = [];
	assignments = new Map();
	itemsByTemplate = new Map();
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
			name: 'あさのしたく',
			sourcePresetId: 'morning-routine',
			isArchived: true,
		});
		assignments.set('t-archived', new Set(['c-1']));
		const created = await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		expect(created, 'archive 済を見落として再作成している = 親が消したものが戻ってくる').toBe(0);
	});
});

describe('[Q6] 配信先を外された孤児 template を作り直さない', () => {
	it('どの子にも配信されていない同 preset があれば、それを配信し直す', async () => {
		// `/admin/checklists` の `syncDistribution` は assignment を削る**実在の顧客導線**。
		// 「あさのしたく は下の子だけにする」と外した親が歩き直すと、per-child 判定だけでは
		// 別 id の同名 template を新規作成し、旧 template は assignment 0 本の孤児として
		// family に残る (#4868 adversarial 実測: template 1 → 2 / item 5 → 10)。
		// `checkChecklistTemplateLimit` は child 経由で数えるので quota には出ず、
		// admin の一覧にだけ「あさのしたく」が 2 本並ぶ。
		await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		expect(templates).toHaveLength(1);
		const originalId = templates[0]?.id;

		// 親が配信先から外す (template は残り、assignment だけ消える)
		assignments.set(originalId as string, new Set());

		const created = await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');

		expect(created, '配信し直したことを 1 件として数える').toBe(1);
		expect(
			templates,
			'新しい template を作っている = 同名が 2 本並び、片方が孤児になる',
		).toHaveLength(1);
		expect([...childrenOf(originalId as string)], '元の template が配信し直されていない').toEqual([
			'c-1',
		]);
	});

	it('別の子に配信中の template は孤児ではない (兄弟の扱いを変えない)', async () => {
		// family master を共有させると、片方の子だけ item を足す・減らすができなくなる
		// (親のカスタマイズを奪う)。孤児 = **どの子にも配信されていない** ものだけを拾う。
		await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		const created = await applyChecklistPresets(childId('c-2'), ['morning-routine'], 't-1');

		expect(created).toBe(1);
		expect(templates, '兄弟の扱いが変わっている').toHaveLength(2);
	});

	it('archive 済の孤児は拾わない (親が消したものを復活させない)', async () => {
		templates.push({
			id: 't-archived',
			name: 'あさのしたく',
			sourcePresetId: 'morning-routine',
			isArchived: true,
		});
		assignments.set('t-archived', new Set());

		await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');

		expect(
			[...childrenOf('t-archived')],
			'archive 済を配信し直している = 親が消したものが戻ってくる',
		).toEqual([]);
	});
});

describe('[Q7] 別の子のために書き換えられた孤児は拾わない', () => {
	it('名前を書き換えられた孤児は配信し直さず、新しく作る', async () => {
		// #4868 adversarial round 4 実測: 孤児は配信解除だけでなく**子供の削除**でもできる
		// (`deleteChild` は assignment を消すが family scope の template 本体は残す)。
		// そのとき template は削除した子のために親が書き換えた名前を持っていることがあり、
		// 拾うと**別の子のために書いた個人的な内容が、新しく登録した子の画面に出る**。
		templates.push({
			id: 't-personalized',
			name: 'さくらの あさのしたく',
			sourcePresetId: 'morning-routine',
		});
		assignments.set('t-personalized', new Set());
		itemsByTemplate.set('t-personalized', ['はみがき', 'きがえ', 'さくらのピアノ']);

		const created = await applyChecklistPresets(childId('c-new'), ['morning-routine'], 't-1');

		expect(created).toBe(1);
		expect(
			[...childrenOf('t-personalized')],
			'削除した子のために書き換えた template を新しい子へ配信している',
		).toEqual([]);
		expect(templates.length, '新しい template が作られていない').toBe(2);
	});

	it('item を足された孤児も拾わない (名前はそのままでも中身が違う)', async () => {
		await applyChecklistPresets(childId('c-1'), ['morning-routine'], 't-1');
		const original = templates[0]?.id as string;
		// 親が item を 1 つ足してから、配信先を外した
		itemsByTemplate.set(original, [...(itemsByTemplate.get(original) ?? []), 'さくらのピアノ']);
		assignments.set(original, new Set());

		await applyChecklistPresets(childId('c-2'), ['morning-routine'], 't-1');

		expect([...childrenOf(original)], '中身が違う孤児を配信し直している').toEqual([]);
		expect(templates.length).toBe(2);
	});
});
