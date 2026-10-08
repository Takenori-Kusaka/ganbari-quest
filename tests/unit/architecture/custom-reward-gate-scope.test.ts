// tests/unit/architecture/custom-reward-gate-scope.test.ts
//
// 「オリジナルのごほうびの作成・編集（ポイントの調整を含む）」(CUSTOM_REWARD_FEATURE_NAME) の
// **実ゲートの範囲**と、それを説明する設計書・画面が同じ操作を数えていることを固定する。
//
// ## なぜ要るか
//
// admin/rewards で `isCustomRewardUnlocked` が拒否する action は 6 つあるが、ゲートの範囲を
// 説明する設計書 (07-API設計書 のプランゲート表 / plan-features-audit) は 3 つ
// (?/add ?/addPreset ?/update) しか載せていなかった。載っていない操作は「全プラン可」と読まれ、
// 画面側でも「バックアップから復元」だけがロック表示を持たず、無料プランではファイルを選んで
// 「内容を確認」を押した後に初めて拒否されていた (拒否された後にだけ理由が出る形)。
//
// ゲートを足す人は server の action しか見ない。設計書と画面の追従を人の記憶に頼らず、
// ここで action の集合から検査する (ADR-0061 same-class→guard)。
//
// ## 固定する不変条件
//
//   [G1] ゲートされる action の集合が期待どおり (増減したらこの test を直す = 設計書も直す)
//   [G2] 07-API設計書 のプランゲート表に、ゲートされる全 action の行が standard で載っている
//   [G3] plan-features-audit の該当行が、ゲートされる全 action を実装として挙げている
//   [G4] 画面から直接叩ける action (メニュー項目) は、無料プランでロック表示に切り替わる

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

const SERVER_PATH = 'src/routes/(parent)/admin/rewards/+page.server.ts';
const PAGE_PATH = 'src/routes/(parent)/admin/rewards/+page.svelte';

/** ゲートされる action。増減は料金表の意味を変えるので、設計書と一緒にここを直す。 */
const EXPECTED_GATED_ACTIONS = [
	'add',
	'update',
	'addPreset',
	'copyFromChild',
	'restorePreview',
	'restoreFile',
] as const;

/**
 * `export const actions = withParentGate({ ... })` の中の各 action の本文を切り出し、
 * `isCustomRewardUnlocked(` を呼ぶものを返す。
 * action は行頭タブ 1 つ + `<name>: async (` で始まる (biome の整形で固定)。
 */
function gatedActions(source: string): string[] {
	const start = source.indexOf('export const actions');
	expect(start, 'actions の宣言が見つからない').toBeGreaterThan(-1);
	const body = source.slice(start);
	const heads = [...body.matchAll(/^\t(\w+): async \(/gm)];
	expect(heads.length, 'action が 1 つも見つからない (書式が変わった?)').toBeGreaterThan(0);
	const gated: string[] = [];
	heads.forEach((m, i) => {
		const from = m.index ?? 0;
		const to = heads[i + 1]?.index ?? body.length;
		if (body.slice(from, to).includes('isCustomRewardUnlocked(')) gated.push(m[1] as string);
	});
	return gated;
}

describe('ごほうびの作成・編集ゲートの範囲 (CUSTOM_REWARD_FEATURE_NAME)', () => {
	const gated = gatedActions(repoFile(SERVER_PATH));

	it('[G1] admin/rewards でゲートされる action の集合が期待どおり', () => {
		expect([...gated].sort()).toEqual([...EXPECTED_GATED_ACTIONS].sort());
	});

	it('[G2] 07-API設計書 のプランゲート表に全 action が standard で載っている', () => {
		const doc = repoFile('docs/design/07-API設計書.md');
		const missing = EXPECTED_GATED_ACTIONS.filter(
			(name) => !doc.includes(`| \`POST /admin/rewards ?/${name}\` | standard |`),
		);
		expect(missing).toEqual([]);
	});

	it('[G3] plan-features-audit の該当行が全 action を実装として挙げている', () => {
		const doc = repoFile('docs/design/plan-features-audit.md');
		const row = doc.split('\n').find((l) => l.includes('`canCustomReward`'));
		expect(row, 'canCustomReward の行が見つからない').toBeDefined();
		const missing = EXPECTED_GATED_ACTIONS.filter((name) => !row?.includes(`\`?/${name}\``));
		expect(missing).toEqual([]);
	});

	it('[G4] 画面のメニューから開く「別のお子さまからコピー」「バックアップから復元」は無料でロック表示になる', () => {
		const page = repoFile(PAGE_PATH);
		for (const id of ['copy', 'restore']) {
			const at = page.indexOf(`id: '${id}',`);
			expect(at, `メニュー項目 ${id} が見つからない`).toBeGreaterThan(-1);
			// 項目の定義 (次の `id:` まで) の中で、表示と選択の両方が解放判定で分岐していること
			const next = page.indexOf('id: ', at + 4);
			const item = page.slice(at, next === -1 ? undefined : next);
			expect(item, `${id}: 無料プランで鍵マークに切り替えていない`).toContain(
				'PLAN_GATE_LABELS.lockedItemIcon',
			);
			expect(item, `${id}: 選択時の動作が解放判定で分岐していない`).toMatch(
				/onSelect: data\.isPremium\s*\?/,
			);
		}
	});
});
