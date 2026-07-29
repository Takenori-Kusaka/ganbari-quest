/**
 * tests/unit/scripts/check-pr-body-evidence-pr-ref.test.ts (#4074)
 *
 * 検証対象: AC 検証マップの根拠欄に書かれた `--pr <番号>` が **その PR 自身**を指しているか。
 *
 * 旧実装では根拠欄が自由記述で、`--pr <番号>` に別 PR / 実在しない PR 番号が書かれていても
 * どの gate も検出しなかった。PR #4063 の AC 検証マップに `npm run pre-ready -- --pr 4059`
 * (= 404、存在しない PR) が書かれたまま `check-pr-body.mjs --pr 4063` が「OK — 違反なし」を
 * 返した (#4074 実測)。宛先違いの証跡で Ready 化を通過できる状態だった。
 *
 * 本 test は実測値 `--pr 4059` / 自 PR `4063` を実名 fixture として固定する (AC2)。
 */

import { describe, expect, it } from 'vitest';
import {
	checkEvidencePrReferences,
	extractEvidencePrNumbers,
} from '../../../scripts/check-pr-body.mjs';

/** #4063 の AC 検証マップ実物 (根拠が別 PR = 存在しない #4059 を指していた行を含む)。 */
const PR_4063_AC_MAP_WITH_WRONG_PR = `## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | CRLF shebang import が落ちない | \`npx vitest run tests/unit/scripts/crlf-shebang-import.test.ts\` | PASS |
| 共通-AC | \`npm run pre-ready -- --pr <num>\` 全 Step PASS | \`npm run pre-ready -- --pr 4059\` | PASS — §証跡 4 |

## 次のセクション
`;

/** 同じ body の根拠を自 PR 番号に是正したもの (正当な pass 経路)。 */
const PR_4063_AC_MAP_CORRECT = PR_4063_AC_MAP_WITH_WRONG_PR.replace('--pr 4059', '--pr 4063');

/** 根拠欄に PR 番号を書かない従来形式 (AC3 後方互換)。 */
const AC_MAP_WITHOUT_PR_NUMBER = `## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | gate が落ちる | \`npx vitest run tests/unit/scripts/foo.test.ts\` | PASS (12 tests) |
| 共通-AC | pre-ready 全 Step PASS | \`npm run pre-ready -- --pr <num>\` | PASS |

## 次のセクション
`;

describe('#4074 AC 検証マップの根拠が指す PR 番号の参照整合', () => {
	it('[E1] 別 PR / 実在しない PR 番号を指す根拠を検出する (実測: --pr 4059 @ PR #4063)', () => {
		const v = checkEvidencePrReferences(PR_4063_AC_MAP_WITH_WRONG_PR, '4063');
		expect(v).not.toBeNull();
		expect(v?.id).toBe('evidence-pr-mismatch');
		expect(v?.message).toContain('4059');
		expect(v?.message).toContain('4063');
	});

	it('[E2] 根拠が自 PR 番号なら通す (是正後の正当な pass 経路)', () => {
		expect(checkEvidencePrReferences(PR_4063_AC_MAP_CORRECT, '4063')).toBeNull();
	});

	it('[E3] 根拠欄に PR 番号を書かない従来形式は通す (AC3 後方互換)', () => {
		expect(checkEvidencePrReferences(AC_MAP_WITHOUT_PR_NUMBER, '4063')).toBeNull();
		// プレースホルダ `<num>` を PR 番号と誤認しない
		expect(extractEvidencePrNumbers(AC_MAP_WITHOUT_PR_NUMBER)).toEqual([]);
	});

	it('[E4] AC マップ外 (他 PR への言及) は対象外 — 誤検出を作らない', () => {
		const body = `## 背景

PR #4066 では \`npm run pre-ready -- --pr 4066\` が 2 度連続 red になった。

${AC_MAP_WITHOUT_PR_NUMBER}`;
		expect(checkEvidencePrReferences(body, '4090')).toBeNull();
	});

	it('[E5] 自 PR 番号が不明 (--body-file dry-run) なら判定しない', () => {
		expect(checkEvidencePrReferences(PR_4063_AC_MAP_WITH_WRONG_PR, null)).toBeNull();
	});

	it('[E6] 複数の不一致をすべて列挙する (1 件目で打ち切らない)', () => {
		const body = PR_4063_AC_MAP_WITH_WRONG_PR.replace('--pr <num>', '--pr 1234');
		const v = checkEvidencePrReferences(body, '4063');
		expect(v?.message).toContain('4059');
		expect(v?.message).toContain('1234');
	});

	it('[E7] AC マップが無い body では判定しない (ac-map-missing が別途出る)', () => {
		expect(checkEvidencePrReferences('## 変更概要\n\nなし\n', '4063')).toBeNull();
	});
});
