#!/usr/bin/env node
/**
 * scripts/check-no-direct-env-access.mjs (ADR-0040 P1, #1210 で拡張)
 *
 * 以下 2 種類の env 読込を検出し、`src/lib/runtime/env.ts` 以外での使用を禁ずる:
 *   1. `process.env.X` / `process.env['X']` / `process.env["X"]`
 *   2. `$env/(dynamic|static)/(private|public)` 経由 import
 *
 * 設計:
 *  - grandfather list = ADR-0040 採択時点 (2026-04-19) に既に直接参照していた
 *    ファイル群。P2-P4 で段階的に `$lib/runtime/env` 経由へ移行する
 *  - 新規ファイル追加時は即時 fail
 *  - grandfather ファイルの「新しい env 追加」は静的に検出しづらいため、
 *    レビュアー責任 + `check-new-required-env.mjs` (ADR-0029) で補完
 *
 * 使用法: node scripts/check-no-direct-env-access.mjs
 * CI: エラー検出時は exit 1
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/** 唯一の読込点 (ADR-0040 P1) */
const SSOT = 'src/lib/runtime/env.ts';

/**
 * Grandfather list: ADR-0040 採択時 (2026-04-19) に既に process.env を直接参照
 * していたファイル。P2-P4 で `$lib/runtime/env` 経由へ段階的に移行する。
 *
 * このリストは P4 完了時にゼロになる予定。新規追加は禁止（レビュアーが reject）。
 *
 * #1210 で追加:
 *  - `$env/dynamic/private` 利用 4 ファイルを grandfather に追加
 */
