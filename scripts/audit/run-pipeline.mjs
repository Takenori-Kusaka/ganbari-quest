#!/usr/bin/env node

/**
 * scripts/audit/run-pipeline.mjs (EPIC #2861 / B4 = #2867)
 *
 * finding pipeline の機械実行部分 (I/O 層) を束ねる CLI。
 * `tmp/audit-evidence/*.json` の領域別 evidence を読み込み、pure function module
 * (evidence-schema / dedup / severity-filter / aggregate-report) を順に適用して
 * 集約レポート `tmp/audit-run-<date>.md` を生成する (AC3 / AC4)。
 *
 * pipeline (audit-team.md §3.6 / audit-manager.md §E の機械化可能段):
 *   [1] 全件発露 (evidence file を読む)
 *   [2] schema 物理 verify (URL 欠落 / schema 不充足は自動棄却、無言棄却しない)
 *   [3] 重複統合 (partialFingerprints ベース)
 *   [4] severity filter (1-2 = backlog / 3-4 = 起票候補)
 *   → 集約レポート出力
 *
 * **CI には rules-based の本 pipeline のみ載せる**。ポリシー準拠 filter (LLM 判定) と
 * 起票実行は audit-manager orchestrator が本レポートを受けて実施 (EPIC 設計原則 1)。
 *
 * 使い方:
 *   node scripts/audit/run-pipeline.mjs --run-id baseline-20260610 [--scope baseline] \
 *     [--evidence-dir tmp/audit-evidence] [--out tmp/audit-run-20260610.md] [--strict]
 *
 *   --strict : schema 不充足 evidence が 1 件でもあれば exit 1 (CI gate 用、EPIC 設計原則 1)
 *
 * 終了コード:
 *   0 = 集約完了 (--strict 時は schema 不充足ゼロ)
 *   1 = evidence dir 不在 / parse 失敗 / (--strict で) schema 不充足あり
 *
 * 関連: .claude/agents/audit-manager.md §B / §E ｜ docs/sessions/audit-team.md §3.6
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildAggregateReport } from './aggregate-report.mjs';
import { dedupeFindings } from './dedup.mjs';
import { validateEvidence } from './evidence-schema.mjs';
import { partitionBySeverity } from './severity-filter.mjs';

function parseArgs(argv) {
	const args = {
		runId: null,
		scope: 'baseline',
		evidenceDir: 'tmp/audit-evidence',
		out: null,
		strict: false,
		help: false,
	};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		if (a === '--run-id') args.runId = next();
		else if (a.startsWith('--run-id=')) args.runId = a.slice('--run-id='.length);
		else if (a === '--scope') args.scope = next();
		else if (a.startsWith('--scope=')) args.scope = a.slice('--scope='.length);
		else if (a === '--evidence-dir') args.evidenceDir = next();
		else if (a.startsWith('--evidence-dir=')) args.evidenceDir = a.slice('--evidence-dir='.length);
		else if (a === '--out') args.out = next();
		else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
		else if (a === '--strict') args.strict = true;
		else if (a === '-h' || a === '--help') args.help = true;
	}
	return args;
}

function printHelp() {
	const lines = [
		'Usage:',
		'  node scripts/audit/run-pipeline.mjs --run-id <id> [options]',
		'',
		'Options:',
		'  --run-id <id>           run 識別子 (例: baseline-20260610 / 2950-20260610) [必須]',
		'  --scope <s>             baseline | integration (default: baseline)',
		'  --evidence-dir <dir>    領域別 evidence JSON dir (default: tmp/audit-evidence)',
		'  --out <file>            集約レポート出力先 (default: tmp/audit-run-<date>.md)',
		'  --strict                schema 不充足 evidence があれば exit 1 (CI gate 用)',
		'',
		'pipeline: 全件発露 → schema verify (URL 欠落/不充足は自動棄却) → 重複統合 → severity filter',
		'See .claude/agents/audit-manager.md §B/§E / docs/sessions/audit-team.md §3.6',
	];
	process.stdout.write(`${lines.join('\n')}\n`);
}

/** YYYYMMDD (UTC) */
function todayStamp() {
	return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function main() {
	const args = parseArgs(process.argv);
	if (args.help) {
		printHelp();
		process.exit(0);
	}
	if (!args.runId) {
		process.stderr.write('[audit-run-pipeline] --run-id <id> が必要です。\n');
		printHelp();
		process.exit(1);
	}

	const evidenceDir = path.resolve(args.evidenceDir);
	if (!existsSync(evidenceDir)) {
		process.stderr.write(`[audit-run-pipeline] evidence dir が存在しません: ${evidenceDir}\n`);
		process.stderr.write(
			'  各領域 subagent が tmp/audit-evidence/<team>.json を Write してから実行してください。\n',
		);
		process.exit(1);
	}

	const files = readdirSync(evidenceDir).filter((f) => f.endsWith('.json'));
	if (files.length === 0) {
		process.stderr.write(`[audit-run-pipeline] evidence JSON が 0 件です: ${evidenceDir}\n`);
		process.exit(1);
	}

	/** @type {Array<{ team: string, finding: object }>} */
	const accepted = [];
	/** @type {string[]} */
	const rejectedEvidence = [];
	let schemaFailures = 0;
	let integrationPr = 0;

	for (const file of files) {
		const full = path.join(evidenceDir, file);
		let parsed;
		try {
			parsed = JSON.parse(readFileSync(full, 'utf8'));
		} catch (e) {
			schemaFailures++;
			rejectedEvidence.push(`evidence file \`${file}\` の JSON parse 失敗: ${e.message}`);
			continue;
		}

		const result = validateEvidence(parsed);
		if (Number.isInteger(parsed?.integration_pr) && parsed.integration_pr > 0) {
			integrationPr = parsed.integration_pr;
		}
		if (!result.ok) {
			schemaFailures++;
			rejectedEvidence.push(
				`evidence file \`${file}\` (team=${parsed?.team ?? '?'}) schema 不充足 → 領域ごと自動棄却: ${result.errors.join(' / ')}`,
			);
			continue;
		}

		for (const finding of parsed.findings) {
			accepted.push({ team: parsed.team, finding });
		}
	}

	// [3] 重複統合 + [4] severity filter
	const dedup = dedupeFindings(accepted);
	const { escalated, backlog } = partitionBySeverity(dedup.merged);

	const generatedAt = new Date().toISOString();
	const md = buildAggregateReport({
		runId: args.runId,
		scope: args.scope,
		integrationPr,
		generatedAt,
		stats: {
			rawFindingCount: dedup.inputCount,
			mergedCount: dedup.mergedCount,
			duplicatesRemoved: dedup.duplicatesRemoved,
			escalatedCount: escalated.length,
			backlogCount: backlog.length,
		},
		rejectedEvidence,
		escalated,
		backlog,
	});

	const outPath = path.resolve(args.out ?? `tmp/audit-run-${todayStamp()}.md`);
	mkdirSync(path.dirname(outPath), { recursive: true });
	writeFileSync(outPath, md, 'utf8');

	process.stdout.write(`[audit-run-pipeline] 集約レポート出力: ${outPath}\n`);
	process.stdout.write(
		`  全件発露 ${dedup.inputCount} / 重複統合後 ${dedup.mergedCount} (重複 -${dedup.duplicatesRemoved}) / ` +
			`起票候補 ${escalated.length} / backlog ${backlog.length} / 自動棄却 ${rejectedEvidence.length}\n`,
	);

	if (args.strict && schemaFailures > 0) {
		process.stderr.write(
			`[audit-run-pipeline] --strict: schema 不充足 evidence ${schemaFailures} 件 → exit 1 (self-report 単独信頼禁止)\n`,
		);
		process.exit(1);
	}

	process.exit(0);
}

main();
