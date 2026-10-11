// tests/unit/domain/reward-edit-gate-4992.test.ts
//
// #4992 PO 決裁 Q2: 取り込んだごほうびの点数・名前の編集は有料 (スタンダード以上) のまま。
// 条件は 2 点:
//   1. 料金表の文言を実装に合わせる (ADR-0013)。「オリジナルごほうびの登録」だけでは、
//      取り込んだごほうびのポイント調整まで有料とは読めない。
//   2. 無料プランで「編集」を黙って押せない状態にしない (押す前に理由が読める)。
//
// 実ゲートは admin/rewards の ?/add ?/addPreset ?/update ?/copyFromChild ?/restorePreview ?/restoreFile と
// special-rewards API が読む isCustomRewardUnlocked (#4584)。料金表・拒否文言・画面の注記がこのゲートと
// 同じことを言うかを固定する (ゲートの範囲と設計書の突合は tests/unit/architecture/custom-reward-gate-scope.test.ts)。

import { describe, expect, it } from 'vitest';
import { isCustomRewardUnlocked } from '../../../src/lib/domain/custom-reward-gate';
import {
	ADMIN_REWARDS_PAGE_LABELS,
	CUSTOM_REWARD_FEATURE_NAME,
	LP_CORELOOP_LABELS,
	LP_INDEX_PHASEB_LABELS,
	LP_PAMPHLET_PHASEB_LABELS,
	LP_PRICING_LABELS,
	LP_PRICING_PHASEB_LABELS,
	PAGE_GUIDE_LABELS,
	PLAN_GATE_LABELS,
} from '../../../src/lib/domain/labels';
import {
	PREMIUM_UNLOCKED_FEATURES,
	PRICING_PAGE_FEATURES,
} from '../../../src/lib/domain/plan-features';
import {
	PLAN_FULL_TERMS,
	PLAN_TERMS,
	POINT_TERMS,
	REWARD_ADMIN_TERMS,
	REWARD_TERMS,
} from '../../../src/lib/domain/terms';

/** PO 決裁 (#4992) の文言そのもの。atom の値を変えるときは PO 決裁を取り直す。 */
const PAID_FEATURE_NAME = 'オリジナルのごほうびの作成・編集（ポイントの調整を含む）';
/** 旧名称。編集が有料であることを言っていなかった。 */
const OLD_FEATURE_NAME = 'オリジナルごほうびの登録';

