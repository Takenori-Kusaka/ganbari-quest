/**
 * tests/unit/scripts/check-pr-body-evidence-pr-ref.test.ts (#4074、走査節の是正は #4612)
 *
 * 検証対象: `## 検証` に書かれた根拠コマンドの `--pr <番号>` が **その PR 自身**を指しているか。
 *
 * 旧実装では根拠欄が自由記述で、`--pr <番号>` に別 PR / 実在しない PR 番号が書かれていても
 * どの gate も検出しなかった。PR #4063 の AC 検証マップに `npm run pre-ready -- --pr 4059`
 * (= 404、存在しない PR) が書かれたまま `check-pr-body.mjs --pr 4063` が「OK — 違反なし」を
 * 返した (#4074 実測)。宛先違いの証跡で Ready 化を通過できる状態だった。
 *
 * #4612: その #4074 実装は走査対象が `## AC 検証マップ` 節に固定されており、#4305 で同節が
 * テンプレートから消えたあとも直っていなかった。merged PR 200 本 (#4215〜#4573) に判定関数を
 * 当てた結果 **発火 0 / 200** で、`--pr <数字>` が同節に書かれていた body は 4 本しかなかった。
 * 実際の置き場所は `## 検証` (36 本) と旧 `## テスト・品質セルフチェック` (41 本) で、
 * #4074 が狙った宛先違いもそこに 2 件実在した (#4317 の `--pr 4312` / #4278 の `--pr 4276`)。
 * 走査対象を現行テンプレートの検証節 `## 検証` に付け替え、実測 2 件を fixture として固定する。
 */

import { describe, expect, it } from 'vitest';
import {
	checkEvidencePrReferences,
	EVIDENCE_PR_REF_OK_KEY,
	extractEvidencePrNumbers,
} from '../../../scripts/check-pr-body.mjs';

/** #4063 の根拠 (別 PR = 存在しない #4059 を指していた行) を現行テンプレートの節に置いた形。 */
const PR_4063_EVIDENCE_WITH_WRONG_PR = `## 検証

| 検査 | コマンド | 結果 |
|---|---|---|
| unit | \`npx vitest run tests/unit/scripts/crlf-shebang-import.test.ts\` | PASS |
| pre-ready | \`npm run pre-ready -- --pr 4059\` | PASS — §証跡 4 |

## 影響範囲
`;

/** 同じ body の根拠を自 PR 番号に是正したもの (正当な pass 経路)。 */
const PR_4063_EVIDENCE_CORRECT = PR_4063_EVIDENCE_WITH_WRONG_PR.replace('--pr 4059', '--pr 4063');

/** 根拠欄に PR 番号を書かない従来形式 (AC3 後方互換)。 */
const EVIDENCE_WITHOUT_PR_NUMBER = `## 検証

| 検査 | コマンド | 結果 |
|---|---|---|
| unit | \`npx vitest run tests/unit/scripts/foo.test.ts\` | PASS (12 tests) |
| pre-ready | \`npm run pre-ready -- --pr <num>\` | PASS |

## 影響範囲
`;

/** merged PR #4278 実物 (自 PR は 4278 なのに根拠が `--pr 4276`)。#4612 corpus 実測。 */
const MERGED_PR_4278_SHAPE = `## 検証

| 項目 | コマンド | 結果 |
|---|---|---|
| pre-ready | \`npm run pre-ready -- --pr 4276\` | <!-- 実行後に記入 --> |
`;

