// tests/unit/domain/labels-plan-literal-ratchet.test.ts
// #3359 (ADR-0045 §3.3 / ADR-0061 §2 class-lock): labels 層の compound 内 plan 名 atom 直書き ratchet。
//
// 背景: labels 層 (入口 labels.ts + labels/*.ts) は check-no-plan-literals の allowlist (#1918) で **全体 exempt** されている
// (compound 組立て layer = terms.ts atom を参照する想定のため)。しかし実際には compound 値の中に
// 'スタンダードプラン' / '無料プラン' 等の atom 値を直書きした compound が散在し、ADR-0045 §3.3
// (atom 値は `${PLAN_FULL_TERMS.*}` で参照、文字列直書き禁止) に違反していても CI で検出されない gap がある。
// #3359 監査 (arch-3) はこの 1 instance (賞状/成長記録ブック tips の '無料プラン') を指摘したが、instance
// パッチのみでは同型違反が再び追加され follow-up を生む (ADR-0061 §2 same-class-N→guard 違反)。
//
// 本 ratchet は plan 名 literal の「**新規追加**」を機械的に封じる (generator stop)。検出は専用の脆い
// regex を新設せず、実績ある check-no-plan-literals.mjs の `checkFile` (block-comment 追跡 + 行末コメント
// 除外を内包) を再利用する (#1442 使い捨て script 禁止)。allowlist は `main()` 内 `shouldExclude` で効くため、
// `checkFile` を直接呼べば labels 層も走査できる。
//
// baseline は既存の直書きの件数に一致させる。残っているのは FAQ / 利用規約 / トライアル説明など自然文に
// 埋め込まれた pre-existing literal で、削減したら同じ PR で baseline を下げる (2 本目の test が一致を求める)。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkFile } from '../../../scripts/check-no-plan-literals.mjs';
import { labelSourceFiles } from '../../../scripts/lib/parse-labels-ts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// #4965: labels 層は入口 labels.ts + labels/*.ts に分かれている。層全体を合算して数える
// (1 ファイルだけを数えると、他のファイルに置かれた直書きが件数から黙って消える)。
const LABEL_SOURCES = labelSourceFiles();

// PLAN_FULL_TERMS の atom 値 (= ADR-0045 で `${PLAN_FULL_TERMS.*}` 参照すべき plan 名)。
// 価格 (¥500) / トライアル (7日間無料) / 無料訴求 (基本無料) 等の他 atom は #3359 の scope 外
// (別 subset の broader concern) のため本 ratchet では計上しない。
const PLAN_NAME_PATTERNS = [
	'無料プラン',
	'スタンダードプラン',
	'プレミアムプラン',
	'ファミリープラン',
];

// 現状の plan 名直書き件数。**この値を引き上げてはならない** (新規違反の混入を意味する)。
// 既存削減で実数が下回ったら同じ PR で本値を実数へ下げる (ratchet down のみ許可)。
const BASELINE = 17;

function findPlanNameLiterals() {
	return LABEL_SOURCES.flatMap((rel) =>
		checkFile(path.join(REPO_ROOT, rel))
			.filter((f) => PLAN_NAME_PATTERNS.includes(f.pattern))
			.map((f) => ({ ...f, rel })),
	);
}

describe('labels 層 plan-name literal ratchet (#3359, ADR-0045/ADR-0061)', () => {
	it('compound 内の plan 名 atom 直書きが baseline 以下である (新規追加を禁止する class-lock)', () => {
		const findings = findPlanNameLiterals();
		const detail = findings
			.map((f) => `  ${f.rel}:${f.line} ${f.pattern}: ${f.snippet}`)
			.join('\n');
		expect(
			findings.length,
			`labels 層の plan 名直書きが baseline (${BASELINE}) を超えました (実数 ${findings.length})。\n` +
				"新規 compound は 'スタンダードプラン' 等を直書きせず PLAN_FULL_TERMS.standard を template literal で参照してください " +
				'(ADR-0045 §3.3)。既存削減で baseline を下回った場合は本 BASELINE を実数へ下げてください。\n' +
				detail,
		).toBeLessThanOrEqual(BASELINE);
	});

	it('baseline は実数と一致する (削減したら同じ PR で BASELINE を下げる)', () => {
		// 上の test は「超えない」しか見ないため、削減しても BASELINE を据え置くと差分が余白になり、
		// その件数までは新しい直書きが CI を通る。件数が小さいので許容幅は置かず、実数との一致を求める。
		const actual = findPlanNameLiterals().length;
		expect(
			actual,
			`labels 層の plan 名直書きが baseline より少なくなっています (実数 ${actual} / baseline ${BASELINE})。` +
				'BASELINE を実数へ下げてください (引き上げは不可)。',
		).toBe(BASELINE);
	});
});
