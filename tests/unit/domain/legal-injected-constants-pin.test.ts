// tests/unit/domain/legal-injected-constants-pin.test.ts (#4540 Q7)
//
// ⚠️ この値は特商法・利用規約に自動注入される。変更は約款変更にあたるため、周知の要否を判断すること。
//
// 本 file が落ちたということは、顧客と交わしている約款の記載内容が変わったということである。
// test を現在値に書き換えるだけでは済まない。**周知 (掲示・メール等) の要否を判断**し、
// 判断の結果を PR に残してから書き換えること (判断者は PO / オーナー)。
//
// なぜ test で担保するのか (#4540 Q7 PO 決裁):
//   猶予日数 / 保持日数は domain 定数を 1 箇所直せば、生成を経て特商法・利用規約の本文まで
//   自動で書き換わる。自動注入それ自体は正しい (実装と約款の食い違いを防ぐ) が、
//   「気づかずに約款を変えられる」状態が残っていた。CODEOWNERS による承認点の追加は
//   本リポジトリの承認体制 (オーナー + lab の 2 アカウントが全 PR を見ている、ADR-0022) では
//   承認点が 1 つも増えないため不採用。代わりに**値を pin して必ず落とす**ことで、
//   変更者が「これは約款変更である」と気づく地点を作る。
//
// 既存 test との分担:
//   - 値 → atom → 表示文字列 の追随: cancel-vs-deletion-terminology.test.ts (#4496) /
//     plan-retention-ssot.test.ts (#4477) が担う。本 file はそれらを繰り返さない。
//   - 本 file の担当は 2 点のみ: (1) 値そのものの pin、(2) **法定表示への注入経路が実在すること**。
//     値を pin しても注入経路が消えていれば pin の意味 (= 約款が動く) が変わるため、
//     経路の生存も同じ file で見る。
//   - grace-period-service.test.ts も猶予日数を pin しているが、あちらは server service の
//     単体 test であり「約款変更である」という文脈を持たない。文脈を持つ pin は本 file が正。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DELETION_GRACE_PERIOD_DAYS } from '../../../src/lib/domain/constants/deletion-grace';
import { PLAN_HISTORY_RETENTION_DAYS } from '../../../src/lib/domain/constants/plan-retention';
import { LP_LEGAL_TERMS_LABELS, LP_LEGAL_TOKUSHOHO_LABELS } from '../../../src/lib/domain/labels';
import { DELETION_GRACE_TERMS, PLAN_RETENTION_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

/**
 * 失敗メッセージの共通前文。落ちた人が最初に読む場所なので、
 * 「何をしてはいけないか」ではなく「何を判断すべきか」を書く。
 */
const LEGAL_CHANGE_NOTICE = [
	'この値は特商法・利用規約に自動注入される。変更は約款変更にあたるため、周知の要否を判断すること。',
	'注入経路: src/lib/domain/constants/{deletion-grace,plan-retention}.ts',
	'  → src/lib/domain/terms.ts (DELETION_GRACE_TERMS / PLAN_RETENTION_TERMS)',
	'  → src/lib/domain/labels.ts (LP_LEGAL_TERMS_LABELS.section13 / LP_LEGAL_TOKUSHOHO_LABELS.tableContent)',
	'  → scripts/generate-lp-labels.mjs (buildDeletionGraceTerms / buildPlanRetentionTerms)',
	'  → site/shared-labels.js (生成物、コミット対象)',
	'  → site/terms.html (第13条) / site/tokushoho.html (返品・キャンセル欄) の data-lp-key 注入',
	'値を変える PR では、周知の要否の判断結果を PR 本文に残したうえで本 test を更新すること。',
].join('\n');

/** site/shared-labels.js (生成物) から namespace.key の値を取り出す。 */
function sharedLabel(namespace: string, key: string): string {
	const src = repoFile('site/shared-labels.js');
	const nsStart = src.indexOf(`"${namespace}": {`);
	if (nsStart < 0) {
		throw new Error(
			`site/shared-labels.js に namespace "${namespace}" が無い。法定表示への注入経路が壊れている。\n${LEGAL_CHANGE_NOTICE}`,
		);
	}
	const nsEnd = src.indexOf('\n\t\t}', nsStart);
	const block = src.slice(nsStart, nsEnd < 0 ? undefined : nsEnd);
	const matched = block.match(new RegExp(`"${key}": ("(?:[^"\\\\]|\\\\.)*")`));
	if (!matched?.[1]) {
		throw new Error(
			`site/shared-labels.js の ${namespace}.${key} を取り出せない。法定表示への注入経路が壊れている。\n${LEGAL_CHANGE_NOTICE}`,
		);
	}
	return JSON.parse(matched[1]) as string;
}

describe('法定表示に注入される定数の pin (#4540 Q7)', () => {
	describe('値の pin — 変えたら必ず落ちる', () => {
		it('退会 (アカウント削除) の猶予日数', () => {
			// free 0 = 申請と同時に物理削除 (取消し不可)。この 0 は特商法に
			// 「無料プランは猶予期間がなくお申し込みと同時に削除されます」として載っている。
			expect(DELETION_GRACE_PERIOD_DAYS, LEGAL_CHANGE_NOTICE).toEqual({
				free: 0,
				standard: 7,
				family: 30,
			});
		});

		it('プラン別の履歴保持日数', () => {
			// null = 無期限。free 90 は特商法の「解約とデータの取扱い」欄に載っている。
			expect(PLAN_HISTORY_RETENTION_DAYS, LEGAL_CHANGE_NOTICE).toEqual({
				free: 90,
				standard: 365,
				family: null,
			});
		});
	});

	describe('注入経路が実在する — 経路が消えたら pin の意味が変わる', () => {
		it('利用規約 第13条 (アカウント削除) が現在の猶予日数を述べている', () => {
			const section13 = LP_LEGAL_TERMS_LABELS.section13;
			for (const term of [
				DELETION_GRACE_TERMS.free,
				DELETION_GRACE_TERMS.standard,
				DELETION_GRACE_TERMS.premium,
			]) {
				expect(section13, LEGAL_CHANGE_NOTICE).toContain(term);
			}
		});

		it('特商法 返品・キャンセル欄が現在の猶予日数と保持日数を述べている', () => {
			const cell = LP_LEGAL_TOKUSHOHO_LABELS.tableContent;
			for (const term of [
				DELETION_GRACE_TERMS.free,
				DELETION_GRACE_TERMS.standardSpaced,
				DELETION_GRACE_TERMS.premiumSpaced,
				PLAN_RETENTION_TERMS.freeSpaced,
			]) {
				expect(cell, LEGAL_CHANGE_NOTICE).toContain(term);
			}
		});

		it('生成物 site/shared-labels.js に同じ値が載っている', () => {
			// labels.ts を直しても再生成を忘れれば、顧客が読む HTML は旧値のまま残る。
			// (再生成漏れ自体は pre-ready の generate-lp-labels --check が別途 hard-fail する)
			expect(sharedLabel('legalTerms', 'section13'), LEGAL_CHANGE_NOTICE).toContain(
				DELETION_GRACE_TERMS.standard,
			);
			const tokushoho = sharedLabel('legalTokushoho', 'tableContent');
			expect(tokushoho, LEGAL_CHANGE_NOTICE).toContain(DELETION_GRACE_TERMS.standardSpaced);
			expect(tokushoho, LEGAL_CHANGE_NOTICE).toContain(PLAN_RETENTION_TERMS.freeSpaced);
		});

		it('法務 HTML が注入先の data-lp-key を保持している', () => {
			// data-lp-key が外れると、生成物が正しくても顧客が読む本文は fallback 直書きのまま
			// 固定される (= 値を変えても約款が動かない)。pin の前提が崩れるので同時に見る。
			expect(repoFile('site/terms.html'), LEGAL_CHANGE_NOTICE).toContain(
				'data-lp-key="legalTerms.section13"',
			);
			expect(repoFile('site/tokushoho.html'), LEGAL_CHANGE_NOTICE).toContain(
				'data-lp-key="legalTokushoho.tableContent"',
			);
		});
	});
});
