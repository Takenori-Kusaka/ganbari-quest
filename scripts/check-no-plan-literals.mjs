#!/usr/bin/env node
/**
 * scripts/check-no-plan-literals.mjs (#972)
 *
 * プラン / ステータス値の文字列リテラル直書きを検出する。
 * 新規コードは `$lib/domain/constants/*` の定数経由で参照すること。
 *
 * 検出対象:
 *  - LicensePlan 値 ('monthly' | 'yearly' | 'family-monthly' | 'family-yearly' | 'lifetime')
 *  - SubscriptionStatus の非自明な値 ('grace_period' | 'terminated')
 *  - LicenseKeyStatus の非自明な値 ('consumed' | 'revoked')
 *  - AuthLicenseStatus の文脈識別できる値
 *
 * ※ 'active' / 'suspended' / 'none' / 'expired' のような汎用短語は他ドメインでも頻用されるため
 *    本スクリプトでは対象外。レビューと型で担保する。
 *
 * 使用法: node scripts/check-no-plan-literals.mjs
 * CI: エラー検出時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * 検出ルール (曖昧性のない = 他ドメインで流用されない値のみ)
 *  - 'monthly' / 'yearly' / 'terminated' / 'consumed' / 'revoked' / 'lifetime' は
 *    チャレンジ周期・sitemap changefreq・汎用ステータス等で正当に使われるため対象外
 *  - kebab-case の `family-*` と snake_case の `grace_period` はライセンス文脈固有
 */
const RULES = [
	{ pattern: 'family-monthly', constant: 'LICENSE_PLAN.FAMILY_MONTHLY' },
	{ pattern: 'family-yearly', constant: 'LICENSE_PLAN.FAMILY_YEARLY' },
	{ pattern: 'grace_period', constant: 'SUBSCRIPTION_STATUS.GRACE_PERIOD' },
];

/** 検査対象ディレクトリと拡張子 */
const SEARCH_ROOTS = ['src/lib/server', 'src/hooks.server.ts', 'src/routes'];
const EXTENSIONS = ['.ts', '.svelte'];

/**
 * 検査除外パス (定数定義・マイグレーション・外部 API 互換レイヤ・テスト)
 *  - 定数ファイル本体: ここでリテラルを定義しているので当然除外
 *  - Stripe webhook layer: Stripe SDK の生の subscription.status 値を扱うため除外
 *  - drizzle schema: DB カラム名ではなく SQL default 値として出現する場合がある
 */
const EXCLUDE_PATTERNS = [
	/src[\\/]lib[\\/]domain[\\/]constants[\\/]/,
	/src[\\/]lib[\\/]server[\\/]services[\\/]stripe-service\.ts$/,
	/src[\\/]lib[\\/]server[\\/]db[\\/].*[\\/]schema\.ts$/,
	/src[\\/]lib[\\/]server[\\/]db[\\/]migrations[\\/]/,
	/\.test\.ts$/,
	/\.spec\.ts$/,
];

function shouldExclude(filePath) {
	const rel = path.relative(REPO_ROOT, filePath);
	return EXCLUDE_PATTERNS.some((p) => p.test(rel));
}

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	const stat = fs.statSync(dir);
	if (stat.isFile()) {
		if (EXTENSIONS.some((ext) => dir.endsWith(ext)) && !shouldExclude(dir)) {
			out.push(dir);
		}
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			if (!shouldExclude(full)) out.push(full);
		}
	}
	return out;
}

function makeMatchers(pattern) {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return [
		new RegExp(`['"\`]${escaped}['"\`]`),
	];
}

function checkFile(filePath) {
	const text = fs.readFileSync(filePath, 'utf8');
	const lines = text.split(/\r?\n/);
	const findings = [];
	for (const rule of RULES) {
		const matchers = makeMatchers(rule.pattern);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// コメント行はスキップ (行頭//, /* ... */ 内は完全検出しないが誤検知抑止優先)
			if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
			for (const m of matchers) {
				if (m.test(line)) {
					findings.push({
						file: path.relative(REPO_ROOT, filePath),
						line: i + 1,
						pattern: rule.pattern,
						constant: rule.constant,
						snippet: line.trim().slice(0, 120),
					});
					break;
				}
			}
		}
	}
	return findings;
}

function main() {
	const files = [];
	for (const root of SEARCH_ROOTS) {
		walk(path.join(REPO_ROOT, root), files);
	}
	const allFindings = [];
	for (const f of files) {
		allFindings.push(...checkFile(f));
	}
	if (allFindings.length === 0) {
		console.log('[check-no-plan-literals] OK — リテラル直書きなし');
		process.exit(0);
	}
	console.error(
		`[check-no-plan-literals] NG — ${allFindings.length} 件のリテラル直書きを検出しました:\n`,
	);
	for (const f of allFindings) {
		console.error(`  ${f.file}:${f.line}`);
		console.error(`    ${f.snippet}`);
		console.error(`    → ${f.constant} を使用してください (pattern: '${f.pattern}')\n`);
	}
	console.error(
		'定数の場所: src/lib/domain/constants/{license-plan,subscription-status,license-key-status,auth-license-status}.ts',
	);
	process.exit(1);
}

main();
