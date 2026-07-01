// tests/unit/domain/labels-plan-literal-ratchet.test.ts
// #3359 (ADR-0045 §3.3 / ADR-0061 §2 class-lock): labels.ts の compound 内 plan 名 atom 直書き ratchet。
//
// 背景: `src/lib/domain/labels.ts` は check-no-plan-literals の allowlist (#1918) で **全体 exempt** されている
// (compound 組立て layer = terms.ts atom を参照する想定のため)。しかし実際には compound 値の中に
// 'スタンダードプラン' / '無料プラン' 等の atom 値を直書きした compound が散在し、ADR-0045 §3.3
// (atom 値は `${PLAN_FULL_TERMS.*}` で参照、文字列直書き禁止) に違反していても CI で検出されない gap がある。
// #3359 監査 (arch-3) はこの 1 instance (賞状/成長記録ブック tips の '無料プラン') を指摘したが、instance
// パッチのみでは同型違反が再び追加され follow-up を生む (ADR-0061 §2 same-class-N→guard 違反)。
//
// 本 ratchet は plan 名 literal の「**新規追加**」を機械的に封じる (generator stop)。検出は専用の脆い
// regex を新設せず、実績ある check-no-plan-literals.mjs の `checkFile` (block-comment 追跡 + 行末コメント
// 除外を内包) を再利用する (#1442 使い捨て script 禁止)。allowlist は `main()` 内 `shouldExclude` で効くため、
// `checkFile` を直接呼べば labels.ts も走査できる。
//
// baseline = 既存 33 件を pin。これは FAQ / 利用規約 / トライアル説明など自然文に grammatically 埋め込まれた
// pre-existing literal + 'ファミリープラン' naming-drift (atom `PLAN_FULL_TERMS.family` は 'プレミアムプラン'
// を返すため `${...}` 置換で文言が変わってしまい単純変換不可) を含む。これらの削減は別 cleanup で baseline を
// 下げる (base-token-routes-ratchet #3152 / lp-removal-residue #1790 と同型の ratchet 運用)。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkFile } from '../../../scripts/check-no-plan-literals.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LABELS_TS = path.join(REPO_ROOT, 'src/lib/domain/labels.ts');

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
// 既存削減で実数が下回ったら本値を実数へ下げる (ratchet down のみ許可)。
const BASELINE = 33;

describe('labels.ts plan-name literal ratchet (#3359, ADR-0045/ADR-0061)', () => {
	it('compound 内の plan 名 atom 直書きが baseline 以下である (新規追加を禁止する class-lock)', () => {
		const findings = checkFile(LABELS_TS).filter((f) => PLAN_NAME_PATTERNS.includes(f.pattern));
		const detail = findings.map((f) => `  L${f.line} ${f.pattern}: ${f.snippet}`).join('\n');
		expect(
			findings.length,
			`labels.ts の plan 名直書きが baseline (${BASELINE}) を超えました (実数 ${findings.length})。\n` +
				"新規 compound は 'スタンダードプラン' 等を直書きせず PLAN_FULL_TERMS.standard を template literal で参照してください " +
				'(ADR-0045 §3.3)。既存削減で baseline を下回った場合は本 BASELINE を実数へ下げてください。\n' +
				detail,
		).toBeLessThanOrEqual(BASELINE);
	});
});
