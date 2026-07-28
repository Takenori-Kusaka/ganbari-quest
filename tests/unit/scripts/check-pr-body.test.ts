/**
 * tests/unit/scripts/check-pr-body.test.ts (#1775 AC2)
 *
 * scripts/check-pr-body.mjs の純粋関数（検出ロジック）の unit test。
 * GitHub API 呼び出し (gh pr view) は本テストでは触れない（--body-file 経路でテスト可能）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	checkAcMap,
	checkChangeTypeSelection,
	checkEnvDistributionForHotfix,
	checkPoDecisionBrief,
	checkPreReadyReceipt,
	checkSelfReviewEvidence,
	claimsPreReadyPass,
	detectMojibake,
	extractAcMapSection,
	extractEnvDistributionSection,
	extractLabelNames,
	extractPoDecisionSection,
	extractRequiredSections,
	FORBIDDEN_TERMS,
	findMissingSections,
	findUncheckedReadyChecklist,
	formatSkippedLabelGates,
	HOTFIX_LABELS,
	hasHotfixLabel,
	hasPoDecisionLabel,
	isPreReadyReceiptGateApplicable,
	LABEL_CONDITIONAL_GATES,
	PO_DECISION_LABEL,
	resolveLabels,
	scanForbiddenTerms,
	stripCodeBlocks,
	stripMarkdownComments,
} from '../../../scripts/check-pr-body.mjs';

describe('extractRequiredSections', () => {
	it('## 見出しを完全一致で抽出する', () => {
		const tpl = `## 顧客価値・目的\n\n本文1\n\n## 関連 Issue\n\n本文2\n\n### サブ見出し\n\n## AC 検証マップ (ADR-0004)\n`;
		const sections = extractRequiredSections(tpl);
		expect(sections).toEqual(['## 顧客価値・目的', '## 関連 Issue', '## AC 検証マップ (ADR-0004)']);
	});

	it('### サブ見出しは抽出しない', () => {
		const tpl = `## 親見出し\n### 子見出し\n#### 孫\n`;
		expect(extractRequiredSections(tpl)).toEqual(['## 親見出し']);
	});
});

describe('findMissingSections', () => {
	it('全セクション存在 → 空配列', () => {
		const body = `## A\n本文\n## B\n本文\n`;
		expect(findMissingSections(body, ['## A', '## B'])).toEqual([]);
	});

	it('括弧書きを削除した完全一致漏れを検出 (#1718/#1746/#1760)', () => {
		const body = `## Quality Manager レビュー結果\n本文\n`;
		const required = ['## Quality Manager レビュー結果（QM が記入 — #1197 / #1198）'];
		expect(findMissingSections(body, required)).toEqual([
			'## Quality Manager レビュー結果（QM が記入 — #1197 / #1198）',
		]);
	});

	it('一部セクションだけ欠落', () => {
		const body = `## A\n本文\n`;
		expect(findMissingSections(body, ['## A', '## B', '## C'])).toEqual(['## B', '## C']);
	});
});

describe('stripCodeBlocks', () => {
	it('fenced code block を除去', () => {
		const body = 'before\n```\n禁止語: 予定\n```\nafter';
		expect(stripCodeBlocks(body)).toBe('before\n\nafter');
	});

	it('言語指定付き fenced code block を除去', () => {
		const body = 'A\n```bash\nnpm run x  # 予定\n```\nB';
		expect(stripCodeBlocks(body)).toBe('A\n\nB');
	});

	it('inline code を除去', () => {
		expect(stripCodeBlocks('text `予定` more')).toBe('text  more');
	});
});

describe('stripMarkdownComments', () => {
	it('単一行コメントを除去', () => {
		expect(stripMarkdownComments('hello <!-- comment --> world')).toBe('hello  world');
	});

	it('複数行コメントを除去', () => {
		const input = 'foo\n<!-- multi\nline\ncomment -->\nbar';
		expect(stripMarkdownComments(input)).toBe('foo\n\nbar');
	});

	it('複数のコメントを全て除去', () => {
		expect(stripMarkdownComments('a <!-- 1 --> b <!-- 2 --> c')).toBe('a  b  c');
	});

	it('シーケンシャルに連続するコメントを反復除去 (CodeQL js/incomplete-multi-character-sanitization 対策)', () => {
		// 1 回 replace で消える基本ケース。反復ロジックが既存動作を壊していないことの担保。
		const input = 'a <!-- 1 --><!-- 2 --> b';
		expect(stripMarkdownComments(input)).toBe('a  b');
	});
});

describe('scanForbiddenTerms (#1763/#1770)', () => {
	it('PR body 全体で禁止語を検出 (AC マップ外も)', () => {
		const body = `
## 設計方針

実装は予定通り進めた。

## レビュー依頼

follow-up は別 PR で対応する。
`;
		const violations = scanForbiddenTerms(body);
		expect(violations.length).toBeGreaterThanOrEqual(2);
		expect(violations.some((v) => v.term === '予定')).toBe(true);
		expect(violations.some((v) => v.term === 'follow-up')).toBe(true);
	});

	it('コードブロック内の禁止語は除外する (Issue 引用 / メタ言及のケース)', () => {
		const body = `
## 設計方針

実装方針は確定済み。

\`\`\`
禁止語: 予定 / TODO / follow-up
\`\`\`

inline \`予定\` も除外。
`;
		const violations = scanForbiddenTerms(body);
		expect(violations).toEqual([]);
	});

	it('Markdown コメント内の禁止語は除外する (template の説明文に「予定」が含まれるケース)', () => {
		const body = `
## A

<!-- 例: 別途 follow-up で TODO 対応予定 (これはテンプレート説明文) -->

実本文には禁止語を書かない。
`;
		const violations = scanForbiddenTerms(body);
		expect(violations).toEqual([]);
	});

	it('全 7 種の禁止語を網羅', () => {
		expect(FORBIDDEN_TERMS).toEqual([
			'予定',
			'follow-up',
			'PENDING',
			'DEFERRED',
			'別途',
			'個別起票',
			'TODO',
		]);
		const body = FORBIDDEN_TERMS.map((t) => `行: ${t}`).join('\n');
		const violations = scanForbiddenTerms(body);
		// 全 7 語が検出されるはず
		const detectedTerms = new Set(violations.map((v) => v.term));
		for (const term of FORBIDDEN_TERMS) {
			expect(detectedTerms.has(term)).toBe(true);
		}
	});
});

describe('extractAcMapSection', () => {
	it('AC 検証マップセクションを次の ## まで抽出', () => {
		const body = `## 関連 Issue\n本文1\n\n## AC 検証マップ (ADR-0004)\n\n| AC | 内容 |\n| AC1 | OK |\n\n## 変更タイプ\n`;
		const section = extractAcMapSection(body);
		expect(section).toContain('AC1');
		expect(section).not.toContain('変更タイプ');
	});

	it('セクションが無ければ null', () => {
		expect(extractAcMapSection('## A\n本文\n')).toBe(null);
	});
});

describe('checkAcMap', () => {
	it('skip マーカーで検証スキップ', () => {
		const body = `## AC 検証マップ (ADR-0004)\n<!-- ac-verification-skip: docs only -->\n`;
		expect(checkAcMap(body)).toBe(null);
	});

	it('セクション欠落で fail', () => {
		const body = `## A\n本文\n`;
		const result = checkAcMap(body);
		expect(result?.id).toBe('ac-map-missing');
	});

	it('データ行 0 件で fail (ヘッダのみ)', () => {
		const body = `## AC 検証マップ (ADR-0004)\n\n| AC 番号 | AC 内容 | 検証手段 | 結果 |\n|---------|---------|---------|------|\n\n## 次\n`;
		const result = checkAcMap(body);
		expect(result?.id).toBe('ac-map-empty');
	});

	it('空セルで fail', () => {
		const body = `
## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 |
|---------|---------|---------|------|
| AC1 | <!-- 未記入 --> | command | result |

## 次
`;
		const result = checkAcMap(body);
		expect(result?.id).toBe('ac-map-incomplete');
	});

	it('全セル埋まっていれば pass', () => {
		const body = `
## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 |
|---------|---------|---------|------|
| AC1 | 機能A | npx vitest | PASS |
| AC2 | 機能B | scripts/foo | PASS |

## 次
`;
		expect(checkAcMap(body)).toBe(null);
	});
});

describe('hotfix label 検出 (#2343)', () => {
	it('HOTFIX_LABELS は priority:critical と hotfix を含む', () => {
		expect(HOTFIX_LABELS).toContain('priority:critical');
		expect(HOTFIX_LABELS).toContain('hotfix');
	});

	it('priority:critical ラベル付き PR を hotfix として検出', () => {
		expect(hasHotfixLabel(['priority:critical'])).toBe(true);
	});

	it('hotfix ラベル付き PR を hotfix として検出', () => {
		expect(hasHotfixLabel(['hotfix', 'area:backend'])).toBe(true);
	});

	it('priority:medium や type:fix のみは hotfix として検出しない', () => {
		expect(hasHotfixLabel(['priority:medium', 'type:fix'])).toBe(false);
	});

	it('空配列は hotfix として検出しない', () => {
		expect(hasHotfixLabel([])).toBe(false);
	});

	it('ラベル名の前後 whitespace / 大文字を許容', () => {
		expect(hasHotfixLabel([' PRIORITY:CRITICAL '])).toBe(true);
		expect(hasHotfixLabel([' Hotfix '])).toBe(true);
	});
});

describe('extractEnvDistributionSection (#2343)', () => {
	it('配布済み env / secret セクションを抽出する', () => {
		const body = `## A\n本文\n\n## 配布済み env / secret (ADR-0006)\n\n- 配布済み: FOO → GitHub Secrets\n\n## 次セクション\n他\n`;
		const section = extractEnvDistributionSection(body);
		expect(section).toContain('配布済み: FOO');
		expect(section).not.toContain('## 次セクション');
	});

	it('セクションが存在しない body は null を返す', () => {
		expect(extractEnvDistributionSection('## A\n本文\n')).toBeNull();
	});
});

describe('checkEnvDistributionForHotfix (#2343)', () => {
	it('非 hotfix PR は配布証跡欄が空でも検出しない (null)', () => {
		const body = `## 配布済み env / secret (ADR-0006)\n\n（空）\n`;
		expect(checkEnvDistributionForHotfix(body, ['priority:medium'])).toBeNull();
	});

	it('hotfix PR で配布証跡欄が「N/A 新規 env / secret の追加なし」明示時は pass (null)', () => {
		const body = `## 配布済み env / secret (ADR-0006)\n\n- [x] N/A — 新規 env / secret の追加なし\n`;
		expect(checkEnvDistributionForHotfix(body, ['priority:critical'])).toBeNull();
	});

	it('hotfix PR で配布証跡欄に「配布済み:」行があれば pass (null)', () => {
		const body = `## 配布済み env / secret (ADR-0006)\n\n- 配布済み: FOO → GitHub Secrets\n- 配布済み: FOO → Lambda env\n`;
		expect(checkEnvDistributionForHotfix(body, ['hotfix'])).toBeNull();
	});

	it('hotfix PR で配布証跡欄が完全に空なら fail (#2343 / #2341 教訓)', () => {
		const body = `## 配布済み env / secret (ADR-0006)\n\n（記載なし）\n`;
		const result = checkEnvDistributionForHotfix(body, ['priority:critical']);
		expect(result).not.toBeNull();
		expect(result?.id).toBe('hotfix-env-distribution-incomplete');
	});

	it('hotfix PR で配布証跡セクション自体が欠落なら fail', () => {
		const body = `## 顧客価値・目的\n\n本文\n`;
		const result = checkEnvDistributionForHotfix(body, ['priority:critical']);
		expect(result).not.toBeNull();
		expect(result?.id).toBe('hotfix-env-distribution-missing-section');
	});

	it('hotfix PR でコメントのみのセクション (実体なし) は fail', () => {
		const body = `## 配布済み env / secret (ADR-0006)\n\n<!-- 例: 配布済み: FOO → Secrets -->\n`;
		const result = checkEnvDistributionForHotfix(body, ['hotfix']);
		expect(result).not.toBeNull();
	});
});

describe('findUncheckedReadyChecklist (#1481)', () => {
	it('Ready for Review チェックリストの未チェックを検出', () => {
		const body = `
## Ready for Review チェックリスト

- [x] 完了
- [ ] 未完了 1
- [ ] 未完了 2

## 完了チェックリスト

- [x] OK
`;
		const result = findUncheckedReadyChecklist(body);
		expect(result).toHaveLength(1);
		const first = result[0];
		expect(first?.section).toBe('Ready for Review チェックリスト');
		expect(first?.uncheckedCount).toBe(2);
	});

	it('全部チェック済みなら空配列', () => {
		const body = `
## Ready for Review チェックリスト

- [x] A
- [x] B

## 完了チェックリスト

- [x] C
`;
		expect(findUncheckedReadyChecklist(body)).toEqual([]);
	});
});

describe('detectMojibake (#2562 / #2576)', () => {
	it('AC-1: BOM (\\uFEFF) が冒頭にある body を検出する', () => {
		const body = '﻿## タイトル\n本文';
		const result = detectMojibake(body);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe('mojibake-bom');
		expect(result[0]?.message).toMatch(/--body-file/);
	});

	it('AC-1: BOM 検出 error message は heredoc 禁止 + UTF-8 file 投入手順を含む (#2576)', () => {
		const body = '﻿## タイトル';
		const result = detectMojibake(body);
		expect(result).toHaveLength(1);
		const msg = result[0]?.message ?? '';
		// 修正手順を含む (heredoc 禁止 + body-file 必須を明示)
		expect(msg).toMatch(/heredoc/);
		expect(msg).toMatch(/--body-file/);
		expect(msg).toMatch(/UTF-8/);
		expect(msg).toMatch(/tmp\/pr-bodies/);
	});

	it('AC-2: `??` が 5 マッチ以上含まれる body を検出する (#2576 で 10 → 5 に閾値強化)', () => {
		// 注: 正規表現 /\?\?/g は非重複マッチのため、10 文字の `?` = 5 マッチ
		// 5 マッチ = 新閾値の最小トリガ
		const body = '文字化けして ?????????? になりました'; // 10 個 ? = 5 マッチ
		const result = detectMojibake(body);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe('mojibake-heuristic');
		expect(result[0]?.message).toMatch(/--body-file/);
		// 新閾値 5 件以上が message に明示されている
		expect(result[0]?.message).toMatch(/閾値 5 件以上/);
	});

	it('AC-2: 旧閾値 10 で許容されていた 7 マッチ (14 文字) は新閾値 5 で fail (#2576 強化)', () => {
		// 旧 threshold 10 では 7 マッチは許容 (7 < 10)、新 threshold 5 では fail (7 >= 5)
		// 14 個 ? = 7 マッチ (非重複)
		const body = '?????????????? ← 14 個 = 7 マッチ';
		const result = detectMojibake(body);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe('mojibake-heuristic');
	});

	it('AC-1 + AC-2 両方含まれる body は両方検出する', () => {
		const body = '﻿文字化け ????????????????????';
		const result = detectMojibake(body);
		expect(result).toHaveLength(2);
		expect(result.some((r) => r.id === 'mojibake-bom')).toBe(true);
		expect(result.some((r) => r.id === 'mojibake-heuristic')).toBe(true);
	});

	it('境界値: `??` が 4 マッチ (新閾値 5 未満) の body は検出しない', () => {
		// 8 個 ? = 4 マッチ (4 < 5、新閾値で許容)
		const body = '???????? ← 8 個 = 4 マッチ';
		const result = detectMojibake(body);
		expect(result).toHaveLength(0);
	});

	it('正常な日本語テキストは検出しない (BOM 無し / `??` 2 件)', () => {
		const body = '正常なテキストです。?? は 2 個だけ。本当に？？';
		const result = detectMojibake(body);
		expect(result).toHaveLength(0);
	});
});

describe('checkAcMap error message (#2586)', () => {
	it('AC マップ列数不足時の error message は 4 列形式期待 + 参考 PR を含む', () => {
		// 2 列 (簡略形式) の AC マップ — re-review 浪費の根本原因 pattern
		const body = `
## AC 検証マップ (ADR-0004)

| AC | 結果 |
|-----|------|
| AC1 | PASS |

## 次
`;
		const result = checkAcMap(body);
		expect(result?.id).toBe('ac-map-incomplete');
		const msg = result?.message ?? '';
		// 4 列形式の期待を明示
		expect(msg).toMatch(/4 列/);
		// 参考 PR を明示
		expect(msg).toMatch(/#2588/);
		expect(msg).toMatch(/#2599/);
		// 修正手順を明示
		expect(msg).toMatch(/修正手順/);
	});

	it('AC マップが 4 列で全セル埋まっていれば PASS (dogfood)', () => {
		const body = `
## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---------|--------|---------|------------------|
| AC1 | BOM heuristic threshold 強化 | npx vitest | HEAD abc1234 / 12 passed |
| AC2 | AC 4 列 SSOT enforcement | check-pr-body | dogfood PASS |

## 次
`;
		expect(checkAcMap(body)).toBeNull();
	});

	it('AC マップデータ 0 件時の error message も 4 列形式期待 + 参考 PR を含む', () => {
		const body = `## AC 検証マップ (ADR-0004)\n\n| AC 番号 | AC 内容 | 検証手段 | 結果 |\n|---------|---------|---------|------|\n\n## 次\n`;
		const result = checkAcMap(body);
		expect(result?.id).toBe('ac-map-empty');
		const msg = result?.message ?? '';
		expect(msg).toMatch(/4 列/);
		expect(msg).toMatch(/#2588/);
		expect(msg).toMatch(/#2599/);
	});
});

// ---------------------------------------------------------------------------
// #2632: Readiness gate 統合検証 (Ready checklist + AC 4 列 + forbidden-terms)
// QA self-implement 第 5 弾。本日 (2026-05-29) 7 連続再発の構造的予防。
// 既存 unit (findUncheckedReadyChecklist / checkAcMap / scanForbiddenTerms) は単独テスト済。
// 本 describe では「Readiness gate として 3 検査が同一 body に対して整合的に動く」ことを統合的に verify。
// pre-ready.mjs Step 9 ラベル変更 (label: 'Readiness gate ...') 整合の dogfood test 群。
// ---------------------------------------------------------------------------

describe('#2632 Readiness gate 統合 (Ready checklist + AC 4 列 + forbidden-terms)', () => {
	const READY_PASS_BODY = `
## Ready for Review チェックリスト

- [x] 実装完了
- [x] QA 承認・動作確認が完了している
- [x] pre-ready 全 step PASS

## AC 検証マップ (ADR-0004)

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---------|--------|---------|------------------|
| AC1 | pre-ready Step 9 強化 | npx vitest run tests/unit/scripts/check-pr-body.test.ts | HEAD abc1234 / dogfood PASS |
| AC2 | SKILL.md prelude 追加 | node scripts/check-pr-body.mjs --body-file | dogfood PASS |
`;

	it('AC1: Ready checklist 全 [x] + AC 4 列 + 禁止語 0 の body は 3 検査すべて pass (#2632 dogfood)', () => {
		const body = READY_PASS_BODY;
		expect(findUncheckedReadyChecklist(body)).toEqual([]);
		expect(checkAcMap(body)).toBeNull();
		expect(scanForbiddenTerms(body)).toEqual([]);
	});

	it('AC2: Ready checklist 1 件 [ ] 残置で Readiness gate BLOCK (本日 #2625 / #2630 再発 pattern)', () => {
		const body = `
## Ready for Review チェックリスト

- [x] 実装完了
- [ ] QA 承認・動作確認が完了している
`;
		const result = findUncheckedReadyChecklist(body);
		expect(result).toHaveLength(1);
		expect(result[0]?.uncheckedCount).toBe(1);
	});

	it('AC3: AC 検証マップ 2 列簡略形式は BLOCK (本日 #2626 再発 pattern)', () => {
		const body = `
## AC 検証マップ (ADR-0004)

| AC | 結果 |
|-----|------|
| AC1 | PASS |

## 次
`;
		const result = checkAcMap(body);
		expect(result?.id).toBe('ac-map-incomplete');
	});

	it('AC4: forbidden-terms (「予定」「follow-up」「TODO」等) 混入で BLOCK', () => {
		const body = `
## 補足

実装は予定通り完遂。
follow-up は別 PR で対応。
TODO: 後日テスト追加。
`;
		const violations = scanForbiddenTerms(body);
		expect(violations.length).toBeGreaterThanOrEqual(3);
		const detectedTerms = new Set(violations.map((v) => v.term));
		expect(detectedTerms.has('予定')).toBe(true);
		expect(detectedTerms.has('follow-up')).toBe(true);
		expect(detectedTerms.has('TODO')).toBe(true);
	});

	it('AC5: 同一 body に 3 違反共存時、全検査が独立して BLOCK 返す (gate 整合性)', () => {
		const body = `
## Ready for Review チェックリスト

- [ ] 未完了
- [ ] QA 承認・動作確認が完了している

## AC 検証マップ (ADR-0004)

| AC | 結果 |
|-----|------|
| AC1 | PASS |

## 補足

予定通り進行中。

## 次
`;
		// 全 3 検査が独立して BLOCK 検出
		const unchecked = findUncheckedReadyChecklist(body);
		expect(unchecked.length).toBeGreaterThanOrEqual(1);
		expect(unchecked[0]?.uncheckedCount).toBe(2);

		const acResult = checkAcMap(body);
		expect(acResult?.id).toBe('ac-map-incomplete');

		const forbidden = scanForbiddenTerms(body);
		expect(forbidden.length).toBeGreaterThanOrEqual(1);
		expect(forbidden.some((v) => v.term === '予定')).toBe(true);
	});

	it('AC6: dogfood — 本 PR (#2632) の AC 4 列形式雛形が gate PASS する', () => {
		// 本 PR 自身が新 gate を満たすことの dogfood 検証 (self-implement 第 5 弾、AC3)
		const body = READY_PASS_BODY;
		// 3 検査すべて null / 空配列 = PASS
		expect(findUncheckedReadyChecklist(body)).toEqual([]);
		expect(checkAcMap(body)).toBeNull();
		expect(scanForbiddenTerms(body)).toEqual([]);
	});
});

describe('checkSelfReviewEvidence (#2475 Phase 2 / #2815 D-1)', () => {
	it('[x] 自己宣言があり証跡コマンドが 1 件も無い → violation', () => {
		const body = [
			'## コード品質セルフレビュー (#1481)',
			'',
			'- [x] **SOLID**: 単一責任を確認した',
			'- [x] **DRY**: 重複なしを確認した',
			'',
			'## QM レビュー結果',
			'',
			'問題なし',
		].join('\n');
		const v = checkSelfReviewEvidence(body);
		expect(v).not.toBeNull();
		expect(v?.id).toBe('self-review-evidence-missing');
		expect(v?.message).toContain('2 件');
	});

	it('[x] 自己宣言 + 証跡コマンド (backtick grep) がある → null', () => {
		const body = [
			'## AC 検証マップ (ADR-0004)',
			'',
			'| AC1 | 重複除去 | `grep -rn "dup" src/` | PASS: 0 件 |',
			'',
			'## コード品質セルフレビュー (#1481)',
			'',
			'- [x] **DRY**: 上記 grep で重複なしを確認',
		].join('\n');
		expect(checkSelfReviewEvidence(body)).toBeNull();
	});

	it('セルフレビュー系セクションに [x] が 1 件も無い → null (空テンプレ段階は対象外)', () => {
		const body = [
			'## コード品質セルフレビュー (#1481)',
			'',
			'- [ ] **SOLID**: 未確認',
			'',
			'## 横展開・影響波及チェック',
			'',
			'- [x] N/A — 並行実装の影響範囲外',
		].join('\n');
		// セルフレビュー外セクションの [x] はカウントしない
		expect(checkSelfReviewEvidence(body)).toBeNull();
	});

	it('テスト & 安全装置セルフチェックの [x] も検出対象 (証跡なしなら violation)', () => {
		const body = [
			'## テスト & 安全装置セルフチェック',
			'',
			'- [x] 追加・変更したテストの概要: N/A',
		].join('\n');
		const v = checkSelfReviewEvidence(body);
		expect(v?.id).toBe('self-review-evidence-missing');
	});

	it('証跡は fenced code block 内のコマンドでも認める', () => {
		const body = [
			'## テスト & 安全装置セルフチェック',
			'',
			'- [x] vitest PASS を確認:',
			'',
			'実行: `npx vitest run tests/unit/scripts/` → 12 passed',
		].join('\n');
		expect(checkSelfReviewEvidence(body)).toBeNull();
	});

	it('markdown コメント内の [x] はカウントしない', () => {
		const body = [
			'## コード品質セルフレビュー (#1481)',
			'',
			'<!-- - [x] テンプレ例: ここはコメント -->',
			'- [ ] **SOLID**: 未確認',
		].join('\n');
		expect(checkSelfReviewEvidence(body)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// #3846: 変更タイプ checkbox 未選択の shift-left 検出
// CI 必須 gate「変更タイプの選択」hard-fail が 3 PR 連続再発 (#3835 / #3837 / #3844) した
// same-class defect (ADR-0061) を、PR 作成前 (--body-file) / pre-ready Step 9 (--pr) で機械検出する。
// 判定 SSOT は scripts/pr-template-gate-checks.mjs の checkChangeType (二重実装なし)。
// ---------------------------------------------------------------------------

describe('checkChangeTypeSelection (#3846)', () => {
	// detectChangeTypeHeading は「`- [ ]` を 3 行以上持つ ## セクション」を変更タイプと判定する。
	// 実 template (.github/PULL_REQUEST_TEMPLATE.md) と同構造の最小 fixture。
	const TEMPLATE = [
		'## 顧客価値・目的',
		'',
		'本文',
		'',
		'## 変更タイプ',
		'',
		'- [ ] feat: 新機能',
		'- [ ] fix: バグ修正',
		'- [ ] refactor: リファクタリング',
		'- [ ] infra: インフラ・CI/CD',
		'',
		'## 関連 Issue',
	].join('\n');

	it('FAIL: checkbox 未選択 (- [ ] のみ) → change-type-unselected (#3835/#3837/#3844 再発 pattern)', () => {
		const body = [
			'## 変更タイプ',
			'',
			'- [ ] feat: 新機能',
			'- [ ] fix: バグ修正',
			'- [ ] refactor: リファクタリング',
			'- [ ] infra: インフラ・CI/CD',
			'',
			'## 関連 Issue',
		].join('\n');
		const result = checkChangeTypeSelection(body, TEMPLATE);
		expect(result).not.toBeNull();
		expect(result?.id).toBe('change-type-unselected');
		// self-serve 修正を高速化する guidance を含む (issue #3846 提案 2)
		expect(result?.message).toMatch(/- \[x\]/);
		expect(result?.message).toMatch(/--body-file/);
		expect(result?.message).toMatch(/#3835/);
	});

	it('PASS: 1 つ以上 [x] 選択済み → null', () => {
		const body = [
			'## 変更タイプ',
			'',
			'- [ ] feat: 新機能',
			'- [ ] fix: バグ修正',
			'- [x] infra: インフラ・CI/CD',
			'',
			'## 関連 Issue',
		].join('\n');
		expect(checkChangeTypeSelection(body, TEMPLATE)).toBeNull();
	});

	it('PASS: 大文字 [X] も選択として認める (CI gate checkChangeType と同一判定)', () => {
		const body = ['## 変更タイプ', '', '- [X] fix: バグ修正', '', '## 関連 Issue'].join('\n');
		expect(checkChangeTypeSelection(body, TEMPLATE)).toBeNull();
	});

	it('セクション欠落は missing-required-sections gate に委譲 (null)', () => {
		const body = '## 顧客価値・目的\n本文\n';
		expect(checkChangeTypeSelection(body, TEMPLATE)).toBeNull();
	});

	it('dependencies label PR は skip (Dependabot exempt、#1808 整合)', () => {
		const body = ['## 変更タイプ', '', '- [ ] feat: 新機能', '', '## 関連 Issue'].join('\n');
		expect(checkChangeTypeSelection(body, TEMPLATE, ['dependencies'])).toBeNull();
	});
});

describe('checkPoDecisionBrief (#3944 / #3956 / #3962)', () => {
	const FILLED_BRIEF = [
		'## PO 決裁ブリーフ (po-decision:required)',
		'',
		'```mermaid',
		'flowchart TB',
		'  R1["可逆性: 🟢可逆 — revert のみで戻る"]',
		'  Q1["Q1: 日次バックアップ 3 世代で決裁してよいか"]',
		'  R1 --> Q1',
		'```',
		'',
	].join('\n');

	it('label なしなら検査自体を skip する (通常 PR に負担を課さない)', () => {
		expect(checkPoDecisionBrief('## 顧客価値・目的\n本文\n', [])).toBeNull();
		expect(
			checkPoDecisionBrief('## 顧客価値・目的\n本文\n', ['type:fix', 'area:admin']),
		).toBeNull();
	});

	it('FAIL: label 付きでブリーフ見出しが無い (#3944 / #3956 の実際の形)', () => {
		const body = [
			'## 顧客価値・目的',
			'PGlite 本番データの日次バックアップを取得する。',
			'',
			'## 変更内容',
			'オーナー決裁 2026-07-26: RPO 日次 / 3 世代 / NUC ローカル',
		].join('\n');
		const v = checkPoDecisionBrief(body, [PO_DECISION_LABEL]);
		expect(v?.id).toBe('po-decision-brief-missing-section');
	});

	it('FAIL: 見出しが HTML コメント内にあるだけでは「存在する」と認めない', () => {
		const body = ['## 顧客価値・目的', '', '<!-- ## PO 決裁ブリーフ は後で書く -->'].join('\n');
		const v = checkPoDecisionBrief(body, [PO_DECISION_LABEL]);
		expect(v?.id).toBe('po-decision-brief-missing-section');
	});

	it('FAIL: 見出しはあるが mermaid 一枚絵が無い (長文説明だけの代替を認めない)', () => {
		const body = [
			'## PO 決裁ブリーフ (po-decision:required)',
			'',
			'リスクは低いです。可逆で、ロールバックは revert のみで戻ります。',
			'',
			'## 関連 Issue',
		].join('\n');
		const v = checkPoDecisionBrief(body, [PO_DECISION_LABEL]);
		expect(v?.id).toBe('po-decision-brief-missing-diagram');
	});

	it('FAIL: template の未置換プレースホルダ ___ が残っている', () => {
		const body = [
			'## PO 決裁ブリーフ (po-decision:required)',
			'',
			'```mermaid',
			'flowchart TB',
			'  R1["可逆性: 🟢可逆 / 🔴不可逆 → ___"]',
			'  Q1["Q1: ___"]',
			'```',
		].join('\n');
		const v = checkPoDecisionBrief(body, [PO_DECISION_LABEL]);
		expect(v?.id).toBe('po-decision-brief-unfilled-placeholder');
		expect(v?.message).toContain('2 件');
	});

	it('PASS: 記入済みブリーフがあれば通る', () => {
		const body = ['## 顧客価値・目的', '本文', '', FILLED_BRIEF].join('\n');
		expect(checkPoDecisionBrief(body, [PO_DECISION_LABEL])).toBeNull();
	});

	it('PASS: 後続セクションの ___ は誤検出しない (セクション境界を守る)', () => {
		const body = [FILLED_BRIEF, '## 補足', '', 'コード例: `const ___ = 1;`'].join('\n');
		expect(checkPoDecisionBrief(body, [PO_DECISION_LABEL])).toBeNull();
	});

	it('label 判定は大小文字を無視する', () => {
		expect(hasPoDecisionLabel(['PO-Decision:Required'])).toBe(true);
		expect(hasPoDecisionLabel(['po-decision:optional'])).toBe(false);
	});

	it('extractPoDecisionSection は次の ## 見出しまでを返す', () => {
		const body = [FILLED_BRIEF, '## 関連 Issue', 'closes #3962'].join('\n');
		const section = extractPoDecisionSection(body);
		expect(section).toContain('```mermaid');
		expect(section).not.toContain('closes #3962');
	});
});

describe('PO 決裁ブリーフ gate の SSOT 整合 (#3962)', () => {
	const repoRoot = resolve(__dirname, '../../..');

	it('labeler.yml が po-decision:required を定義している (label 名の rename で gate が黙って無効化されない)', () => {
		const labeler = readFileSync(resolve(repoRoot, '.github/labeler.yml'), 'utf-8');
		expect(labeler).toContain(`"${PO_DECISION_LABEL}":`);
	});

	it('template が gate の要求 (見出し + mermaid) を満たす — template だけ通せば必ず PASS する', () => {
		const template = readFileSync(
			resolve(repoRoot, '.claude/skills/dev-open-pr/templates/po-decision-brief.md'),
			'utf-8',
		);
		// 見出しと mermaid は満たす。「___」は記入前提なので残っているのが正しい。
		const v = checkPoDecisionBrief(template, [PO_DECISION_LABEL]);
		expect(v?.id).toBe('po-decision-brief-unfilled-placeholder');
	});
});

/**
 * #3962 QA 指摘 (BLOCK 1): label 取得に失敗すると label 条件付き検査が黙って消え、
 * 出力は `OK — 違反なし` になっていた。
 *
 * 原因は `fetchPrLabels()` が gh 失敗を `catch { return [] }` で潰し、
 * 「label が付いていない」と「label を取得できなかった」を呼び出し側が区別できなかったこと。
 * `resolveLabels()` はこの 2 状態を型で分離し、**未解決は必ず error** (fail-closed) を返す。
 */
