/**
 * tests/unit/scripts/check-pr-body.test.ts (#1775 AC2)
 *
 * scripts/check-pr-body.mjs の純粋関数（検出ロジック）の unit test。
 * GitHub API 呼び出し (gh pr view) は本テストでは触れない（--body-file 経路でテスト可能）。
 */

import { describe, expect, it } from 'vitest';

import {
	checkAcMap,
	checkEnvDistributionForHotfix,
	checkSelfReviewEvidence,
	detectMojibake,
	extractAcMapSection,
	extractEnvDistributionSection,
	extractRequiredSections,
	FORBIDDEN_TERMS,
	findMissingSections,
	findUncheckedReadyChecklist,
	HOTFIX_LABELS,
	hasHotfixLabel,
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
