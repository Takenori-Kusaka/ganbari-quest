import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GitHub Issue Forms required textareas validation (#2090).
 *
 * Issue Forms (`.github/ISSUE_TEMPLATE/*.yml`) で起票時に以下 4 textarea が
 * `validations.required: true` で必須化されていることを検証する:
 *
 * 1. alternatives (Rust RFC 抜粋 — 検討した他案 + 不採用理由)
 * 2. no-gos (Shape Up 抜粋 — 今回スコープ外)
 * 3. research-link (Deep Research 結果リンク)
 * 4. pre-pmf-check (ADR-0010 §3 4 質問への回答)
 *
 * dropdown の既知不具合 (default 値選択で起票通過、community discussion #45084 /
 * #75372) を回避するため textarea のみで強制効果を担保する設計。
 *
 * 依存追加を避けるため YAML parser を使わず regex で検査する (Issue Forms YAML は
 * 単純構造のため regex で十分な validation 強度を担保できる)。
 */

const TEMPLATE_DIR = resolve(process.cwd(), '.github/ISSUE_TEMPLATE');

const TARGET_TEMPLATES = [
	'dev_ticket.yml',
	'process_ticket.yml',
	'bug_report.yml',
	'feature_request.yml',
];

const REQUIRED_TEXTAREA_IDS = ['alternatives', 'no-gos', 'research-link', 'pre-pmf-check'];

function loadTemplate(filename: string): string {
	return readFileSync(resolve(TEMPLATE_DIR, filename), 'utf8');
}

/**
 * 指定 ID の field block を抽出する。
 * Issue Forms YAML の field block は `  - type: <type>` で始まり、
 * 次の `  - type:` または EOF までを 1 block とする。
 */
function extractFieldBlock(content: string, id: string): string | null {
	// 各 - type: ... ブロックを切り出す
	const blocks = content.split(/\n(?= {2}- type: )/);
	for (const block of blocks) {
		const idMatch = block.match(/^\s+id:\s+(\S+)/m);
		if (idMatch && idMatch[1] === id) {
			return block;
		}
	}
	return null;
}

function getFieldType(block: string): string | null {
	const m = block.match(/^\s*-?\s*type:\s+(\S+)/m);
	return m?.[1] ?? null;
}

function hasRequiredTrue(block: string): boolean {
	// validations:\n      required: true パターン
	return /validations:\s*\n\s+required:\s+true/.test(block);
}

function countTypeDropdown(content: string): number {
	const matches = content.match(/^\s*-\s*type:\s+dropdown/gm);
	return matches ? matches.length : 0;
}

describe('GitHub Issue Forms — required textareas (#2090)', () => {
	describe.each(TARGET_TEMPLATES)('%s', (filename) => {
		const content = loadTemplate(filename);

		it('contains body field blocks (sanity check)', () => {
			expect(content).toMatch(/^body:/m);
			expect(content).toMatch(/-\s+type:\s+/);
		});

		describe.each(REQUIRED_TEXTAREA_IDS)('%s field', (id) => {
			it('exists with type=textarea', () => {
				const block = extractFieldBlock(content, id);
				expect(block, `${filename} に id: ${id} の field が存在しない`).not.toBe(null);
				expect(getFieldType(block as string)).toBe('textarea');
			});

			it('has validations.required: true', () => {
				const block = extractFieldBlock(content, id);
				expect(block).not.toBe(null);
				expect(
					hasRequiredTrue(block as string),
					`${filename} の id: ${id} に validations.required: true が付与されていない`,
				).toBe(true);
			});
		});
	});

	describe('bug_report.yml — dropdown 既知不具合回避 (AC3)', () => {
		it('contains zero `type: dropdown` items (textarea のみで強制、#2090)', () => {
			const content = loadTemplate('bug_report.yml');
			expect(countTypeDropdown(content)).toBe(0);
		});
	});

	describe('AC4 — 既存 dropdown 維持', () => {
		it('dev_ticket.yml の priority dropdown は維持', () => {
			const content = loadTemplate('dev_ticket.yml');
			const block = extractFieldBlock(content, 'priority');
			expect(block).not.toBe(null);
			expect(getFieldType(block as string)).toBe('dropdown');
			expect(hasRequiredTrue(block as string)).toBe(true);
		});

		it('process_ticket.yml の kind dropdown は維持', () => {
			const content = loadTemplate('process_ticket.yml');
			const block = extractFieldBlock(content, 'kind');
			expect(block).not.toBe(null);
			expect(getFieldType(block as string)).toBe('dropdown');
			expect(hasRequiredTrue(block as string)).toBe(true);
		});
	});

	describe('.github/CLAUDE.md — Issue 起票ルール記載 (AC6)', () => {
		const claudeMd = readFileSync(resolve(process.cwd(), '.github/CLAUDE.md'), 'utf8');

		it('4 textarea 必須化の言及あり', () => {
			expect(claudeMd).toMatch(
				/4 textarea \(alternatives \/ no-gos \/ research-link \/ pre-pmf-check\) 必須化/,
			);
		});

		it('#2090 への参照あり', () => {
			expect(claudeMd).toContain('#2090');
		});
	});
});