describe('resolveLabels — label 未解決は fail-closed (#3962 QA BLOCK 1)', () => {
	const noLabelArgs = { pr: null, labels: null, noLabels: false };

	it('[LB1] --pr 指定で label 取得に失敗したら error を返す (空配列に落とさない)', () => {
		const r = resolveLabels({ ...noLabelArgs, pr: '3956' }, null);
		expect(r).not.toHaveProperty('labels');
		expect('error' in r && r.error).toContain('label を取得できませんでした');
	});

	it('[LB2] --pr 指定で label が 1 件も無い場合は空配列 (取得成功なので検査は正しく skip される)', () => {
		const r = resolveLabels({ ...noLabelArgs, pr: '3956' }, []);
		expect(r).toEqual({ labels: [] });
	});

	it('[LB3] --body-file 単独 (label を解決する手段が無い) も error にする', () => {
		const r = resolveLabels(noLabelArgs, null);
		expect('error' in r && r.error).toContain('--body-file 単独では label を解決できません');
	});

	it('[LB4] --no-labels は「label が無い」ことの明示なので空配列を返す', () => {
		expect(resolveLabels({ ...noLabelArgs, noLabels: true }, null)).toEqual({ labels: [] });
	});

	it('[LB5] --labels の csv は trim して解釈する', () => {
		const r = resolveLabels({ ...noLabelArgs, labels: 'po-decision:required, hotfix ,' }, null);
		expect(r).toEqual({ labels: [PO_DECISION_LABEL, 'hotfix'] });
	});

	it('[LB6] 未解決と label 無しが同じ結果にならない — 同一 body で検査が消えないことの回帰', () => {
		// QA の再現 (PR #3956 の実 body 相当: po-decision:required 付きだがブリーフ無し)
		const bodyWithoutBrief = '## 顧客価値・目的\n\n本文\n';

		// A: label 解決済み (po-decision:required あり) → 違反が出る
		const resolvedA = resolveLabels({ ...noLabelArgs, labels: PO_DECISION_LABEL }, null);
		expect('labels' in resolvedA).toBe(true);
		if ('labels' in resolvedA) {
			expect(checkPoDecisionBrief(bodyWithoutBrief, resolvedA.labels)?.id).toBe(
				'po-decision-brief-missing-section',
			);
		}

		// B: label 未解決 → 旧実装は [] に落ちて checkPoDecisionBrief が null (= 検査消滅) になった。
		//    現行は error を返すので、そもそも検査を走らせる前に中断できる。
		const resolvedB = resolveLabels({ ...noLabelArgs, pr: '3956' }, null);
		expect('labels' in resolvedB).toBe(false);
		expect(checkPoDecisionBrief(bodyWithoutBrief, [])).toBeNull(); // 旧実装が黙って通していた経路
	});
});

