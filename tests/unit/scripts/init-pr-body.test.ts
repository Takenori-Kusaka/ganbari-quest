/**
 * tests/unit/scripts/init-pr-body.test.ts (#1863)
 *
 * Dev PR body 雛形生成スクリプト (.claude/skills/dev-open-pr/scripts/init-pr-body.mjs) の
 * 純粋関数 (toSlug / extractAcTable / buildTypeCheckboxes / renderTemplate) の unit test。
 *
 * gh CLI 呼び出し (fetchIssue) と fs 副作用 (main) は本テストでは触れない。
 * AC1-4 (Skill / templates / script / check-pr-body 互換) を最低限保証する。
 */

import { describe, expect, it } from 'vitest';

import {
	buildTypeCheckboxes,
	extractAcTable,
	renderTemplate,
	toSlug,
} from '../../../.claude/skills/dev-open-pr/scripts/init-pr-body.mjs';

describe('toSlug', () => {
	it('英語タイトルは kebab-case 化される', () => {
		expect(toSlug('feat: add dark mode toggle')).toBe('feat-add-dark-mode-toggle');
	});

	it('40 文字でクリップされる', () => {
		const long = 'a'.repeat(60);
		expect(toSlug(long).length).toBeLessThanOrEqual(40);
	});

	it('日本語のみのタイトルは ASCII フォールバックされる', () => {
		expect(toSlug('日本語タイトル')).toBe('pr');
	});

	it('日本語 + ASCII 混在では ASCII 部分が抽出される', () => {
		// `:` 後の英数字を拾える（`infra:` のようなプレフィックス対応）
		const slug = toSlug('infra: #1863 PR boilerplate skill');
		expect(slug).toMatch(/infra/);
		expect(slug).toMatch(/skill/);
	});

	it('空文字列は固定 slug にフォールバック', () => {
		expect(toSlug('')).toBe('pr');
	});
});

describe('extractAcTable', () => {
	it('Acceptance Criteria セクションの - [ ] 行を 4 列表に変換する', () => {
		const body = `## 設計方針\n本文\n\n## Acceptance Criteria\n\n- [ ] **AC1**: foo が動く\n- [ ] **AC2**: bar が動く\n\n## 次セクション\n`;
		const table = extractAcTable(body);
		expect(table).toContain('| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |');
		expect(table).toContain('| AC1 | foo が動く');
		expect(table).toContain('| AC2 | bar が動く');
	});

	it('AC セクションが無い場合は body 全体から - [ ] 行を拾う', () => {
		const body = `本文\n- [ ] task1\n- [ ] task2\n`;
		const table = extractAcTable(body);
		expect(table).toContain('| AC1 | task1');
		expect(table).toContain('| AC2 | task2');
	});

	it('AC が 1 件も抽出できない場合は 1 行ダミーを返す', () => {
		const body = `本文のみ。AC 行なし`;
		const table = extractAcTable(body);
		expect(table).toContain('| AC1 |');
		expect(table).toContain('Issue から AC を転記');
	});

	it('日本語見出し「受入条件」も認識する', () => {
		const body = `## 受入条件\n\n- [ ] AC1: 動作確認\n`;
		const table = extractAcTable(body);
		expect(table).toContain('| AC1 |');
		expect(table).toContain('動作確認');
	});

	it('セル内の `|` は escape される', () => {
		const body = `## Acceptance Criteria\n\n- [ ] AC1: コマンド \`a | b\` が動く\n`;
		const table = extractAcTable(body);
		// テーブル行内の `|` は `\|` にエスケープされる
		expect(table).toContain('a \\| b');
	});

	it('checked 状態 [x] でも認識する', () => {
		const body = `## Acceptance Criteria\n\n- [x] AC1: 完了済\n- [ ] AC2: 未完了\n`;
		const table = extractAcTable(body);
		expect(table).toContain('| AC1 | 完了済');
		expect(table).toContain('| AC2 | 未完了');
	});
});

describe('buildTypeCheckboxes', () => {
	it('type:infra ラベルがあれば infra のみ [x] になる', () => {
		const result = buildTypeCheckboxes(['type:infra', 'priority:medium']);
		expect(result).toContain('- [x] infra: インフラ・CI/CD');
		expect(result).toContain('- [ ] feat: 新機能');
		expect(result).toContain('- [ ] fix: バグ修正');
	});

	it('複数 type label があれば全て [x]', () => {
		const result = buildTypeCheckboxes(['type:feat', 'type:design']);
		expect(result).toContain('- [x] feat: 新機能');
		expect(result).toContain('- [x] design: デザイン・UI改善');
		expect(result).toContain('- [ ] fix: バグ修正');
	});

	it('type label が無い場合は全て [ ]', () => {
		const result = buildTypeCheckboxes(['priority:low']);
		expect(result).toContain('- [ ] feat: 新機能');
		expect(result).not.toContain('- [x]');
	});

	it('空配列でも 8 行の checkbox を生成する', () => {
		const result = buildTypeCheckboxes([]);
		const lines = result.split('\n').filter((l) => l.trim().length > 0);
		expect(lines.length).toBe(8);
		expect(lines.every((l) => l.startsWith('- [ ]'))).toBe(true);
	});
});

describe('renderTemplate', () => {
	it('全プレースホルダーが置換される', () => {
		const tpl =
			'closes #{{ISSUE_NUMBER}}\n\nTitle: {{ISSUE_TITLE}}\n\n{{TYPE_CHECKBOXES}}\n\n{{AC_TABLE}}\n';
		const result = renderTemplate(tpl, {
			issueNumber: '1863',
			issueTitle: 'infra: skill 化',
			acTable: '| AC1 | content | tool | PASS |',
			typeCheckboxes: '- [x] infra',
		});
		expect(result).toContain('closes #1863');
		expect(result).toContain('Title: infra: skill 化');
		expect(result).toContain('- [x] infra');
		expect(result).toContain('| AC1 | content | tool | PASS |');
		expect(result).not.toContain('{{');
	});

	it('同一プレースホルダーが複数回出現しても全て置換される (replaceAll)', () => {
		const tpl = '#{{ISSUE_NUMBER}} ... 再掲: #{{ISSUE_NUMBER}}';
		const result = renderTemplate(tpl, {
			issueNumber: '999',
			issueTitle: '',
			acTable: '',
			typeCheckboxes: '',
		});
		expect(result).toBe('#999 ... 再掲: #999');
	});
});
