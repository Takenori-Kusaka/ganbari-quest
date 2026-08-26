// tests/unit/domain/family-member-limit-terminology.test.ts (#4500)
//
// 家族メンバー上限の「合計」と「招待できる人数」の取り違えを機械検出する。
//
// 実装事実:
//   FAMILY_MEMBER_LIMIT.standard = 4 は **owner を含む合計**。`checkFamilyMemberLimit` は
//   `members.length < 4` で招待作成を拒否するため、**実際に招待できるのは 3 人**。
//
// これが無いと「合計 4」を「招待 4 人まで」と訴求する誤り (#4500 の 10 label) が再発し、
// プラン選択の判断材料が 1 人分過大になる (ADR-0013 LP truth 違反 / money・high)。
// 数値の複製も同時に禁じる — 表示側に 4 を直書きすると本 test が落ちる。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// LP 生成側の実処理 (.mjs script) をそのまま検査する
import { buildFamilyMemberLimitTerms } from '../../../scripts/generate-lp-labels.mjs';
import {
	FAMILY_MEMBER_LIMIT,
	formatMemberCount,
	invitesAllowedFrom,
} from '../../../src/lib/domain/constants/family-member-limit';
import {
	LP_FAQ_PHASEB_LABELS,
	LP_PRICING_LABELS,
	PLAN_GATE_LABELS,
} from '../../../src/lib/domain/labels';
import { FAMILY_MEMBER_LIMIT_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

const STANDARD_TOTAL = FAMILY_MEMBER_LIMIT.standard ?? 0;

describe('#4500 家族メンバー上限 — 合計と招待可能数', () => {
	describe('値 SSOT からの導出', () => {
		it('invitesAllowedFrom は owner の 1 枠を差し引く', () => {
			expect(invitesAllowedFrom(4)).toBe(3);
			expect(invitesAllowedFrom(1)).toBe(0); // free: owner のみ = 招待できない
			expect(invitesAllowedFrom(0)).toBe(0); // 負数にしない
		});

		it('FAMILY_MEMBER_LIMIT_TERMS は FAMILY_MEMBER_LIMIT を整形したもの', () => {
			expect(FAMILY_MEMBER_LIMIT_TERMS.standardTotal).toBe(formatMemberCount(STANDARD_TOTAL));
			expect(FAMILY_MEMBER_LIMIT_TERMS.standardTotalSpaced).toBe(
				formatMemberCount(STANDARD_TOTAL, { spaced: true }),
			);
			expect(FAMILY_MEMBER_LIMIT_TERMS.standardInvites).toBe(
				formatMemberCount(invitesAllowedFrom(STANDARD_TOTAL)),
			);
		});

		it('合計と招待可能数は必ず 1 人ちがう (同一視したことが本 Issue の欠陥)', () => {
			expect(FAMILY_MEMBER_LIMIT_TERMS.standardTotal).not.toBe(
				FAMILY_MEMBER_LIMIT_TERMS.standardInvites,
			);
		});

		it('LP 生成側 (generate-lp-labels.mjs) の再現実装が TS 側と一致する', () => {
			expect(buildFamilyMemberLimitTerms()).toEqual({
				standardTotal: FAMILY_MEMBER_LIMIT_TERMS.standardTotal,
				standardTotalSpaced: FAMILY_MEMBER_LIMIT_TERMS.standardTotalSpaced,
				standardInvites: FAMILY_MEMBER_LIMIT_TERMS.standardInvites,
				standardInvitesSpaced: FAMILY_MEMBER_LIMIT_TERMS.standardInvitesSpaced,
			});
		});
	});

	describe('サーバ実装との一致', () => {
		it('plan-limit-service は数値を直書きせず値 SSOT を参照する', () => {
			const src = repoFile('src/lib/server/services/plan-limit-service.ts');
			expect(src).toContain('FAMILY_MEMBER_LIMIT.standard');
			expect(src, 'maxFamilyMembers に数値を直書きすると LP と二重管理になる').not.toMatch(
				/maxFamilyMembers:\s*\d+/,
			);
		});

		// #4710: 未配線のままプラン条件を持っていた 3 capability (invite.family_member /
		// export.activity_history / purchase.upgrade) は削除された。矛盾しうる定義そのものを
		// 無くしたので、ここでは「policy 層にプラン条件が戻っていない」ことを確認する
		// (述語の再登場の全面検出は capabilities-no-plan-tier-predicate.test.ts が担う)。
		it('capabilities は家族メンバー上限のプラン条件を持たない (SSOT = plan-limit-service)', () => {
			const src = repoFile('src/lib/policy/capabilities.ts');
			expect(src, "旧実装の `tier !== 'family'` 一律 deny は standard の招待を壊す").not.toContain(
				"if (ctx.plan?.tier !== 'family') return deny('plan-tier-insufficient');",
			);
			expect(src, 'プラン条件を policy 層に複製すると片方だけ直る (#4710)').not.toContain(
				"'invite.family_member':",
			);
		});
	});

	describe('顧客に見える文言 (LP / FAQ / 403)', () => {
		/** 「招待は N 人」と読める形になっていること (合計だけを言って終わらない)。 */
		const mentionsInvites = (text: string) =>
			text.includes(FAMILY_MEMBER_LIMIT_TERMS.standardInvites) ||
			text.includes(FAMILY_MEMBER_LIMIT_TERMS.standardInvitesSpaced);

		it('pricing の招待説明が招待可能数に言及する', () => {
			expect(mentionsInvites(LP_PRICING_LABELS.familyPatternInviteDesc)).toBe(true);
			expect(mentionsInvites(LP_PRICING_LABELS.faqMultiDeviceA)).toBe(true);
		});

		it('FAQ の招待説明が招待可能数に言及する', () => {
			expect(mentionsInvites(LP_FAQ_PHASEB_LABELS.k49)).toBe(true);
			expect(mentionsInvites(LP_FAQ_PHASEB_LABELS.k107)).toBe(true);
		});

		it('403 文言が owner 込みの数え方であることを述べる', () => {
			const message = PLAN_GATE_LABELS.memberLimitReached(STANDARD_TOTAL);
			expect(message).toContain('オーナーを含めて');
		});

		it('FAQ k108 に未実装機能 (閲覧権限の割り当て / コメント・スタンプ送付) を書かない', () => {
			const k108 = LP_FAQ_PHASEB_LABELS.k108;
			expect(k108, '招待 role は parent / child の 2 種のみ').not.toContain('閲覧権限を割り当て');
			expect(k108, '招待メンバーから子供へのコメント・スタンプ機能は存在しない').not.toContain(
				'スタンプ送付',
			);
		});
	});

	describe('数値の複製禁止', () => {
		// 「招待 4 人」型の誤表記が復活したら落ちる。合計 4 を語ること自体は正しいので、
		// **招待の文脈に総数が単独で出ている形**だけを禁じる。
		const FORBIDDEN = ['家族メンバー招待：4人まで', '4 人までの招待', '4人まで招待'];

		it.each(FORBIDDEN)('labels.ts に「%s」が無い', (phrase) => {
			expect(repoFile('src/lib/domain/labels.ts')).not.toContain(phrase);
		});

		it.each(FORBIDDEN)('site/shared-labels.js に「%s」が無い (LP 配信物)', (phrase) => {
			expect(repoFile('site/shared-labels.js')).not.toContain(phrase);
		});
	});
});
