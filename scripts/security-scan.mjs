#!/usr/bin/env node

/**
 * OSS 脆弱性診断スクリプト (#985 / ADR-0032 T4)
 *
 * 3 つのツールを順次実行し、結果を reports/security/YYYY-MM-DD/ に集約する。
 *
 * 1. npm audit (built-in) — npm の依存脆弱性チェック
 * 2. osv-scanner (optional) — OSV.dev の広範な脆弱性 DB にクエリ
 * 3. semgrep (optional) — コードパターン脆弱性検出
 *
 * Usage:
 *   npm run security:scan
 *   node scripts/security-scan.mjs [--output-dir <dir>]
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ===== Configuration =====

const today = new Date().toISOString().split('T')[0];
const outputDirArg = process.argv.find((_, i, arr) => arr[i - 1] === '--output-dir');
const outputDir = outputDirArg || join('reports', 'security', today);

// ===== Helpers =====

function ensureDir(dir) {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function commandExists(cmd) {
	try {
		execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 10_000 });
		return true;
	} catch {
		return false;
	}
}

function runTool(name, command, outputFile) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`[${name}] Running...`);
	console.log(`${'='.repeat(60)}`);

	try {
		const result = execSync(command, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 300_000, // 5 min timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB
		});
		writeFileSync(outputFile, result);
		console.log(`[${name}] Completed. Output: ${outputFile}`);
		return { success: true, findings: false };
	} catch (err) {
		// npm audit exits non-zero when vulnerabilities found — that's expected
		if (err.stdout) {
			writeFileSync(outputFile, err.stdout);
			console.log(`[${name}] Completed with findings. Output: ${outputFile}`);
			return { success: true, findings: true };
		}
		if (err.stderr) {
			writeFileSync(outputFile, `STDERR:\n${err.stderr}\n\nSTDOUT:\n${err.stdout || '(empty)'}`);
		}
		console.error(`[${name}] Failed: ${err.message}`);
		return { success: false, findings: false };
	}
}

// ===== Main =====

console.log('OSS Security Scan (#985 / ADR-0032 T4)');
console.log(`Output directory: ${outputDir}`);
console.log(`Date: ${today}`);

ensureDir(outputDir);

const results = [];

// ----- 1. npm audit -----
{
	const outputFile = join(outputDir, 'npm-audit.json');
	const result = runTool(
		'npm audit',
		'npm audit --json',
		outputFile,
	);
	results.push({ tool: 'npm audit', ...result });

	// Also generate human-readable output
	const readableFile = join(outputDir, 'npm-audit.txt');
	runTool('npm audit (readable)', 'npm audit', readableFile);
}

// ----- 2. osv-scanner (optional) -----
{
	const outputFile = join(outputDir, 'osv-scanner.json');
	if (commandExists('osv-scanner')) {
		const result = runTool(
			'osv-scanner',
			'osv-scanner --lockfile=package-lock.json --format json',
			outputFile,
		);
		results.push({ tool: 'osv-scanner', ...result });
	} else {
		console.log('\n[osv-scanner] Not installed. Skipping.');
		console.log('  Install: brew install osv-scanner');
		console.log('  Or: go install github.com/google/osv-scanner/cmd/osv-scanner@latest');
		console.log('  See: docs/security/scan.md');
		writeFileSync(outputFile, JSON.stringify({ skipped: true, reason: 'osv-scanner not installed' }, null, 2));
		results.push({ tool: 'osv-scanner', success: false, findings: false, skipped: true });
	}
}

// ----- 3. semgrep (optional) -----
{
	const outputFile = join(outputDir, 'semgrep.json');
	if (commandExists('semgrep')) {
		const result = runTool(
			'semgrep',
			'semgrep scan --config auto --json --timeout 300 src/',
			outputFile,
		);
		results.push({ tool: 'semgrep', ...result });
	} else {
		console.log('\n[semgrep] Not installed. Skipping.');
		console.log('  Install: pip install semgrep');
		console.log('  Or: brew install semgrep');
		console.log('  See: docs/security/scan.md');
		writeFileSync(outputFile, JSON.stringify({ skipped: true, reason: 'semgrep not installed' }, null, 2));
		results.push({ tool: 'semgrep', success: false, findings: false, skipped: true });
	}
}

// ----- Summary -----
console.log(`\n${'='.repeat(60)}`);
console.log('Summary');
console.log(`${'='.repeat(60)}`);

const summaryLines = [];
for (const r of results) {
	const status = r.skipped
		? 'SKIPPED (not installed)'
		: r.success
			? r.findings
				? 'FINDINGS DETECTED'
				: 'CLEAN'
			: 'ERROR';
	const line = `${r.tool}: ${status}`;
	console.log(`  ${line}`);
	summaryLines.push(line);
}

const summaryFile = join(outputDir, 'summary.txt');
writeFileSync(summaryFile, [
	`Security Scan Summary — ${today}`,
	'',
	...summaryLines,
	'',
	`Full results: ${outputDir}/`,
	'',
	'Next steps:',
	'- severity high 以上の finding は個別 Issue として起票する',
	'- low/info は本 Issue のコメントに集約可',
	'- 詳細手順: docs/security/scan.md',
].join('\n'));

console.log(`\nSummary written to: ${summaryFile}`);

// Exit with non-zero if any tool found vulnerabilities
const hasFindings = results.some((r) => r.findings);
if (hasFindings) {
	console.log('\n⚠ Vulnerabilities found. Review reports and file Issues as needed.');
	process.exit(1);
}

console.log('\n✓ No vulnerabilities found.');
