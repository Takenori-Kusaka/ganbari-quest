// tests/unit/architecture/qm-role-naming-consistency.test.ts
// #4177 AC6 — 品質管理ロールを指す `QA` の再混入を止める。
//
// ## なぜ guard が要るか
//
// ロール名は実態が **QM (Quality Manager)** だが、ファイル名と一部記述が `QA` のまま残っていた。
// 実測 (2026-08-01) で `QM` 497 行 / `QA` 206 行 = **QM が既に 2.4 倍で多数派**なのに、
// 新しい記述ほど QM・古い記述ほど QA という形で**自然に移行しつつファイル名だけ取り残されていた**。
// 放置すると憲章 (#4175) が指すファイル名と憲章の用語が食い違い続ける。
//
// ## なぜ `check-internal-terms.mjs` ではないのか (AC6 の文言からの逸脱)
//
// Issue の AC6 は「`check-internal-terms.mjs` の config に規則を追加」と書いているが、
// 同 script の走査対象は
//
//     const SEARCH_ROOTS = ['src/routes/(parent)', 'src/lib/features/admin'];
//
// で、**docs / .claude / scripts を一切見ない** (顧客 UI への内部用語露出を検出する装置のため)。
// そこに QA→QM 規則を足しても、**drift が起きる場所を走査していないので永久に発火しない**。
// 「検査しているのに pass が出る」gate を作ることになり、#4084 / #4206 と同じ形になる。
//
// **新規 script は作らない** (#4175 §3.4 装置 ratchet) 制約は守りつつ、実際に効く場所として
// `tests/unit/architecture/` の fitness function に置く (#4181 / #4030 と同じ方式)。
//
// ## 何を許し、何を許さないか
//
// 「QA」を機械的に全面禁止すると **110 行を壊す**。3 分類のうち置換対象は A だけである。
//
//   A: 品質管理ロールを指す        → **禁止** (QM に直す)
//   B: 一般名詞 / 偶然の文字列      → 許可 (`QABC` を含む URL、sha512 hash 等)
//   C: 過去 Issue/PR の固有名・歴史 → 許可 (`QA self-implement 第 N 弾` / `QA Adversarial security 軸`)
//
// C を書き換えると git 履歴と Issue を突き合わせられなくなる
// (`docs/decisions/README.md` §renumber 規約「過去 PR / コミット本文の参照は更新しない」と同じ原則)。

import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (#4085): 実行時間が repo の file 数に比例するため明示 timeout を置く。
vi.setConfig({ testTimeout: 60_000 });

/** ロールを指す `QA` の collocation。ここに挙げた形だけを禁止する (A 分類)。 */
const FORBIDDEN_ROLE_PATTERNS = [
	'QA セッション',
	'QA チーム',
	'QA team',
	'QA レビュー',
	'QA 承認',
	'QA approve',
	'QA merge',
	'QA BLOCK',
	'QA アカウント',
	'QA クローン',
	'品質管理（QA）',
	'QA Review Agent',
	'QA Re-Review Agent',
	'QA Session Agent',
];

/**
 * 走査対象。**drift が実際に起きる場所**を見る
 * (`check-internal-terms.mjs` は顧客 UI しか見ないため本 guard が別に要る)。
 */
const GLOBS = [
	'docs/**/*.md',
	'.claude/**/*.md',
	'scripts/**/*.mjs',
	'tests/**/*.ts',
	'src/**/*.ts',
	'*.md',
];

/**
 * 除外。**security control の実体**は触らない (#4177 AC8)。
 *
 * `claude-hook-prevent-qa-account-pr.mjs` は ADR-0022 L1 の PreToolUse hook で、
 * `.claude/settings.json` が file 名で起動する。名前が指しているのは **gh アカウント**
 * (`ganbariquestsupport-lab`) であり、ロール名の統一とは別の軸である。
 * 見た目を揃えるために防御を触る利益がない。
 */
const EXCLUDED = [
	'scripts/claude-hook-prevent-qa-account-pr.mjs',
	// 本 file 自身 (禁止 pattern を literal で持つ)
	'tests/unit/architecture/qm-role-naming-consistency.test.ts',
];

function collectFiles(): string[] {
	const seen = new Set<string>();
	for (const g of GLOBS) {
		for (const f of globSync(g, { exclude: (p) => p.includes('node_modules') })) {
			seen.add(f.replace(/\\/g, '/'));
		}
	}
	return [...seen].filter((f) => !EXCLUDED.includes(f));
}

describe('#4177 AC6 品質管理ロールの表記は QM に統一する', () => {
	const files = collectFiles();

	// 母数が空なら「違反 0」ではなく「検査できていない」。glob が壊れて 0 件になったとき
	// 緑で素通りさせない (#4084 と同じ形)。
	it('[母数] 走査対象が十分に集まっている', () => {
		expect(files.length, 'glob が壊れて走査対象が集まっていません').toBeGreaterThan(100);
	});

	it('ロールを指す QA 表記が残っていない (A 分類)', () => {
		const violations: string[] = [];
		for (const file of files) {
			let content: string;
			try {
				content = readFileSync(file, 'utf8');
			} catch {
				continue;
			}
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i] ?? '';
				for (const pattern of FORBIDDEN_ROLE_PATTERNS) {
					if (line.includes(pattern)) {
						violations.push(`${file}:${i + 1} 「${pattern}」`);
					}
				}
			}
		}

		expect(
			violations,
			'品質管理ロールは QM です。ロールを指す QA 表記を QM に直してください。\n' +
				'**過去 Issue/PR の固有名 (QA self-implement 第 N 弾 / QA Adversarial security 軸) は対象外**' +
				'（書き換えると git 履歴と突き合わせられなくなる）。\n' +
				`検出:\n${violations.join('\n')}`,
		).toEqual([]);
	});
});