/**
 * #3962 QA 指摘 (2 巡目): `--no-labels` は fail-closed の縮退先なので、
 * 出力が通常 pass と目視で区別できないと「gate が形式だけ通って実体が無い」class に戻る。
 * skip した gate 名が出力に含まれることを固定し、将来メッセージを整理した拍子の無言化を防ぐ。
 */
describe('formatSkippedLabelGates — --no-labels は何を検査しなかったかを出す (#3962)', () => {
	it('[LB7] skip した label 条件付き gate の名前と件数が出力に含まれる', () => {
		const out = formatSkippedLabelGates().join('\n');

		// 件数が LABEL_CONDITIONAL_GATES と一致する (gate を足したのに文言が古い、を防ぐ)
		expect(out).toContain(`label 条件付き gate ${LABEL_CONDITIONAL_GATES.length} 件`);

		// 個々の gate 名と発火 label が名指しされている
		for (const gate of LABEL_CONDITIONAL_GATES) {
			expect(out).toContain(gate.name);
			expect(out).toContain(gate.issue);
		}
		expect(out).toContain(PO_DECISION_LABEL);

		// 通常 pass (`OK — 違反なし`) と見分けるためのマーカー
		expect(out).toContain('SKIPPED');
	});

	it('[LB8] LABEL_CONDITIONAL_GATES が実在の label 条件付き検査を網羅している', () => {
		// hotfix (#2343) と po-decision (#3962) の 2 件。増えたら本 test が落ちて追記を促す。
		expect(LABEL_CONDITIONAL_GATES.map((g) => g.issue)).toEqual(['#2343', '#3962']);
		expect(hasPoDecisionLabel([PO_DECISION_LABEL])).toBe(true);
		expect(hasHotfixLabel(HOTFIX_LABELS.slice(0, 1))).toBe(true);
	});
});