const GRANDFATHER = new Set(
	[
		// --- process.env 直接参照 (ADR-0040 P1 採択時点) ---
		'src/hooks.server.ts',
		'src/lib/analytics/providers/dynamo.ts',
		'src/lib/analytics/providers/sentry.ts',
		'src/lib/analytics/providers/umami.ts',
		'src/lib/server/ai/bedrock-claude-provider.ts',
		'src/lib/server/ai/factory.ts',
		'src/lib/server/ai/gemini-provider.ts',
		'src/lib/server/auth/cron-auth.ts',
		'src/lib/server/auth/context-token.ts',
		'src/lib/server/auth/factory.ts',
		'src/lib/server/auth/providers/cognito-direct-auth.ts',
		'src/lib/server/auth/providers/cognito-jwt.ts',
		'src/lib/server/auth/providers/cognito-oauth.ts',
		'src/lib/server/cookie-config.ts',
		'src/lib/server/db/client.ts',
		'src/lib/server/db/dynamodb/client.ts',
		'src/lib/server/db/dynamodb/storage-repo.ts',
		'src/lib/server/db/factory.ts',
		'src/lib/server/db/seed.ts',
		'src/lib/server/debug-plan.ts',
		'src/lib/server/logger.ts',
		'src/lib/server/services/account-deletion-service.ts',
		'src/lib/server/services/breakeven-service.ts',
		'src/lib/server/services/email-service.ts',
		'src/lib/server/services/image-service.ts',
		'src/lib/server/services/license-key-service.ts',
		'src/lib/server/services/notification-service.ts',
		'src/lib/server/services/stripe-metrics-service.ts',
		'src/lib/server/services/umami-service.ts',
		'src/lib/server/stripe/client.ts',
		'src/lib/server/stripe/config.ts',
		'src/routes/api/cron/license-expire/+server.ts',
		'src/routes/api/health/+server.ts',
		'src/routes/api/v1/admin/tenant-cleanup/+server.ts',
		'src/routes/api/v1/settings/vapid-key/+server.ts',
		// --- $env/dynamic/private 経由 (#1210 で追加、P4 で移行) ---
		'src/lib/server/discord-alert.ts',
		'src/lib/server/services/discord-notify-service.ts',
		'src/lib/server/services/pricing-trigger-service.ts',
		// email-service.ts は上で既に掲載済み
	].map((p) => p.replace(/\//g, path.sep)),
);

/** 検査対象ディレクトリ / 拡張子 */
const SEARCH_ROOTS = ['src'];
const EXTENSIONS = new Set(['.ts', '.svelte']);

/** 除外 (定義上 process.env を参照しても問題ないもの) */
const EXCLUDE_PATTERNS = [/\.test\.ts$/, /\.spec\.ts$/];

/**
 * 検出パターン:
 * - `process.env.FOO_BAR` (ドット記法)
 * - `process.env['FOO']` / `process.env["FOO"]` (ブラケット記法)
 */
const PROCESS_ENV_REGEX = /\bprocess\.env(?:\.[A-Z][A-Z0-9_]*|\[\s*['"][A-Z][A-Z0-9_]*['"]\s*\])/;

/**
 * SvelteKit $env import 検出 (dynamic/static × private/public)。
 * 例: `import { env } from '$env/dynamic/private';`
 */
const SVELTE_ENV_IMPORT_REGEX = /from\s+['"]\$env\/(?:dynamic|static)\/(?:private|public)['"]/;

/**
 * 1 行文字列を検査して、マッチした検出種別を返す。
 * コメント行は呼び出し側で除外する。
 * @param {string} line
 * @returns {null | { kind: 'process.env' | '$env-import'; match: string }}
 */
export function detectEnvAccessInLine(line) {
	const p = line.match(PROCESS_ENV_REGEX);
	if (p) return { kind: 'process.env', match: p[0] };
	const s = line.match(SVELTE_ENV_IMPORT_REGEX);
	if (s) return { kind: '$env-import', match: s[0] };
	return null;
}

/**
 * ファイル本文全体を検査して、検出行の配列を返す (grandfather 判定は呼び出し側)。
 * @param {string} text
 * @returns {Array<{ line: number; kind: 'process.env' | '$env-import'; match: string; snippet: string }>}
 */
export function detectEnvAccessInText(text) {
	const lines = text.split(/\r?\n/);
	const hits = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// block comments / line comments で import 例示などは許す
		if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
		const hit = detectEnvAccessInLine(line);
		if (hit) {
			hits.push({
				line: i + 1,
				kind: hit.kind,
				match: hit.match,
				snippet: line.trim().slice(0, 120),
			});
		}
	}
	return hits;
}

function shouldExclude(absFile) {
	const rel = path.relative(REPO_ROOT, absFile);
	if (rel.replace(/\\/g, '/') === SSOT) return true;
	return EXCLUDE_PATTERNS.some((p) => p.test(rel));
}

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
			if (!shouldExclude(full)) out.push(full);
		}
	}
	return out;
}

function checkFile(absFile) {
	const rel = path.relative(REPO_ROOT, absFile);
	if (GRANDFATHER.has(rel)) return null; // allowed for now
	const text = fs.readFileSync(absFile, 'utf8');
	const hits = detectEnvAccessInText(text);
	if (hits.length === 0) return null;
	return { file: rel.replace(/\\/g, '/'), hits };
}

function main() {
	const files = [];
	for (const root of SEARCH_ROOTS) {
		walk(path.join(REPO_ROOT, root), files);
	}
	const violations = [];
	for (const f of files) {
		const r = checkFile(f);
		if (r) violations.push(r);
	}
	if (violations.length === 0) {
		console.log('[check-no-direct-env-access] OK — grandfather 外のファイルに env 直接参照なし');
		process.exit(0);
	}
	console.error(
		`[check-no-direct-env-access] NG — ${violations.length} ファイルに新規の env 直接参照があります (ADR-0040):\n`,
	);
	for (const v of violations) {
		console.error(`  ${v.file}`);
		for (const h of v.hits) {
			console.error(`    line ${h.line} [${h.kind}]: ${h.match}`);
			console.error(`      ${h.snippet}`);
		}
	}
	console.error(
		"\n→ src/lib/runtime/env.ts 経由で参照してください:\n    import { env } from '$lib/runtime/env';\n",
	);
	console.error(
		'→ 既存ファイルの grandfather 扱いは scripts/check-no-direct-env-access.mjs の GRANDFATHER を参照。',
	);
	console.error(
		'→ 新しい env を schema に追加する場合は src/lib/runtime/env.ts の envSchema に追記し、必須値なら',
	);
	console.error('  ADR-0029 に従い PR 本文に「配布済み: <ENV>」証跡を記載してください。');
	process.exit(1);
}

// スクリプトとして直接実行された場合のみ main を起動 (テストから import 時は skip)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main();
}
