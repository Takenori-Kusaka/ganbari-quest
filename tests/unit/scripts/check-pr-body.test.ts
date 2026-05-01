/**
 * tests/unit/scripts/check-pr-body.test.ts (#1775 AC2)
 *
 * scripts/check-pr-body.mjs の純粋関数（検出ロジック）の unit test。
 * GitHub API 呼び出し (gh pr view) は本テストでは触れない（--body-file 経路でテスト可能）。
 */

import { describe, expect, it } from 'vitest';

import {
	checkAcMap,
	extractAcMapSection,
	extractRequiredSections,
	FORBIDDEN_TERMS,
	findMissingSections,
	findUncheckedReadyChecklist,
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
