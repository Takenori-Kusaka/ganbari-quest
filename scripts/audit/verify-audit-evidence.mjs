#!/usr/bin/env node

/**
 * scripts/audit/verify-audit-evidence.mjs (EPIC #2861 / B4 = #2867)
 *
 * 単一の領域 evidence file (`tmp/audit-evidence/<file>.json`) を schema 検証する CLI。
 * `scripts/verify-adversarial-output.mjs` と同じ「pure 検証関数を import して CLI 化」
 * パターン。audit-manager が dispatch 後に各領域 evidence を物理 verify する際に使う
 * (audit-manager.md §B / §E [2])。
 *
 * 使い方:
 *   node scripts/audit/verify-audit-evidence.mjs --file tmp/audit-evidence/security.json
 *
 * 出力:
 *   PASS: exit 0 + stdout に finding 件数サマリ
 *   FAIL: exit 1 + stderr に違反一覧 + 修正手順
 *
 * 関連:
 *   - scripts/audit/evidence-schema.mjs (validateEvidence を共有)
 *   - scripts/verify-adversarial-output.mjs (本 CLI の既存パターン)
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateEvidence } from './evidence-schema.mjs';

function parseArgs(argv) {
	const args = { file: null, help: false };
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--file' && i + 1 < argv.length) {
			args.file = argv[++i];
		} else if (a.startsWith('--file=')) {
			args.file = a.slice('--file='.length);
		} else if (a === '-h' || a === '--help') {
			args.help = true;
		}
	}
	return args;
}

function printHelp() {
	process.stdout.write(
		[
			'Usage:',
			'  node scripts/audit/verify-audit-evidence.mjs --file <path>',
			'',
			'Verifies a single audit evidence JSON against the schema in',
			'scripts/audit/evidence-schema.mjs (audit-manager.md §B):',
			'  - run_id / integration_pr / team (許容値)',
			'  - 各 finding: id / title / location / detail / severity(1-4) / policy_candidate',
			'  - SARIF 互換: ruleId / level / locations / (任意) partialFingerprints',
			'  - competitive / audit-manager-cuj は evidence_urls 必須',
			'',
			'See .claude/agents/audit-manager.md §B / scripts/verify-adversarial-output.mjs',
		].join('\n') + '\n',
	);
}

function main() {
	const args = parseArgs(process.argv);
	if (args.help) {
		printHelp();
		process.exit(0);
	}
	if (!args.file) {
		process.stderr.write('[verify-audit-evidence] --file <path> が必要です。\n');
		printHelp();
		process.exit(1);
	}

	const full = path.resolve(args.file);
	if (!existsSync(full)) {
		process.stderr.write(`[verify-audit-evidence] FAIL: evidence file 不在: ${full}\n`);
		process.stderr.write(
			'  該当領域 subagent を再 dispatch し evidence を Write してください (無言で自筆 evidence に差し替えない)。\n',
		);
		process.exit(1);
	}

	let parsed;
	try {
		parsed = JSON.parse(readFileSync(full, 'utf8'));
	} catch (e) {
		process.stderr.write(`[verify-audit-evidence] FAIL: JSON parse 失敗: ${e.message}\n`);
		process.exit(1);
	}

	const result = validateEvidence(parsed);
	if (result.ok) {
		process.stdout.write(
			`[verify-audit-evidence] PASS: ${path.basename(full)} (team=${parsed.team}) schema 適合。finding ${result.findingCount} 件。\n`,
		);
		process.exit(0);
	}

	process.stderr.write(
		`[verify-audit-evidence] FAIL: ${path.basename(full)} schema 不充足 (${result.errors.length} 件)\n`,
	);
	for (const e of result.errors) {
		process.stderr.write(`  - ${e}\n`);
	}
	process.stderr.write('  根拠: .claude/agents/audit-manager.md §B evidence schema\n');
	process.exit(1);
}

main();
