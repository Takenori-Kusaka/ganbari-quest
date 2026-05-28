#!/usr/bin/env node

/**
 * scripts/verify-adversarial-output.mjs (ADR-0056)
 *
 * Adversarial Reviewer subagent が生成した `tmp/adversarial-evidence/<pr>.json` の
 * schema を検証する CLI script。`.claude/hooks/gate-approve.mjs` と同じ検証関数を
 * import し、人間 / Dev / QM が approve action 前に手動で確認できるようにする。
 *
 * 使い方:
 *   node scripts/verify-adversarial-output.mjs --pr 2588
 *
 * 出力:
 *   - PASS: exit 0 + stdout に schema 内容サマリ
 *   - FAIL: exit 1 + stderr に修正手順
 *
 * 関連:
 *   - ADR-0056 (本 script の設計根拠 SSOT)
 *   - .claude/hooks/gate-approve.mjs (本 script と verifyEvidence 共有)
 *   - .claude/skills/adversarial-reviewer/SKILL.md (subagent 仕様)
 */

import { verifyEvidence } from '../.claude/hooks/gate-approve.mjs';

function parseArgs(argv) {
	const args = { pr: null };
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--pr' && i + 1 < argv.length) {
			args.pr = Number(argv[i + 1]);
			i++;
		} else if (a.startsWith('--pr=')) {
			args.pr = Number(a.slice('--pr='.length));
		} else if (a === '-h' || a === '--help') {
			args.help = true;
		}
	}
	return args;
}

function printHelp() {
	const usage = [
		'Usage:',
		'  node scripts/verify-adversarial-output.mjs --pr <number>',
		'',
		'Verifies tmp/adversarial-evidence/<pr>.json against the schema enforced by',
		'  - must_object_count === 3 (literal)',
		'  - objections.length === 3',
		'  - 3 axes (business / UX / security) all covered',
		'  - each reason.length >= 100 chars',
		'  - mtime within 30 min TTL',
		'',
		'See ADR-0056 / .claude/skills/adversarial-reviewer/SKILL.md',
	].join('\n');
	process.stdout.write(`${usage}\n`);
}

async function main() {
	const args = parseArgs(process.argv);
	if (args.help) {
		printHelp();
		process.exit(0);
	}
	if (!args.pr || Number.isNaN(args.pr)) {
		process.stderr.write('[verify-adversarial-output] --pr <number> が必要です。\n');
		printHelp();
		process.exit(1);
	}

	const result = verifyEvidence(args.pr);
	if (result.ok) {
		process.stdout.write(
			`[verify-adversarial-output] PASS: PR #${args.pr} の Adversarial Reviewer evidence は schema 適合。\n`,
		);
		process.stdout.write(
			`  3 軸 (business / UX / security) 反対理由 3 件 / 各 reason >= 100 文字 / TTL 30 分以内 OK\n`,
		);
		process.exit(0);
	}

	process.stderr.write(`[verify-adversarial-output] FAIL: PR #${args.pr} の evidence 検証 fail.\n`);
	process.stderr.write(`  reason: ${result.reason}\n`);
	process.stderr.write(`  対処:\n`);
	process.stderr.write(
		`    1. Adversarial Reviewer subagent を dispatch (\`.claude/skills/adversarial-reviewer/SKILL.md\`)\n`,
	);
	process.stderr.write(
		`    2. subagent が \`tmp/adversarial-evidence/${args.pr}.json\` に structured JSON を書き出す\n`,
	);
	process.stderr.write(`    3. 本 script を再実行して PASS を確認\n`);
	process.stderr.write(`  根拠: ADR-0056 / docs/research/qm-drift-prevention-2026-05-28.md\n`);
	process.exit(1);
}

main();
