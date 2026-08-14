// tests/unit/domain/cancel-vs-deletion-terminology.test.ts (#4496)
//
// 解約 (サブスクリプションの自動更新停止) と 退会 (アカウント削除) の混同を機械検出する。
//
// 実装事実:
//   - 解約 = 期末解約モデル (#3991、cancel_at_period_end=true)。**データは削除されない**。
//     期末に無料プランへ自動移行し、無料プランの保持期間 (PLAN_HISTORY_RETENTION_DAYS.free) を
//     超えた記録だけが retention-cleanup-service により**物理削除**される (復元不能)。
//   - 退会 = DELETION_GRACE_PERIOD_DAYS (free 0 / standard 7 / family 30) の経過後に物理削除。
//
// これが無いと「退会の猶予期間を解約の説明に転用する」誤り (#4496 の 14 箇所) が再発し、
// 特商法・LP・アプリ内 FAQ に事実と異なる削除予告が載る (legal リスク + 解約抑止のダークパターン)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// LP 生成側の実処理 (.mjs script) をそのまま検査する
import { buildDeletionGraceTerms } from '../../../scripts/generate-lp-labels.mjs';
import {
	DELETION_GRACE_PERIOD_DAYS,
	formatDeletionGracePeriod,
} from '../../../src/lib/domain/constants/deletion-grace';
import { PLAN_HISTORY_RETENTION_DAYS } from '../../../src/lib/domain/constants/plan-retention';
import {
	CANCELLATION_LABELS,
	LP_FAQ_LABELS,
	LP_FAQ_PHASEB_LABELS,
	LP_LEGAL_DISCLAIMER_LABELS,
	LP_LEGAL_TERMS_LABELS,
	LP_LEGAL_TOKUSHOHO_LABELS,
	LP_PRICING_LABELS,
	PRICING_PAGE_LABELS,
	SETTINGS_LABELS,
	SUBSCRIPTION_PAGE_LABELS,
} from '../../../src/lib/domain/labels';
import { DELETION_GRACE_TERMS, PLAN_RETENTION_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

/**
 * PO レビュー会議 (#4495) の採択条件。婉曲表現「閲覧不可」で止めず、物理削除であることまで
 * 述べる (#4507 の削除予告メール文言「復元不能」との文書間整合)。
 */
const IRREVERSIBLE_SENTENCE = `${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）`;

describe('解約 / 退会 の用語分離 (#4496)', () => {
	describe('退会猶予日数の atom は値 SSOT から導出される', () => {
		it('formatDeletionGracePeriod は 0 を「即時」と表す', () => {
			expect(formatDeletionGracePeriod(0)).toBe('即時');
			expect(formatDeletionGracePeriod(0, { spaced: true })).toBe('即時');
			expect(formatDeletionGracePeriod(7)).toBe('7日');
			expect(formatDeletionGracePeriod(30, { spaced: true })).toBe('30 日');
		});

		it('DELETION_GRACE_TERMS は DELETION_GRACE_PERIOD_DAYS を整形したもの', () => {
			expect(DELETION_GRACE_TERMS.free).toBe(
				formatDeletionGracePeriod(DELETION_GRACE_PERIOD_DAYS.free),
			);
			expect(DELETION_GRACE_TERMS.standard).toBe(
				formatDeletionGracePeriod(DELETION_GRACE_PERIOD_DAYS.standard),
			);
			expect(DELETION_GRACE_TERMS.standardSpaced).toBe(
				formatDeletionGracePeriod(DELETION_GRACE_PERIOD_DAYS.standard, { spaced: true }),
			);
			expect(DELETION_GRACE_TERMS.premium).toBe(
				formatDeletionGracePeriod(DELETION_GRACE_PERIOD_DAYS.family),
			);
			expect(DELETION_GRACE_TERMS.premiumSpaced).toBe(
				formatDeletionGracePeriod(DELETION_GRACE_PERIOD_DAYS.family, { spaced: true }),
			);
		});

		it('LP 生成 script が同じ値 SSOT から同じ atom を組み立てる', () => {
			expect(buildDeletionGraceTerms()).toEqual({
				free: DELETION_GRACE_TERMS.free,
				standard: DELETION_GRACE_TERMS.standard,
				standardSpaced: DELETION_GRACE_TERMS.standardSpaced,
				premium: DELETION_GRACE_TERMS.premium,
				premiumSpaced: DELETION_GRACE_TERMS.premiumSpaced,
			});
		});

		it('server 側 grace-period-service は値を再定義せず domain leaf を re-export する', () => {
			const src = repoFile('src/lib/server/services/grace-period-service.ts');
			expect(src).not.toMatch(/DELETION_GRACE_PERIOD_DAYS[^=]*=\s*\{/);
			expect(src).toContain("from '$lib/domain/constants/deletion-grace'");
		});
	});

	describe('解約の説明にデータ削除を結びつけない (変異試験の対象)', () => {
		// 「解約すると (猶予期間後に) すべてのデータが削除される」型の文が復活したら落ちる。
		const cancellationTexts: Array<[string, string]> = [
			['アプリ /pricing FAQ', PRICING_PAGE_LABELS.faqCancelA],
			['LP pricing FAQ', LP_PRICING_LABELS.faqCancelA],
			['LP pricing hero 打消し表示', LP_PRICING_LABELS.heroCancelDisclaimer],
			['LP pricing 解約 vs 退会 FAQ', LP_PRICING_LABELS.faqCancelVsDeleteA],
			['LP index / pamphlet 打消し表示', LP_LEGAL_DISCLAIMER_LABELS.cancelDisclaimer],
			['LP faq (text)', LP_FAQ_LABELS.text19],
			['LP faq (k)', LP_FAQ_PHASEB_LABELS.k19],
			['解約確認画面 (有料)', CANCELLATION_LABELS.paidPlanNotice],
			['解約確認画面 (無料)', CANCELLATION_LABELS.freePlanNotice],
		];

		it.each(cancellationTexts)('%s は「解約でデータが消える」と述べない', (_name, text) => {
			expect(text).not.toMatch(/解約[^。]*すべてのデータ[^。]*削除/);
			expect(text).not.toMatch(/解約[^。]*同時にデータが削除/);
			// 退会の猶予日数を解約の説明に転用していないこと (#4496 根本原因)
			expect(text).not.toMatch(
				new RegExp(`解約[^。]*${DELETION_GRACE_PERIOD_DAYS.standard} ?日[^。]*猶予`),
			);
		});

		it('解約 FAQ は「削除されない」ことを明示する', () => {
			expect(PRICING_PAGE_LABELS.faqCancelA).toContain('データは削除されません');
			expect(LP_PRICING_LABELS.faqCancelA).toContain('データは削除されません');
			expect(LP_FAQ_PHASEB_LABELS.k19).toContain('データは削除されません');
			expect(LP_FAQ_LABELS.text19).toContain('データは削除されません');
		});

		it('解約 FAQ / 特商法 は保持期間超過分の物理削除と復元不能まで述べる (PO 採択条件)', () => {
			// 婉曲表現 (閲覧不可) で止めない — 実装は物理削除であり、#4507 のメール文言と整合させる
			expect(PRICING_PAGE_LABELS.faqCancelA).toContain(IRREVERSIBLE_SENTENCE);
			expect(LP_PRICING_LABELS.faqCancelA).toContain(IRREVERSIBLE_SENTENCE);
			expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).toContain(IRREVERSIBLE_SENTENCE);
		});

		it('解約確認画面は手続き前に「期末まで利用可能」「日割り返金なし」を述べる', () => {
			expect(CANCELLATION_LABELS.paidPlanNotice).toContain('現在の請求期間の終了日までは');
			expect(CANCELLATION_LABELS.paidPlanNotice).toContain('日割り計算による返金はありません');
		});

		it('無料プラン解約画面はアカウント削除を義務として提示しない', () => {
			expect(CANCELLATION_LABELS.freePlanNotice).not.toContain('削除する必要があります');
			// 解約と退会が別手続きであることを述べる
			expect(CANCELLATION_LABELS.freePlanNotice).toContain('退会');
		});
	});

	describe('特商法 (tokushoho) の返品・キャンセル欄が自己矛盾しない', () => {
		const cell = LP_LEGAL_TOKUSHOHO_LABELS.tableContent;

		it('期末まで利用可能 / 日割り返金なし を述べる', () => {
			expect(cell).toContain('現在の請求期間の終了日まで引き続きご利用いただけます');
			expect(cell).toContain('日割り計算による返金は行いません');
		});

		it('解約でデータが削除されないことを述べる', () => {
			expect(cell).toContain('解約によってお客様のデータが削除されることはありません');
			expect(cell).not.toContain('解約と同時にデータが削除されます');
			expect(cell).not.toMatch(/解約後のデータ削除について/);
		});

		it('完全削除は退会に紐づき、猶予はプラン別 SSOT から述べる', () => {
			expect(cell).toContain(`${DELETION_GRACE_TERMS.free}削除`);
			expect(cell).toContain(`${DELETION_GRACE_TERMS.standardSpaced}間`);
			expect(cell).toContain(`${DELETION_GRACE_TERMS.premiumSpaced}間`);
		});
	});

	describe('退会 (アカウント削除) の猶予はプラン別に述べる', () => {
		it('LP FAQ の退会説明が一律 30 日と述べない', () => {
			for (const text of [LP_FAQ_PHASEB_LABELS.k76, LP_FAQ_LABELS.text76]) {
				expect(text).not.toContain('申請後 30 日間の猶予期間があり');
				expect(text).toContain(`${DELETION_GRACE_TERMS.free}削除`);
				expect(text).toContain(`${DELETION_GRACE_TERMS.standardSpaced}間`);
				expect(text).toContain(`${DELETION_GRACE_TERMS.premiumSpaced}間`);
			}
		});

		it('無料プランは取消し不可であることを述べる', () => {
			for (const text of [LP_FAQ_PHASEB_LABELS.k77, LP_FAQ_LABELS.text77]) {
				expect(text).toContain('申請と同時に削除される');
			}
		});

		it('汎用の削除警告は猶予の有無を断定しない (無料プランと矛盾させない)', () => {
			// 直下に並ぶ accountDeleteGraceNotice が「猶予期間がありません」と述べる無料プランで、
			// 汎用警告が「猶予期間の経過後は」と書いていると同一画面で自己矛盾する (#4496 自己レビュー)。
			expect(SETTINGS_LABELS.accountDeleteOwnerWarning).not.toContain('猶予期間');
			expect(SETTINGS_LABELS.accountDeleteOwnerWarning).toContain('復旧できません');
		});

		it('退会画面はプラン別猶予を手続き前に述べる (無料は猶予なし)', () => {
			expect(SETTINGS_LABELS.accountDeleteGraceNotice(0)).toContain('猶予期間がありません');
			expect(SETTINGS_LABELS.accountDeleteGraceNotice(0)).toContain('取り消しはできません');
			expect(
				SETTINGS_LABELS.accountDeleteGraceNotice(DELETION_GRACE_PERIOD_DAYS.standard),
			).toContain(`${DELETION_GRACE_PERIOD_DAYS.standard} 日間は「復元」ボタンで取り消せます`);
		});

		// #4524: 同意チェックの文言は猶予 notice と同じ事実を述べる。旧実装はプラン非依存の
		//   固定文で「元に戻せません」と断定しており、猶予のある有料プランでは直上の notice と
		//   同一画面で正面から矛盾していた (最も不可逆性の高い操作の直前で警告が信用を失う)。
		it('同意チェックは有料プランで「元に戻せません」と断定しない', () => {
			const paid = SETTINGS_LABELS.accountDeleteDangerConsentLabel(
				DELETION_GRACE_PERIOD_DAYS.standard,
			);
			expect(paid).not.toContain('元に戻せません');
			expect(paid).toContain(`${DELETION_GRACE_PERIOD_DAYS.standard} 日以内`);
			expect(paid).toContain('「復元」ボタンで取り消せます');
		});

		it('同意チェックは猶予 0 日 (無料 / 非 owner) で不可逆を明言する', () => {
			// 単純な文言撤去で無料プランの警告を弱めない (#4496 の元の実害を再発させない)
			expect(SETTINGS_LABELS.accountDeleteDangerConsentLabel(0)).toContain('元に戻せません');
		});

		it('同意チェックはプラン未解決時に猶予を断定しない', () => {
			// `?? 'free'` へ倒すと、猶予のある親に「元に戻せません」を見せる誤誘導になる (#4517 整合)
			const unknown = SETTINGS_LABELS.accountDeleteDangerConsentLabel(null);
			expect(unknown).not.toContain('元に戻せません');
			expect(unknown).not.toContain('取り消せます');
			expect(unknown).toContain('削除することに同意します');
		});

		it('同意チェックと猶予 notice が同じ事実を述べる (同一画面で矛盾しない)', () => {
			for (const days of [
				0,
				DELETION_GRACE_PERIOD_DAYS.standard,
				DELETION_GRACE_PERIOD_DAYS.family,
			]) {
				const consent = SETTINGS_LABELS.accountDeleteDangerConsentLabel(days);
				const notice = SETTINGS_LABELS.accountDeleteGraceNotice(days);
				const consentSaysReversible = consent.includes('取り消せます');
				const noticeSaysReversible = notice.includes('取り消せます');
				expect(
					consentSaysReversible,
					`猶予 ${days} 日で consent と notice の可逆性の主張が食い違う: consent="${consent}" / notice="${notice}"`,
				).toBe(noticeSaysReversible);
			}
		});

		it('削除猶予バナーは残日数として述べる (引数は daysRemaining)', () => {
			expect(SETTINGS_LABELS.deletionGraceDesc(3, '2026-08-15')).toBe(
				'あと 3 日（2026-08-15）ですべてのデータが完全に削除されます。それまでであれば「復元」ボタンで取り消せます。',
			);
			// 「お手続きから N 日後」= 経過日数としての誤読を復活させない
			expect(SETTINGS_LABELS.deletionGraceDesc(3, '2026-08-15')).not.toContain('お手続きから');
		});
	});

	describe('S5 (解約済み) と S6 (退会済み) が表示上区別できる', () => {
		it('ステータスバッジが同一文字列にならない', () => {
			expect(SUBSCRIPTION_PAGE_LABELS.statusTerminated).not.toBe(
				SUBSCRIPTION_PAGE_LABELS.statusCancelled,
			);
		});

		it('S6 は退会語彙で述べる', () => {
			expect(SUBSCRIPTION_PAGE_LABELS.statusTerminated).toContain('退会');
			expect(SUBSCRIPTION_PAGE_LABELS.terminatedTitle).toContain('退会');
			expect(SUBSCRIPTION_PAGE_LABELS.terminatedDesc).toContain('退会');
			expect(SUBSCRIPTION_PAGE_LABELS.terminatedDesc).not.toContain('解約');
		});
	});

	describe('解約経路の記述が 3 文書で一致する', () => {
		// 実導線: ご家族の見守り画面「プラン・お支払い」→「請求管理ページを開く」(Stripe)
		const ROUTE = 'の「プラン・お支払い」→「請求管理ページを開く」';

		it('特商法 / 利用規約 第7条 / LP FAQ が同じ経路を述べる', () => {
			expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).toContain(ROUTE);
			expect(LP_LEGAL_TERMS_LABELS.section7).toContain(ROUTE);
			expect(LP_FAQ_PHASEB_LABELS.k19).toContain(ROUTE);
		});

		it('旧経路「解約をご検討の方」「設定画面から」を残さない', () => {
			expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).not.toContain('「解約をご検討の方」');
			expect(LP_LEGAL_TERMS_LABELS.section7).not.toContain('本サービスの設定画面から');
			expect(LP_FAQ_PHASEB_LABELS.k19).not.toContain('「解約」から');
		});
	});

	describe('site/*.html の顧客可視テキストに「解約 = データ削除」が残らない', () => {
		// fallback テキスト (SEO / JS 失敗時に表示される) も labels と同じ事実を述べる必要がある。
		// terms.html (利用規約) も対象に含める: 第7条 (解約) / 第13条 (退会の猶予) を本 PR で
		// 書き換えており、同じ混同が最も法的拘束力のある文書で再発しうるため。
		const pages = [
			'index.html',
			'pricing.html',
			'faq.html',
			'tokushoho.html',
			'pamphlet.html',
			'terms.html',
		];

		it.each(pages)('%s に解約とデータ削除を結びつける文が無い', (page) => {
			const html = repoFile(`site/${page}`);
			const offenders = html
				.split('\n')
				.filter((line) => /解約[^。]*すべてのデータ[^。]*削除/.test(line))
				.map((line) => line.trim().slice(0, 200));
			expect(offenders).toEqual([]);
		});

		it('無料プランの保持期間の実値が LP に載っている (SSOT 追随の確認)', () => {
			expect(repoFile('site/pricing.html')).toContain(
				`${PLAN_HISTORY_RETENTION_DAYS.free} 日を超えた記録は削除され`,
			);
		});
	});
});