/**
 * #3962: fail-closed 化して初めて露見した実バグの回帰。
 *
 * `fetchPrLabels` は `gh pr view --json labels --jq '[.labels[].name]'` を execSync していたが、
 * execSync は Windows で cmd.exe を経由し、cmd.exe は単一引用符を引用符として扱わない。
 * jq が `'[.labels[].name]'` をリテラル受領して `unexpected token "'"` で落ちるため、
 * **Windows のローカル開発機では label 条件付き検査が一度も走らないまま
 * `OK — 違反なし` が出ていた** (旧実装の catch { return [] } が完全に無音化していた)。
 * shell 引用に依存しない `--json labels` + JS 側パースへ変更した。
 */
describe('extractLabelNames — shell 引用に依存せず label を取り出す (#3962)', () => {
	it('[LB9] gh pr view --json labels の生 JSON から name を取り出す', () => {
		const raw = JSON.stringify({
			labels: [{ name: 'type:fix' }, { name: PO_DECISION_LABEL }],
		});
		expect(extractLabelNames(raw)).toEqual(['type:fix', PO_DECISION_LABEL]);
	});

	it('[LB10] label が 0 件なら空配列 (取得成功なので検査は正しく skip される)', () => {
		expect(extractLabelNames('{"labels":[]}')).toEqual([]);
	});

	it('[LB11] パース不能 / labels が配列でない場合は null — 空配列に落とさない', () => {
		// jq が落ちて stdout が空 / エラー文字列だった場合に相当する。
		// ここで [] を返すと resolveLabels の fail-closed が効かず、本 Issue の欠陥に戻る。
		expect(extractLabelNames('')).toBeNull();
		expect(extractLabelNames("failed to parse jq expression\n'[.labels[].name]'")).toBeNull();
		expect(extractLabelNames('{"labels":null}')).toBeNull();
		expect(extractLabelNames('{}')).toBeNull();
	});

	it('[LB12] 未解決 (null) は resolveLabels で error になる — 経路として繋がっていることの固定', () => {
		const fetched = extractLabelNames('');
		expect(fetched).toBeNull();
		const r = resolveLabels({ pr: '3965', labels: null, noLabels: false }, fetched);
		expect('labels' in r).toBe(false);
	});
});

