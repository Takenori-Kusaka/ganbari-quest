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

/**
 * #4097: Web UI 経路 (Issue Forms) と `--body-file` 経路 (issue-triage SKILL.md) の項目集合を一致させる。
 *
 * `.github/CLAUDE.md` は「補佐の `--body-file` 経由起票も同 4 見出しを markdown body に含める」と定めるが、
 * SKILL.md §ステップ 7 のテンプレには alternatives / no-gos に対応する見出しが無く、実起票では
 * Web UI で必須の 2 項目が構造的に常に欠落していた。両経路の対応を機械照合して drift を止める。
 */
describe('--body-file 経路 (SKILL.md) が Web UI 必須 4 項目を網羅する (#4097)', () => {
	const skill = readFileSync(
		resolve(process.cwd(), '.claude/skills/issue-triage/SKILL.md'),
		'utf8',
	);
	/** Issue Forms の field id → SKILL.md §ステップ 7 テンプレの対応見出し。 */
	const FIELD_TO_HEADING: Record<string, string> = {
		alternatives: '## Alternatives + Prior art',
		'no-gos': '## No-gos（今回スコープ外）',
		'research-link': '## Deep Research 添付',
		'pre-pmf-check': '## Pre-PMF チェック結果',
	};

	it('REQUIRED_TEXTAREA_IDS と対応表のキー集合が一致する (対応表の網羅漏れ防止)', () => {
		expect(Object.keys(FIELD_TO_HEADING).sort()).toEqual([...REQUIRED_TEXTAREA_IDS].sort());
	});

	/**
	 * `.github/CLAUDE.md` §Issue 起票ルール の「N textarea (id / id / …) 必須化」行から
	 * field id 集合を抽出する。CLAUDE.md 側が SSOT 記述であり、yml / SKILL.md との drift を
	 * 機械照合するための parser (#4097 AC2 bullet 2)。
	 */
	function parseRequiredFieldIdsFromClaudeMd(md: string): { count: number; ids: string[] } {
		const m = md.match(/\*\*(\d+) textarea \(([^)]+)\) 必須化\*\*/);
		if (m === null) {
			throw new Error(
				'.github/CLAUDE.md に「N textarea (…) 必須化」ルール行が無い → 必須項目の SSOT 記述が失われている',
			);
		}
		return { count: Number(m[1]), ids: m[2].split('/').map((s) => s.trim()) };
	}

	const claudeMd = readFileSync(resolve(process.cwd(), '.github/CLAUDE.md'), 'utf8');
	const claudeRule = parseRequiredFieldIdsFromClaudeMd(claudeMd);

	it('.github/CLAUDE.md が列挙する必須 field 集合が Issue Forms の実 field 集合と一致する', () => {
		expect(
			[...claudeRule.ids].sort(),
			'.github/CLAUDE.md の必須 field 列挙と Issue Forms (yml) の required textarea が乖離している',
		).toEqual([...REQUIRED_TEXTAREA_IDS].sort());
		// 「4 textarea」の宣言件数自体も列挙数と一致していること (片方だけ増減する drift を検出)
		expect(claudeRule.count).toBe(claudeRule.ids.length);
	});

	it('.github/CLAUDE.md が `--body-file` 経路にも同一見出しを要求している', () => {
		expect(claudeMd).toMatch(/gh issue create --body-file`? 経由起票も同 \d+ 見出しを/);
	});

	it.each(
		claudeRule.ids,
	)('.github/CLAUDE.md が要求する `%s` に対応する見出しが SKILL.md テンプレに存在する', (id) => {
		const heading = FIELD_TO_HEADING[id];
		expect(
			heading,
			`.github/CLAUDE.md が要求する field "${id}" が対応表 (FIELD_TO_HEADING) に無い`,
		).toBeDefined();
		expect(
			skill,
			`SKILL.md に "${heading}" が無い → CLAUDE.md の要求が --body-file 経路で満たされない`,
		).toContain(heading);
	});

	it.each(
		REQUIRED_TEXTAREA_IDS,
	)('必須 field `%s` に対応する見出しが SKILL.md ステップ 7 テンプレに存在する', (id) => {
		const heading = FIELD_TO_HEADING[id];
		expect(
			skill,
			`SKILL.md に "${heading}" が無い → --body-file 起票で ${id} が欠落する`,
		).toContain(heading);
	});

	it('17 項目 checklist の本文 SSOT が SKILL.md 側にあり、yml は本文を複製しない', () => {
		// 本文 SSOT (手順 E) 側には 4 層すべての見出しが揃っている
		for (const section of [
			'### permission 系 5 項目',
			'### marketplace 系 4 層',
			'### 子供向け機能 6 項目',
			'### ナビ / 情報アーキテクチャ系 2 項目',
		]) {
			expect(skill, `手順 E に "${section}" が無い`).toContain(section);
		}
		// yml 側は本文を複製せず SKILL.md を指すだけ
		for (const filename of TARGET_TEMPLATES) {
			const block = extractFieldBlock(loadTemplate(filename), 'auxiliary-feature-ux-checklist');
			if (block === null) continue; // bug_report は本 field を持たない
			expect(block, `${filename} が checklist 本文を複製している`).toContain(
				'.claude/skills/issue-triage/SKILL.md',
			);
			expect(block, `${filename} に 17 項目本文が残っている`).not.toContain('**Loading state**');
		}
	});
});