describe('#4992 料金表の文言が実装 (編集もスタンダード以上) と一致する', () => {
	it('有料機能の名前が PO 決裁の文言と一致する', () => {
		expect(CUSTOM_REWARD_FEATURE_NAME).toBe(PAID_FEATURE_NAME);
	});

	it('有料機能の名前は labels 層の compound で、atom を組み立てて作る (terms.ts に置かない、ADR-0045)', () => {
		// 「ごほうび」「ポイント」は別の atom の値。terms.ts に文ごと置くと、atom を 1 行直しても
		// この名前だけ古い語のまま残る (atom 1 行伝播が壊れる)。
		expect(CUSTOM_REWARD_FEATURE_NAME).toBe(
			`オリジナルの${REWARD_TERMS.canonical}の作成・編集（${POINT_TERMS.unitFull}の調整を含む）`,
		);
		expect(Object.keys(REWARD_TERMS)).not.toContain('originalCreateEdit');
		expect(Object.values(REWARD_TERMS)).not.toContain(PAID_FEATURE_NAME);
	});

	it('admin/rewards の拒否文言が料金表と同じ名前で有料の操作を名指す', () => {
		// 料金表は「作成・編集（ポイントの調整を含む）」、拒否は「作成・編集」と別の名前を言うと、
		// 顧客は料金表のどの行で止められたのかを突き合わせられない。
		expect(PLAN_GATE_LABELS.rewardCustomizeFeature).toBe(CUSTOM_REWARD_FEATURE_NAME);
	});

	it('LP 料金表の無料カードが「作成・編集（ポイントの調整を含む）はスタンダード以上」と述べる', () => {
		expect(LP_PRICING_PHASEB_LABELS.k8b).toContain(`${REWARD_TERMS.preset}から追加`);
		expect(LP_PRICING_PHASEB_LABELS.k8b).toContain(
			`${PAID_FEATURE_NAME}は${PLAN_TERMS.standard}以上`,
		);
		// 全角括弧の入れ子 (「（…（…）…）」) は読みにくいので作らない
		expect(LP_PRICING_PHASEB_LABELS.k8b).not.toMatch(/（[^）]*（/);
	});

	it('LP 料金表のスタンダードカード / 比較表 / パンフレットが同じ名前を出す', () => {
		expect(LP_PRICING_PHASEB_LABELS.k13).toBe(PAID_FEATURE_NAME);
		expect(LP_PRICING_PHASEB_LABELS.k39).toContain(`<td>${PAID_FEATURE_NAME}</td>`);
		// 比較表の ✗/✓ の並びが実ゲートと一致する (無料 = —、スタンダード / プレミアム = ✓)
		expect(LP_PRICING_PHASEB_LABELS.k39).toMatch(
			/<td class="dash">&#8212;<\/td><td class="check">&#10003;<\/td><td class="check">&#10003;<\/td>$/,
		);
		expect(isCustomRewardUnlocked('free')).toBe(false);
		expect(isCustomRewardUnlocked('standard')).toBe(true);
		expect(isCustomRewardUnlocked('family')).toBe(true);
		expect(LP_PAMPHLET_PHASEB_LABELS.k43).toContain(PAID_FEATURE_NAME);
	});

	it('LP の FAQ が「取り込んだごほうびの名前やポイントを変えること」も有料だと明記する', () => {
		expect(LP_PRICING_LABELS.faqFreeA).toContain(PAID_FEATURE_NAME);
		expect(LP_PRICING_LABELS.faqFreeA).toContain(`取り込んだ${REWARD_TERMS.canonical}`);
		expect(LP_PRICING_LABELS.faqFreeA).toContain('ポイント');
		expect(LP_PRICING_LABELS.faqFreeA).toContain(`${PLAN_FULL_TERMS.standard}以上`);
	});

	it('アプリ内料金表とアップグレード直後の案内が同じ名前を出す', () => {
		expect(PRICING_PAGE_FEATURES.free).toContain(
			`${PAID_FEATURE_NAME}は${PLAN_TERMS.standard}以上`,
		);
		expect(PRICING_PAGE_FEATURES.standard).toContain(PAID_FEATURE_NAME);
		expect(PREMIUM_UNLOCKED_FEATURES.standard.map((f) => f.text)).toContain(PAID_FEATURE_NAME);
		// プレミアムでも同じ機能が解放される。旧称「特別なごほうび設定（即時付与）」は
		// 応援の即時付与と読めるうえ、料金表と別の名前だった (#4705 で他は是正済み)。
		const familyTexts = PREMIUM_UNLOCKED_FEATURES.family.map((f) => f.text);
		expect(familyTexts).toContain(PAID_FEATURE_NAME);
		expect(familyTexts).not.toContain('特別なごほうび設定（即時付与）');
	});

	it('旧名称「オリジナルごほうびの登録」が料金表・案内のどの文言にも残らない', () => {
		const surfaces: string[] = [
			...Object.values(LP_PRICING_PHASEB_LABELS),
			...Object.values(LP_PAMPHLET_PHASEB_LABELS),
			LP_PRICING_LABELS.faqFreeA,
			...PRICING_PAGE_FEATURES.free,
			...PRICING_PAGE_FEATURES.standard,
			...PRICING_PAGE_FEATURES.family,
			...PREMIUM_UNLOCKED_FEATURES.standard.map((f) => f.text),
			...PREMIUM_UNLOCKED_FEATURES.family.map((f) => f.text),
		].filter((v): v is string => typeof v === 'string');
		const leftovers = surfaces.filter((s) => s.includes(OLD_FEATURE_NAME));
		expect(leftovers).toEqual([]);
	});
});

describe('LP トップのごほうびの説明が料金表と同じ線を引く (ADR-0013)', () => {
	// 「親が設定し」「ごほうびを…細かく調整できます」だけだと、どのプランでもごほうびを自由に
	// 作って点数を変えられると読める (料金表で PO が指摘したのと同じ読み違い)。無料は
	// プリセットから選ぶ、作成・編集 (ポイントの調整を含む) はスタンダード以上、を同じ語で言う。
	const lines = {
		'仕組み 3 (ごほうびショップで交換)': LP_CORELOOP_LABELS.l3Desc,
		設定の自由度: LP_INDEX_PHASEB_LABELS.k46,
	};

	for (const [where, text] of Object.entries(lines)) {
		it(`${where}: 無料でもプリセットから選べることを言う`, () => {
			expect(text).toContain(REWARD_TERMS.preset);
		});

		it(`${where}: 作成・編集 (ポイントの調整を含む) はスタンダード以上だと言う`, () => {
			expect(text).toContain(`${PAID_FEATURE_NAME}は${PLAN_TERMS.standard}以上`);
		});
	}

	it('仕組み 3 は「親が設定し」と、プランを限定せずに言わない', () => {
		expect(LP_CORELOOP_LABELS.l3Desc).not.toContain('親が設定し');
	});
});

describe('#4992 無料プランの「編集」は押す前に理由が読める', () => {
	it('一覧の注記が「編集」はスタンダードプラン以上の機能だと述べる', () => {
		const note = ADMIN_REWARDS_PAGE_LABELS.editLockedNote;
		expect(note).toContain(`「${REWARD_ADMIN_TERMS.edit}」`);
		expect(note).toContain(REWARD_ADMIN_TERMS.formPoints);
		expect(note).toContain(`${PLAN_FULL_TERMS.standard}以上`);
	});

	it('ページガイドが、無料プランでは「編集」にも鍵マークが付くことを案内する', () => {
		const [tip] = PAGE_GUIDE_LABELS.adminRewards.steps['rewards-intro'].tips;
		expect(tip).toContain(PLAN_GATE_LABELS.standardOrAboveFor(CUSTOM_REWARD_FEATURE_NAME));
		expect(tip).toContain(`「${REWARD_ADMIN_TERMS.edit}」`);
	});
});
