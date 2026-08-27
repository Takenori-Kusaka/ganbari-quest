// tests/unit/routes/settings-rules-guide.test.ts
// #4666 (EPIC #4650): 設定 > ごほうび・ボーナスルール のガイドが
//   (a) 説明対象ではない要素を光らせる (b) 存在しない導線を案内する
// という 2 つの class を機械 gate 化する。
//
// 観測された実害:
//   - ③「取り込んだルール」の selector がページ先頭の header (rules-overview) で、
//     ②承認セクションより**上へ視線が戻り**、説明対象の一覧は光らなかった
//   - ①③ が「みんなのテンプレートから取り込んだ」と案内していたが、rule-preset は
//     marketplace の陳列対象 (3 type) に含まれず、その入口は画面上に存在しない
//   - ②の how が「切り替えを操作します」で、実装のボタン名 (即時交換にする /
//     承認を必須に戻す) とも、確認ダイアログがあることとも一致していなかった
//   - 承認待ちをどこで処理するか (/admin/rewards/requests) への導線が無かった

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMIN_RULES_PAGE_LABELS, PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import { isBrowseableMarketplaceType } from '$lib/marketplace/types';
import { SETTINGS_RULES_GUIDE } from '../../../src/routes/(parent)/admin/settings/rules/_guide';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings/rules/+page.svelte');

const STEPS = PAGE_GUIDE_LABELS.adminSettingsRules.steps;
type GuideStepText = {
	title: string;
	what: string;
	how: string;
	goal: string;
	tips?: readonly string[];
};
const textOf = (id: keyof typeof STEPS): string => {
	const s = STEPS[id] as GuideStepText;
	return [s.title, s.what, s.how, s.goal, ...(s.tips ?? [])].join('\n');
};
const ALL_TEXT = (Object.keys(STEPS) as (keyof typeof STEPS)[]).map(textOf).join('\n');

describe('#4666 ごほうび・ボーナスルールのガイドが実画面と一致する', () => {
	// 一覧 step が header ではなく一覧そのものを指すこと = 今回の不具合そのもの。
	it('[R1] 一覧 step が一覧 / 空状態を包む常在ラッパーを指す', () => {
		const step = SETTINGS_RULES_GUIDE.steps.find((s) => s.id === 'settings-rules-list');
		expect(step?.selector).toBe('[data-tutorial="rules-bonus-list"]');
	});

	// step 順が DOM 順 (header → 承認 → 一覧) と一致する = 視線が上へ戻らない。
	it('[R2] step の anchor がページ内の出現順と同じ', () => {
		const source = fs.readFileSync(PAGE, 'utf8');
		const positions = SETTINGS_RULES_GUIDE.steps
			.map((s) => s.selector?.match(/data-tutorial="([a-z0-9-]+)"/)?.[1])
			.filter((a): a is string => a !== undefined)
			.map((anchor) => ({ anchor, at: source.indexOf(`data-tutorial="${anchor}"`) }));
		for (const p of positions) {
			expect(p.at, `anchor "${p.anchor}" がページに無い`).toBeGreaterThanOrEqual(0);
		}
		const order = positions.map((p) => p.at);
		expect(order, `step 順とページ内の出現順が食い違う: ${positions.map((p) => p.anchor)}`).toEqual(
			[...order].sort((a, b) => a - b),
		);
	});

	// rule-preset は marketplace の陳列対象ではない = 「探して取り込む」入口が無い。
	// 前提が変わった (陳列に戻った) ら [R4] を見直す合図として固定する。
	it('[R3] rule-preset は marketplace の陳列対象ではない（前提の固定）', () => {
		expect(isBrowseableMarketplaceType('rule-preset')).toBe(false);
	});

	it('[R4] 存在しない取込導線（みんなのテンプレートから探す）を案内していない', () => {
		expect(ALL_TEXT, 'marketplace から取り込む前提の文言が残っている').not.toMatch(
			/みんなのテンプレート/,
		);
	});

	it('[R5] 承認 step が実ボタン名と初期設定・確認ダイアログに触れている', () => {
		const text = textOf('settings-rules-approval');
		expect(text).toContain(ADMIN_RULES_PAGE_LABELS.rewardApprovalEnableInstantButton);
		expect(text).toContain(ADMIN_RULES_PAGE_LABELS.rewardApprovalDisableInstantButton);
		expect(text, '初期設定が承認必須であることに触れていない').toMatch(/初期設定/);
		expect(text, '確認ダイアログに触れていない').toMatch(/確認/);
	});

	it('[R6] 承認待ちの処理先への relatedLink がある', () => {
		const step = SETTINGS_RULES_GUIDE.steps.find((s) => s.id === 'settings-rules-approval');
		const linkTargets = (step?.relatedLinks ?? []).map((l) => l.href);
		expect(linkTargets).toContain('/admin/rewards/requests');
		// href が実在すること (死にリンクを作らない)
		expect(
			fs.existsSync(
				path.join(REPO_ROOT, 'src/routes/(parent)/admin/rewards/requests/+page.svelte'),
			),
		).toBe(true);
	});

	it('[R7] 一覧 step がカード内の要素と結果を説明している', () => {
		const text = textOf('settings-rules-list');
		expect(text).toContain(ADMIN_RULES_PAGE_LABELS.enableButton);
		expect(text).toContain(ADMIN_RULES_PAGE_LABELS.disableButton);
		expect(text).toContain(ADMIN_RULES_PAGE_LABELS.removeButton);
		expect(text, '含まれるルールの折りたたみに触れていない').toContain(
			ADMIN_RULES_PAGE_LABELS.rulesLabel,
		);
		expect(text, '削除の不可逆性に触れていない').toMatch(/戻せ(ない|ません)/);
		expect(text, '家族全員に適用される結果を述べていない').toMatch(/家族全員/);
	});

	// #4666 F6 / F7: 同じ操作の別名 (オン・オフ / ON・OFF) と内部語の英字が復活しないこと。
	it('[R8] 有効化 / 無効化 の呼称が 1 つに揃い、確認文に英字の内部語が無い', () => {
		expect(ALL_TEXT, 'ガイドに「オン・オフ」の別名が残っている').not.toMatch(/オン・オフ/);
		expect(ADMIN_RULES_PAGE_LABELS.emptyDesc).not.toMatch(/ON \/ OFF/);
		expect(ADMIN_RULES_PAGE_LABELS.removeConfirm, '内部語 "rule" が顧客に見えている').not.toMatch(
			/\brule\b/,
		);
	});

	it('[R9] 常設要素を指す step に optional を付けていない', () => {
		for (const step of SETTINGS_RULES_GUIDE.steps) {
			expect(step.optional ?? false, `${step.id} に optional が付いている`).toBe(false);
		}
	});
});
