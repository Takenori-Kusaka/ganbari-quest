#!/usr/bin/env node
/**
 * scripts/check-drizzle-journal.mjs
 *
 * #3953: drizzle journal (`drizzle/<dialect>/meta/_journal.json`) の `when` 値域 gate を
 * **commit 時点で**踏めるようにする薄い CLI 入口。
 *
 * ## なぜ CLI が要るのか (#3951 監査 accepted-residual 対象 2)
 *
 * #3948 の gate は `tests/unit/db/pglite-journal-when-range-3948.test.ts` (vitest) からしか
 * 発火しない = 気づくのは push 後 (CI)。journal を手で書き換えた開発者に対する予防導線は
 * `.claude/skills/db-migration/SKILL.md` (agent 向け) だけで、**人間の手編集には何も無かった**。
 *
 * `.husky/pre-commit` (#2086) には「特定パスが staged のときだけ検査を走らせる」前例があるので、
 * 同じ形で `drizzle/<dialect>/meta/_journal.json` が staged のときだけ本 CLI を走らせる。全 commit を
 * 重くしないため、ADR-0030 (pre-push hook 非採用 / DX 重視) の趣旨とも矛盾しない。
 *
 * ## 判定ロジックは複製しない
 *
 * 値域ルール (R1-R4) / grandfather / glob 走査はすべて `scripts/lib/db/drizzle-journal-gate.mjs`
 * (SSOT) 側にある。本 file は「実行して結果を印字し exit code を決める」だけ。
 *
 * ## 使い方
 *
 *   node scripts/check-drizzle-journal.mjs          # 違反があれば exit 1
 *   node scripts/check-drizzle-journal.mjs --help
 *
 * ## 関連
 *   - scripts/lib/db/drizzle-journal-gate.mjs (判定 SSOT)
 *   - tests/unit/db/pglite-journal-when-range-3948.test.ts (CI 側の発火点)
 *   - .husky/pre-commit (#2086 staged path 限定検査の前例)
 *   - Issue #3946 / #3948 / #3953
 */

import {
	checkAllJournals,
	formatAllJournalViolations,
	JOURNAL_GLOB,
} from './lib/db/drizzle-journal-gate.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

function printHelp() {
	console.log(`check-drizzle-journal.mjs — drizzle journal の \`when\` 値域 gate (Issue #3948 / #3953)

走査対象: ${JOURNAL_GLOB} (発見した全 journal に適用。0 件マッチも fail)
検証ルール:
  R1 when が未来でない / R2 手書きの丸め値・連番でない
  R3 プロジェクト開始より過去でない / R4 idx 連番 + when 狭義単調増加
  R0 journal が 1 本も無い / JSON として読めない

判定 SSOT: scripts/lib/db/drizzle-journal-gate.mjs
使い方   : node scripts/check-drizzle-journal.mjs`);
}

function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp();
		return 0;
	}
	const { files, violations } = checkAllJournals(process.cwd());

	if (violations.length === 0) {
		console.log(
			`[check-drizzle-journal] OK: ${files.length} 件の journal が全ルールを満たしています (${files.join(', ')})`,
		);
		return 0;
	}

	console.error(`[check-drizzle-journal] FAIL: ${violations.length} 件の違反`);
	console.error(formatAllJournalViolations(violations));
	console.error(
		'\n  → drizzle-kit が生成した `when` を手で書き換えないでください (手順 SSOT: .claude/skills/db-migration/SKILL.md)。',
	);
	return 1;
}

if (isMainModule(import.meta.url)) {
	process.exit(main());
}