/**
 * #4006: pre-ready チェックボックスの `[x]` に receipt の裏付けを要求する gate。
 * 「宣言だけで通る」経路が 1 つでも残ると #3994 / #4002 の流用がそのまま復活する。
 */
describe('#4006 pre-ready receipt gate', () => {
	const HEAD_SHA = 'c'.repeat(40);
	const receiptJson = (over: Record<string, unknown> = {}) =>
		JSON.stringify(
			{
				schemaVersion: 1,
				tool: 'pre-ready',
				pr: 4006,
				headSha: HEAD_SHA,
				startedAt: '2026-07-28T00:00:00.000Z',
				finishedAt: '2026-07-28T00:20:00.000Z',
				status: 'ALL_PASS',
				steps: [{ name: 'biome', outcome: 'pass' }],
				...over,
			},
			null,
			2,
		);
	const bodyWith = (checkbox: string, receipt?: string) =>
		`## Ready for Review チェックリスト\n\n${checkbox}\n\n${
			receipt ? ['```json', receipt, '```'].join('\n') : ''
		}\n`;
	const CHECKED = '- [x] **`npm run pre-ready -- --pr <num>` 全 Step PASS** をローカル確認した';
	const UNCHECKED = '- [ ] **`npm run pre-ready -- --pr <num>` 全 Step PASS** をローカル確認した';

	it('[PR1] [x] 宣言のみ検知する ([ ] は既存 gate の担当なので二重に鳴らさない)', () => {
		expect(claimsPreReadyPass(bodyWith(CHECKED))).toBe(true);
		expect(claimsPreReadyPass(bodyWith(UNCHECKED))).toBe(false);
		// コメントアウトされた template 例は宣言ではない
		expect(claimsPreReadyPass(`<!--\n${CHECKED}\n-->`)).toBe(false);
	});

	it('[PR2] [x] なのに receipt が無い body は落ちる', () => {
		const v = checkPreReadyReceipt(bodyWith(CHECKED), { pr: '4006', actualHeadSha: HEAD_SHA });
		expect(v?.id).toBe('pre-ready-receipt-missing');
	});

	it('[PR3] 別 PR / 古い HEAD の receipt は理由を分けて落ちる', () => {
		const otherPr = checkPreReadyReceipt(bodyWith(CHECKED, receiptJson({ pr: 3993 })), {
			pr: '4006',
			actualHeadSha: HEAD_SHA,
		});
		expect(otherPr?.id).toBe('pre-ready-receipt-pr-mismatch');

		const stale = checkPreReadyReceipt(
			bodyWith(CHECKED, receiptJson({ headSha: 'd'.repeat(40) })),
			{
				pr: '4006',
				actualHeadSha: HEAD_SHA,
			},
		);
		expect(stale?.id).toBe('pre-ready-receipt-head-mismatch');
	});

	it('[PR4] 一致する receipt があれば通る', () => {
		expect(
			checkPreReadyReceipt(bodyWith(CHECKED, receiptJson()), {
				pr: '4006',
				actualHeadSha: HEAD_SHA,
			}),
		).toBeNull();
	});

	it('[PR6] pre-ready 実行中だけ gate 対象外 — 実行後の呼び出しでは必ず適用される', () => {
		// receipt は実行完了後にしか存在しないため、pre-ready の Step 9 内で要求すると
		// 「receipt を作るには Step 9 が必要 / Step 9 には receipt が必要」の循環になる。
		// 逆に言えば、実行中フラグが無い呼び出し (pre-push / 手動 / QM) では常に適用される必要がある。
		expect(isPreReadyReceiptGateApplicable({ PRE_READY_IN_PROGRESS: '1' })).toBe(false);
		expect(isPreReadyReceiptGateApplicable({})).toBe(true);
		expect(isPreReadyReceiptGateApplicable({ PRE_READY_IN_PROGRESS: '0' })).toBe(true);
		expect(isPreReadyReceiptGateApplicable({ PRE_READY_IN_PROGRESS: 'true' })).toBe(true);
	});

	it('[PR5] 未チェックの body には receipt を要求しない', () => {
		expect(
			checkPreReadyReceipt(bodyWith(UNCHECKED), { pr: '4006', actualHeadSha: HEAD_SHA }),
		).toBeNull();
	});
});
