// tests/unit/ui/ai-suggest-gate-matrix-4506.test.ts (#4506 AC4)
//
// AI 提案パネルの表示状態を **プラン × 画面のマトリクス**で固定する。
//
// # 何が壊れていたか
// 兄弟 3 画面が別々の式で `isFamily` を導出しており、2 画面が誤っていた。
//   - checklists: `data.planTier === 'family'` (正) — ただし「load が返していない」と 2 度誤読された
//   - activities: `data.isPremium` (= 有料 tier 全体) — **standard に解放表示 → 実行時 403**
//   - rewards:    `data.planTier === 'family'` (正)
//
// 述語を 1 本 (`isAiSuggestUnlocked`) にした後も、**「どのプランで開くか」の答えは
// test に書かれていなければ次の改修で静かに変わる**。プラン別の期待値をここに置く。
//
// 導出経路 (call site が述語を通っているか / load が field を返しているか) の検査は
// tests/unit/architecture/ai-suggest-gate-derivation.test.ts が担う (本 test は値の側)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAiSuggestUnlocked } from '../../../src/lib/domain/ai-suggest-gate';
import type { PlanTier } from '../../../src/lib/domain/constants/plan-tier';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

/** AI 提案パネルを持つ admin 3 画面。増えたらここに足す (足さないと網羅が黙って減る)。 */
const AI_SUGGEST_SCREENS = [
	'src/routes/(parent)/admin/activities/+page.svelte',
	'src/routes/(parent)/admin/checklists/+page.svelte',
	'src/routes/(parent)/admin/rewards/+page.svelte',
];

/** プラン × 期待表示。true = パネルが使える / false = ロック + アップグレード CTA。 */
const EXPECTED: Array<{ tier: PlanTier; unlocked: boolean; note: string }> = [
	{ tier: 'free', unlocked: false, note: '無料プランは対象外' },
	{
		tier: 'standard',
		unlocked: false,
		note: 'AI 提案は premium 限定。旧 activities はここで解放表示 → 実行時 403 だった (GAMMA2-ADM1-02)',
	},
	{
		tier: 'family',
		unlocked: true,
		note: 'premium (内部コード family)。旧 checklists はここでロック表示だった (GAMMA2-ADM1-01)',
	},
];

describe('#4506 AI 提案パネルの表示状態マトリクス', () => {
	describe('プラン別の期待値', () => {
		it.each(EXPECTED)('$tier → unlocked=$unlocked ($note)', ({ tier, unlocked }) => {
			expect(isAiSuggestUnlocked(tier)).toBe(unlocked);
		});

		it('premium トライアル中も使える (resolvePlanTier が family を返すため別分岐が要らない)', () => {
			// #4501 で TRIAL_TIER = 'family' に固定した。トライアル利用者は tier=family として解決される
			expect(isAiSuggestUnlocked('family')).toBe(true);
		});
	});

	describe('3 画面が同一の式で導出している (画面ごとの独自式に戻らない)', () => {
		it.each(AI_SUGGEST_SCREENS)('%s が isAiSuggestUnlocked(data.planTier) を使う', (file) => {
			const src = repoFile(file);
			expect(src).toContain('isAiSuggestUnlocked(data.planTier)');
		});

		it.each(AI_SUGGEST_SCREENS)('%s に旧式 (data.isPremium での isFamily 導出) が無い', (file) => {
			const src = repoFile(file);
			// isPremium 自体は他用途 (上限バナー等) で使うため、AI パネルへの受け渡しだけを禁じる
			expect(src).not.toMatch(/isFamily=\{data\.isPremium\}/);
			expect(src).not.toMatch(/isFamily=\{data\.planTier === 'family'\}/);
		});
	});
});