describe('#4074 検証根拠が指す PR 番号の参照整合 (走査節は #4612 で `## 検証` に是正)', () => {
	it('[E1] 別 PR / 実在しない PR 番号を指す根拠を検出する (実測: --pr 4059 @ PR #4063)', () => {
		const v = checkEvidencePrReferences(PR_4063_EVIDENCE_WITH_WRONG_PR, '4063');
		expect(v).not.toBeNull();
		expect(v?.id).toBe('evidence-pr-mismatch');
		expect(v?.message).toContain('4059');
		expect(v?.message).toContain('4063');
	});

	it('[E2] 根拠が自 PR 番号なら通す (是正後の正当な pass 経路)', () => {
		expect(checkEvidencePrReferences(PR_4063_EVIDENCE_CORRECT, '4063')).toBeNull();
	});

	it('[E3] 根拠欄に PR 番号を書かない従来形式は通す (AC3 後方互換)', () => {
		expect(checkEvidencePrReferences(EVIDENCE_WITHOUT_PR_NUMBER, '4063')).toBeNull();
		// プレースホルダ `<num>` を PR 番号と誤認しない
		expect(extractEvidencePrNumbers(EVIDENCE_WITHOUT_PR_NUMBER)).toEqual([]);
	});

	it('[E4] `## 検証` 外 (背景での他 PR への言及) は対象外 — 誤検出を作らない', () => {
		const body = `## 変更内容

PR #4066 では \`npm run pre-ready -- --pr 4066\` が 2 度連続 red になった。

${EVIDENCE_WITHOUT_PR_NUMBER}`;
		expect(checkEvidencePrReferences(body, '4090')).toBeNull();
	});

	it('[E5] 自 PR 番号が不明 (--body-file dry-run) なら判定しない', () => {
		expect(checkEvidencePrReferences(PR_4063_EVIDENCE_WITH_WRONG_PR, null)).toBeNull();
	});

	it('[E6] 複数の不一致をすべて列挙する (1 件目で打ち切らない)', () => {
		const body = PR_4063_EVIDENCE_WITH_WRONG_PR.replace('--pr <num>', '--pr 1234').replace(
			'| PASS (12 tests) |',
			'| `npm run pre-ready -- --pr 1234` |',
		);
		const withSecond = `${body}\n`.replace(
			'| pre-ready | `npm run pre-ready -- --pr 4059` |',
			'| pre-ready | `npm run pre-ready -- --pr 4059` / `--pr 1234` |',
		);
		const v = checkEvidencePrReferences(withSecond, '4063');
		expect(v?.message).toContain('4059');
		expect(v?.message).toContain('1234');
	});

	it('[E7] `## 検証` 節が無い body では判定しない (missing-required-sections が別途出る)', () => {
		expect(checkEvidencePrReferences('## 変更内容\n\nなし\n', '4063')).toBeNull();
	});

	// --- #4612: corpus 実測で見つかった実物の形を固定する ---

	it('[E8] merged PR #4278 の形 (自 PR 4278 / 根拠 --pr 4276) を検出する', () => {
		const v = checkEvidencePrReferences(MERGED_PR_4278_SHAPE, '4278');
		expect(v?.id).toBe('evidence-pr-mismatch');
		expect(v?.message).toContain('4276');
	});

	it('[E9] 旧走査節 (`## AC 検証マップ`) だけに書かれた不一致はもう見ない (節はテンプレートに無い)', () => {
		const legacyOnly = `## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 |
|---|---|---|---|
| AC1 | 何か | \`npm run pre-ready -- --pr 4059\` | PASS |
`;
		expect(checkEvidencePrReferences(legacyOnly, '4063')).toBeNull();
	});

	// --- #4612: 他 PR のログを意図して載せる正当ケースの逃げ道 ---

	it('[E10] 理由付き宣言があれば通す (merged PR #4519 = 他 PR で不具合を再現したログ)', () => {
		const body = `${MERGED_PR_4278_SHAPE}
<!-- ${EVIDENCE_PR_REF_OK_KEY}: PR #4276 で gate の空振りを再現した実測ログをそのまま載せているため -->
`;
		expect(checkEvidencePrReferences(body, '4278')).toBeNull();
	});

	it('[E11] 宣言があっても理由が stub なら通さない (理由の非強制を作らない、#3956)', () => {
		for (const reason of ['TODO', 'n/a', '短い']) {
			const body = `${MERGED_PR_4278_SHAPE}\n<!-- ${EVIDENCE_PR_REF_OK_KEY}: ${reason} -->\n`;
			const v = checkEvidencePrReferences(body, '4278');
			expect(v?.id).toBe('evidence-pr-mismatch');
			expect(v?.message).toContain('stub');
		}
	});
});
