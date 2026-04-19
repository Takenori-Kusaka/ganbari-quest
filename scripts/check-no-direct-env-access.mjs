#!/usr/bin/env node
/**
 * scripts/check-no-direct-env-access.mjs (ADR-0040 P1)
 *
 * `process.env.X` の直接参照を検出する。唯一の読込点は
 * `src/lib/runtime/env.ts` のみ。新規ファイル / grandfather 外のファイルに
 * 直接参照が入ったら CI を fail させる。
 *
 * 設計:
 *  - grandfather list = ADR-0040 採択時点 (2026-04-19) に既に process.env を
 *    直接参照していた 35 ファイル。P2-P4 で段階的に `$lib/runtime/env` 経由へ
 *    移行する
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
 */
const GRANDFATHER = new Set(
	[
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
	].map((p) => p.replace(/\//g, path.sep)),
);

/** 検査対象ディレクトリ / 拡張子 */
const SEARCH_ROOTS = ['src'];
const EXTENSIONS = new Set(['.ts', '.svelte']);

/** 除外 (定義上 process.env を参照しても問題ないもの) */
const EXCLUDE_PATTERNS = [/\.test\.ts$/, /\.spec\.ts$/];

/** 検出パターン */
const ENV_REGEX = /\bprocess\.env\.[A-Z][A-Z0-9_]*/;

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
	const lines = text.split(/\r?\n/);
	const hits = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// block comments / line comments で import 例示などは許す
		if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
		const m = line.match(ENV_REGEX);
		if (m) {
			hits.push({ line: i + 1, match: m[0], snippet: line.trim().slice(0, 120) });
		}
	}
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
		console.log(
			'[check-no-direct-env-access] OK — grandfather 外のファイルに process.env 直接参照なし',
		);
		process.exit(0);
	}
	console.error(
		`[check-no-direct-env-access] NG — ${violations.length} ファイルに新規の process.env 直接参照があります (ADR-0040):\n`,
	);
	for (const v of violations) {
		console.error(`  ${v.file}`);
		for (const h of v.hits) {
			console.error(`    line ${h.line}: ${h.match}`);
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

main();
