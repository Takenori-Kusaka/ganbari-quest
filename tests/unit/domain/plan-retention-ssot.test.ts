// tests/unit/domain/plan-retention-ssot.test.ts (#4477)
//
// 履歴保持日数の SSOT (src/lib/domain/constants/plan-retention.ts) が
// 実装 (domain/plan-limits の PLAN_LIMITS) と 表示 (labels.ts / plan-features.ts / LP) の
// 双方に伝播していることを機械検証する。
//
// これが無いと「historyRetentionDays を変えても LP 料金表は 90 日のまま」という
// 二重管理 (顧客に見える価格表が実装と食い違う、ADR-0013 LP truth 違反) が再発する。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// LP 生成側の実処理 (.mjs script) をそのまま検査する
import { buildPlanRetentionTerms } from '../../../scripts/generate-lp-labels.mjs';
import {
	formatRetentionPeriod,
	PLAN_HISTORY_RETENTION_DAYS,
} from '../../../src/lib/domain/constants/plan-retention';
import {
	CANCELLATION_LABELS,
	DELETION_EXPORT_NOTE_LABELS,
	DOWNGRADE_RESOURCE_SELECTOR_LABELS,
	FEATURES_LABELS,
	LP_LEGAL_PRIVACY_LABELS,
	LP_LEGAL_TERMS_LABELS,
	LP_LEGAL_TOKUSHOHO_LABELS,
	LP_PAMPHLET_PHASEB_LABELS,
	LP_PRICING_LABELS,
	LP_PRICING_PHASEB_LABELS,
	SUBSCRIPTION_PAGE_LABELS,
	TRIAL_EMAIL_LABELS,
} from '../../../src/lib/domain/labels';
import { PRICING_PAGE_FEATURES } from '../../../src/lib/domain/plan-features';
import { PLAN_FULL_TERMS, PLAN_RETENTION_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('plan retention days SSOT (#4477)', () => {
	describe('formatRetentionPeriod', () => {
		it('null は無期限', () => {
			expect(formatRetentionPeriod(null)).toBe('無期限');
		});

		it('365 の倍数は年で表す', () => {
			expect(formatRetentionPeriod(365)).toBe('1年');
			expect(formatRetentionPeriod(730)).toBe('2年');
		});

		it('それ以外は日で表す', () => {
			expect(formatRetentionPeriod(90)).toBe('90日');
			expect(formatRetentionPeriod(180)).toBe('180日');
		});

		it('spaced で数値と単位の間に半角スペースを入れる', () => {
			expect(formatRetentionPeriod(90, { spaced: true })).toBe('90 日');
			expect(formatRetentionPeriod(365, { spaced: true })).toBe('1 年');
		});
	});

	describe('atom は SSOT の値から導出される', () => {
		it('PLAN_RETENTION_TERMS は PLAN_HISTORY_RETENTION_DAYS を整形したもの', () => {
			expect(PLAN_RETENTION_TERMS.free).toBe(
				formatRetentionPeriod(PLAN_HISTORY_RETENTION_DAYS.free),
			);
			expect(PLAN_RETENTION_TERMS.freeSpaced).toBe(
				formatRetentionPeriod(PLAN_HISTORY_RETENTION_DAYS.free, { spaced: true }),
			);
			expect(PLAN_RETENTION_TERMS.standard).toBe(
				formatRetentionPeriod(PLAN_HISTORY_RETENTION_DAYS.standard),
			);
			expect(PLAN_RETENTION_TERMS.standardSpaced).toBe(
				formatRetentionPeriod(PLAN_HISTORY_RETENTION_DAYS.standard, { spaced: true }),
			);
		});
	});

	describe('表示文字列に日数が直書きされていない (変異試験の対象)', () => {
		// SSOT の値を変えたら表示も追随することを、「現在値から組み立てた文字列と一致するか」で確かめる。
		// 直書きに戻すと SSOT を変えた瞬間にこの assert が落ちる。
		const free = PLAN_RETENTION_TERMS.free;
		const standard = PLAN_RETENTION_TERMS.standard;

		it('アプリの料金カード機能リスト (plan-features.ts)', () => {
			expect(PRICING_PAGE_FEATURES.free).toContain(`${free}間の履歴保持`);
			expect(PRICING_PAGE_FEATURES.standard).toContain(`${standard}間の履歴保持`);
		});

		it('LP pricing の機能リストと比較表', () => {
			expect(LP_PRICING_PHASEB_LABELS.k7).toBe(`${free}間の履歴保持`);
			expect(LP_PRICING_PHASEB_LABELS.k16).toBe(`${standard}間の履歴保持`);
			expect(LP_PRICING_PHASEB_LABELS.k34).toContain(`<td>${free}</td><td>${standard}</td>`);
		});

		it('LP pamphlet の機能リスト', () => {
			expect(LP_PAMPHLET_PHASEB_LABELS.k35).toContain(`${free}間の履歴保持`);
			expect(LP_PAMPHLET_PHASEB_LABELS.k45).toContain(`${standard}間の履歴保持`);
		});

		it('pricing ページの体験終了後 / 解約 FAQ', () => {
			const spaced = PLAN_RETENTION_TERMS.freeSpaced;
			expect(LP_PRICING_LABELS.trialDataReassureLine3).toContain(
				`スタンダード: ${PLAN_RETENTION_TERMS.standardSpaced}`,
			);
			expect(LP_PRICING_LABELS.trialDataReassureLine2Suffix).toContain(`保持期間（${spaced}）`);
			expect(LP_PRICING_LABELS.faqAfterTrialA).toContain(`保持期間（${spaced}）`);
			expect(LP_PRICING_LABELS.faqCancelVsDeleteA).toContain(`保持期間（${spaced}）`);
		});
	});

	// #4482: 値が SSOT でも「整形」が独自だと、365 の倍数にした瞬間に
	// 料金表は「1年」・こちらは「365日」と食い違う。整形経路も SSOT に寄せる。
	describe('日数を表示する経路は formatRetentionPeriod を経由する (変異試験の対象)', () => {
		// SSOT の型は `number | null` (null = 無期限)。本 describe は「日数が数値のときの整形」を
		// 見るため非 null を要求する。既定値で穴埋めすると SSOT を null にした変異が
		// 黙って通ってしまうので、明示的に落とす。
		const requireDays = (value: number | null, name: string): number => {
			if (value === null) {
				throw new Error(`${name} が null (無期限) では本テストの前提が成立しない`);
			}
			return value;
		};
		const free = requireDays(PLAN_HISTORY_RETENTION_DAYS.free, 'free');
		const standard = requireDays(PLAN_HISTORY_RETENTION_DAYS.standard, 'standard');

		it('/admin/subscription プランカードの「データ保持」', () => {
			expect(FEATURES_LABELS.planStatusCard.retentionDays(free)).toBe(
				`${formatRetentionPeriod(free)}間`,
			);
			expect(FEATURES_LABELS.planStatusCard.retentionDays(standard)).toBe(
				`${formatRetentionPeriod(standard)}間`,
			);
		});

		it('解約時に失うものの一覧', () => {
			expect(SUBSCRIPTION_PAGE_LABELS.churnLostRetentionDays(free)).toBe(
				`${formatRetentionPeriod(free)}以前の記録（削除され、復元できません）`,
			);
		});

		it('ダウングレード確認ダイアログの保持期間短縮警告', () => {
			const warning = DOWNGRADE_RESOURCE_SELECTOR_LABELS.retentionWarning(standard, free);
			// 現プラン / 移行先の両方が SSOT 整形で述べられる
			expect(warning).toContain(formatRetentionPeriod(standard));
			expect(warning).toContain(formatRetentionPeriod(free));
			// 生の日数 (「365日」「90日」) が混ざらない
			expect(warning).not.toMatch(new RegExp(`${standard}日`));

			// 現プラン無制限のケースも整形が壊れない
			expect(DOWNGRADE_RESOURCE_SELECTOR_LABELS.retentionWarning(null, free)).toContain(
				`データ保持期間が無制限から${formatRetentionPeriod(free)}に`,
			);
		});

		it('退会エクスポート JSON の保存期間但し書き (#4473)', () => {
			expect(DELETION_EXPORT_NOTE_LABELS.retentionLimited(free)).toContain(
				`記録の保存期間は${formatRetentionPeriod(free)}間です`,
			);
		});

		it('トライアル終了予告メールの保持期間行', () => {
			// #4507 AC1: 「データ保持期間」→「履歴（記録）の保持期間」。
			// 期限で消えるのは活動記録などの履歴だけで、アカウントやお子さまの登録は消えない。
			// 旧文言だと「登録そのものが 90 日で消える」と読めてしまうため改めた。
			expect(TRIAL_EMAIL_LABELS.freeRetentionLine(free)).toBe(
				`履歴（記録）の保持期間: ${formatRetentionPeriod(free)}`,
			);
			// null (無期限) を「null日」と穴埋めしない
			expect(TRIAL_EMAIL_LABELS.freeRetentionLine(null)).toBe('履歴（記録）の保持期間: 無期限');
		});

		// #4507: 保持期間切れが**物理削除**であることを述べる行。retention-cleanup-service は
		// 行ごと消すので、「閲覧不可」等に婉曲化してはならない (#4496 / #4507 共通基準)。
		it('トライアル終了予告メールの復元不能行', () => {
			const line = TRIAL_EMAIL_LABELS.retentionIrreversibleLine(free);
			// 日数は SSOT 整形を経由する (「90日」を直書きしない)
			expect(line).toContain(formatRetentionPeriod(free));
			// 削除であって閲覧制限ではない、と述べ切る
			expect(line).toContain('削除され');
			expect(line).toContain('復元できません');
			expect(line).toContain('再契約でも戻りません');
			expect(line).not.toContain('閲覧');

			// 無期限プランでは「無期限日を超えたら削除」と述べない
			const unlimited = TRIAL_EMAIL_LABELS.retentionIrreversibleLine(null);
			expect(unlimited).not.toContain('削除');
			expect(unlimited).toContain('上限はありません');
		});
	});

	describe('実装側 (domain/plan-limits) も同じ SSOT を引く', () => {
		it('PLAN_LIMITS の historyRetentionDays に数値 literal を書かない', () => {
			const src = readFileSync(
				resolve(__dirname, '../../../src/lib/domain/plan-limits.ts'),
				'utf-8',
			);
			const assignments = [...src.matchAll(/historyRetentionDays:\s*([^,\n]+)/g)]
				.map((m) => (m[1] ?? '').trim())
				// 型宣言 (`historyRetentionDays: number | null;`) は対象外
				.filter((v) => !v.includes('number'));
			expect(assignments.length).toBeGreaterThan(0);
			for (const value of assignments) {
				expect(value).toMatch(/^PLAN_HISTORY_RETENTION_DAYS\.(free|standard|family)$/);
			}
		});
	});

	describe('LP の静的 JSON-LD も SSOT と一致する', () => {
		// site/index.html の構造化データ (schema.org Offer) は data-lp-key 注入の対象外
		// (crawler 向けに静的である必要がある) ため、生成では同期できない。
		// 代わりに「SSOT の値と食い違ったら CI が落ちる」形で drift を可視化する。
		it('index.html の無料プラン Offer description が現在の保持日数を書いている', () => {
			const html = readFileSync(resolve(__dirname, '../../../site/index.html'), 'utf-8');
			const days = PLAN_HISTORY_RETENTION_DAYS.free;
			expect(html).toContain(`履歴${days}日`);
		});
	});

	// ------------------------------------------------------------------
	// 法務文書が保持期間の事実を述べている (#4844 follow-up)
	//
	// 既存の検査はいずれも「保持期間を述べている文字列」を SSOT と突合するもので、
	// **述べていない文字列は素通り**した。実測: プライバシーポリシー 第1条は
	// 「これらの情報はご契約期間中保存されます」と 3 箇所で述べており、
	// `retention-cleanup-service` が契約中でもプラン別の保持期間で物理削除する事実
	// (スタンダードプランなら 1 年より古い記録が消える) と食い違っていたが、
	// 保持期間の語を 1 つも含まないため上のどの assert にも引っかからなかった。
	//
	// **旧文そのものへの正規表現では塞げない** (adversarial review PR #4852 が変異 2 件で実証):
	//   N1 新しい key に「お預かりした情報は、ご契約のあいだ保存します」を足す → 素通り
	//   N2 既存 key の中に同じ意味の 1 文を言い換えて挿入 → 素通り
	// 依頼された guard は「retention に触れない面 / 別の言い方で契約期間保存を約束する面」の
	// class guard であって、同じ文字列の再発防止ではない。よって 2 段で組む:
	//
	//   [A/B/C] 面 (namespace.key) を宣言集合に分け、**検出集合 == 宣言 ∪ 除外** を要求する。
	//           新しい面が保存を約束したら、どちらかへの登録を強制される (= no-silent-gap)。
	//   [E]     文の構造で禁じる: 「契約 / 加入」と「保存 / 保持 / 保管」が同一文に共存する文は、
	//           同一文に SSOT 由来の期間表現が無い限り violation。言い換えても構造は残る。
	// ------------------------------------------------------------------
	describe('法務文書の保存期間の記述が実装と一致する (#4844 follow-up)', () => {
		/**
		 * 走査対象 namespace (明示)。顧客に配信される法務文書 3 本 + 契約状態の告知 / 解約導線。
		 * ここに無い namespace は本 guard の対象外である (silent gap を隠さないため明記する)。
		 */
		const SCANNED_NAMESPACES: Record<string, Record<string, unknown>> = {
			privacy: LP_LEGAL_PRIVACY_LABELS,
			terms: LP_LEGAL_TERMS_LABELS,
			tokushoho: LP_LEGAL_TOKUSHOHO_LABELS,
		};

		/** [E] は画面側の告知にも効かせる (法務文書と画面で言い方が割れるのを防ぐ)。 */
		const CONTRACT_SCOPE_SCANNED: Record<string, Record<string, unknown>> = {
			...SCANNED_NAMESPACES,
			subscription: SUBSCRIPTION_PAGE_LABELS,
			cancellation: CANCELLATION_LABELS,
		};

		/** 利用者データの保存/保持を約束する文か (面として宣言が要る)。 */
		const STORAGE_PROMISE = /(情報|データ|記録|履歴)[^。]{0,40}(保存|保持|保管)(し|さ|いた)/;
		/** 保存期間の根拠を「契約の存続」に置く文の構造 (言い換えても残る)。 */
		const CONTRACT_TOKEN = /(契約|加入)/;
		const STORAGE_VERB = /(保存|保持|保管)(し|さ|いた)/;
		/** SSOT 由来の期間表現。同一文にこれがあれば「プラン別保持期間を述べたうえでの言及」。 */
		const SSOT_PERIODS = [
			PLAN_RETENTION_TERMS.free,
			PLAN_RETENTION_TERMS.freeSpaced,
			PLAN_RETENTION_TERMS.standard,
			PLAN_RETENTION_TERMS.standardSpaced,
			'無期限',
		];

		/**
		 * [A] 履歴の保存期間を述べる責任を負う面。値は説明 (空を許さない)。
		 * ここに載る面はプラン別の期間を SSOT 整形で述べなければならない。
		 */
		const RETENTION_DISCLOSURE_SURFACES: Record<string, string> = {
			'privacy.section1': 'プライバシーポリシー 第1条 3. 活動データ',
			'terms.section7': '利用規約 第7条7項 プラン別の履歴保持期間',
			'tokushoho.tableContent': '特商法「解約とデータの取扱い」',
		};

		/**
		 * [B] 保存に言及するが**履歴保持期間の話ではない**面と、その理由。
		 * 理由なしで足せない (死に票 allowlist を作らない)。
		 */
		const NON_RETENTION_STORAGE_SURFACES: Record<string, string> = {
			'privacy.section3': '保存「先」(AWS リージョン) の開示。期間の話ではない',
			'privacy.section6_2': '卒業事例公開の承諾記録の保管。活動履歴の保持期間の対象外',
			'privacy.section10': '越境移転の対象範囲の開示。期間の話ではない',
		};

		function entriesOf(namespaces: Record<string, Record<string, unknown>>): [string, string][] {
			const out: [string, string][] = [];
			for (const [ns, obj] of Object.entries(namespaces)) {
				for (const [key, value] of Object.entries(obj)) {
					if (typeof value === 'string') out.push([`${ns}.${key}`, value]);
				}
			}
			return out;
		}

		const legalDocValues = entriesOf(SCANNED_NAMESPACES);
		/** 保存を約束している面 (検出集合)。 */
		const detectedStorageSurfaces = legalDocValues
			.filter(([, value]) => value.split('。').some((s) => STORAGE_PROMISE.test(s)))
			.map(([surface]) => surface);

		it('走査対象が空でない (空振りで緑になるのを防ぐ)', () => {
			expect(legalDocValues.length).toBeGreaterThan(20);
			expect(entriesOf(CONTRACT_SCOPE_SCANNED).length).toBeGreaterThan(legalDocValues.length);
			// 検出器が実際に効いている (何も検出しない正規表現への劣化を防ぐ)
			expect(STORAGE_PROMISE.test('これらの情報はご契約期間中保存されます')).toBe(true);
			expect(STORAGE_PROMISE.test('お預かりした情報は、ご契約のあいだ保存します')).toBe(true);
			expect(detectedStorageSurfaces.length).toBeGreaterThan(0);
		});

		// [C] no-silent-gap。**新しい面が保存を約束したら、宣言か除外への登録を強制する**。
		// 変異 N1 (新 key に「ご契約のあいだ保存します」を足す) はここで落ちる。
		it('[C] 保存を約束する面はすべて宣言済み (retention 開示 or 理由付き除外)', () => {
			const declared = new Set([
				...Object.keys(RETENTION_DISCLOSURE_SURFACES),
				...Object.keys(NON_RETENTION_STORAGE_SURFACES),
			]);
			const undeclared = detectedStorageSurfaces.filter((s) => !declared.has(s));
			expect(
				undeclared,
				[
					'保存/保持を約束しているのに宣言されていない面があります。',
					'履歴の保存期間を述べる面なら RETENTION_DISCLOSURE_SURFACES に、',
					'期間の話でないなら NON_RETENTION_STORAGE_SURFACES に理由付きで登録してください。',
				].join('\n'),
			).toEqual([]);
		});

		// 宣言が腐らないこと (rename / 文面変更で死に票になった宣言を残さない)。
		it('[D] 宣言した面はすべて実在し、実際に保存を約束している', () => {
			const detected = new Set(detectedStorageSurfaces);
			for (const [surface, reason] of Object.entries({
				...RETENTION_DISCLOSURE_SURFACES,
				...NON_RETENTION_STORAGE_SURFACES,
			})) {
				expect(reason.length, `${surface} の説明が短すぎる`).toBeGreaterThan(5);
				expect(detected, `${surface} は保存を約束していない (宣言から外せる)`).toContain(surface);
			}
		});

		// [A] 宣言した retention 開示面は、プラン別の期間を SSOT 整形で述べる。
		it.each(
			Object.entries(RETENTION_DISCLOSURE_SURFACES),
		)('[A] %s は無料プランの保持期間を SSOT 整形で述べる', (surface) => {
			const value = legalDocValues.find(([s]) => s === surface)?.[1] ?? '';
			expect(value, `${surface} が見つからない`).not.toBe('');
			// 組版の都合で spaced / 非 spaced のどちらかを使う (どちらも同じ atom 由来)
			const statesFreeRetention =
				value.includes(PLAN_RETENTION_TERMS.free) ||
				value.includes(PLAN_RETENTION_TERMS.freeSpaced);
			expect(statesFreeRetention, `${surface} が無料プランの保持期間を述べていない`).toBe(true);
		});

		// [E] 「契約の存続」を保存期間の根拠にする文を禁じる。**言い換えても構造は残る**ので、
		// 旧文そのものを狙う正規表現と違い N2 (既存 key への言い換え挿入) も落とせる。
		it('[E] 保存期間の根拠を契約の存続に置かない (実装は契約中でも保持期間で削除する)', () => {
			const offenders: string[] = [];
			for (const [surface, value] of entriesOf(CONTRACT_SCOPE_SCANNED)) {
				for (const sentence of value.split('。')) {
					if (!STORAGE_VERB.test(sentence) || !CONTRACT_TOKEN.test(sentence)) continue;
					if (SSOT_PERIODS.some((p) => sentence.includes(p))) continue;
					offenders.push(
						`${surface} :: ${sentence
							.replace(/<[^>]+>/g, '')
							.trim()
							.slice(0, 80)}`,
					);
				}
			}
			expect(
				offenders,
				[
					'契約の存続を保存期間の根拠にしています。履歴はプラン別の保持期間で物理削除され、',
					'契約が続いていても期間を超えた分は消えます (S4 の免除は一時的な非実行にすぎない)。',
					'プラン別の期間 (PLAN_RETENTION_TERMS 経由) を同じ文で述べてください。',
					...offenders,
				].join('\n'),
			).toEqual([]);
		});

		it('プライバシーポリシー 第1条の活動データがプラン別の保持期間を SSOT 整形で述べる', () => {
			const section1 = LP_LEGAL_PRIVACY_LABELS.section1;
			expect(section1).toContain(`${PLAN_FULL_TERMS.free}: ${PLAN_RETENTION_TERMS.free}間`);
			expect(section1).toContain(`${PLAN_FULL_TERMS.standard}: ${PLAN_RETENTION_TERMS.standard}間`);
			expect(section1).toContain(`${PLAN_FULL_TERMS.premium}: 無期限`);
			// 期限で消えるのは履歴だけ。アカウント / お子さまの登録は保持期間の対象外
			expect(section1).toContain('アカウントが存在するあいだ保存され');
			// 削除であって閲覧制限ではない (#4507 と同じ基準)
			expect(section1).toContain('順次削除します');
			expect(section1).toContain('復元できません');
		});

		// 3 文書が同じ事実を指していること。片方だけ直すと文書間で食い違う。
		it('プライバシーポリシーと利用規約が同じ 3 プランの保持期間を述べる', () => {
			const triple = (doc: string) =>
				[
					doc.includes(`${PLAN_FULL_TERMS.free}: ${PLAN_RETENTION_TERMS.free}間`),
					doc.includes(`${PLAN_FULL_TERMS.standard}: ${PLAN_RETENTION_TERMS.standard}間`),
					doc.includes(`${PLAN_FULL_TERMS.premium}: 無期限`),
				] as const;
			expect(triple(LP_LEGAL_PRIVACY_LABELS.section1)).toEqual([true, true, true]);
			expect(triple(LP_LEGAL_TERMS_LABELS.section7)).toEqual([true, true, true]);
		});

		// 画面 (S3 / S4 の告知) と法務文書が同じ無料プランの保持期間を述べる。
		it('契約状態の告知 (S3 / S4) と特商法が同じ無料プランの保持期間を述べる', () => {
			const notice = SUBSCRIPTION_PAGE_LABELS.freePlanRetentionNotice;
			expect(notice).toContain(PLAN_RETENTION_TERMS.freeSpaced);
			expect(SUBSCRIPTION_PAGE_LABELS.gracePeriodDesc).toContain(notice);
			expect(SUBSCRIPTION_PAGE_LABELS.paymentSuspendedDesc).toContain(notice);
			expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).toContain(notice);
		});

		// S4 の告知は「契約が残っている間は削除しない」と述べる (実装: retention-cleanup が skip)。
		// privacy / terms は「保持期間を超えた記録は削除される」と述べる。両立するのは
		// S4 が一時的な非実行であって保持期間の約束を上書きしないため。順序が逆になると
		// 「消えたのに残ると書いてある」になるので、S4 側は末尾に保持期間の 2 文を置く。
		it('S4 の告知は削除しない事実を述べたうえで、末尾に保持期間の 2 文を置く', () => {
			const desc = SUBSCRIPTION_PAGE_LABELS.paymentSuspendedDesc;
			expect(desc).toContain('ご契約が残っているあいだ、これまでの記録を削除することはありません');
			expect(desc.endsWith(SUBSCRIPTION_PAGE_LABELS.freePlanRetentionNotice)).toBe(true);
		});
	});

	describe('LP 生成 script が同じ値 SSOT から同じ atom を組み立てる', () => {
		it('generate-lp-labels.mjs の PLAN_RETENTION_TERMS は terms.ts と一致する', () => {
			expect(buildPlanRetentionTerms()).toEqual({
				free: PLAN_RETENTION_TERMS.free,
				freeSpaced: PLAN_RETENTION_TERMS.freeSpaced,
				standard: PLAN_RETENTION_TERMS.standard,
				standardSpaced: PLAN_RETENTION_TERMS.standardSpaced,
			});
		});
	});
});
