#!/usr/bin/env node
/**
 * #2818 / ADR-0055 — DynamoDB repo stub parity guard
 *
 * 背景: per-child / family repo の interface を拡張したのに DynamoDB 実装を stub
 *   (`notImplemented(...)` throw / `warnRead(...)` / `warnWrite(...)` 空返却) のまま
 *   放置すると、本番 cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で
 *   write 経路が永続せず、UI が「N 件登録しました」と偽る (#2818 marketplace 取込 CRITICAL)。
 *
 * 本 guard は `src/lib/server/db/dynamodb/*.ts` の stub call-site を inventory 化し、
 *   既知 baseline (`scripts/dynamodb-stub-baseline.json`) を超える「新規 stub」を検出すると
 *   exit 1 で CI を red にする。これにより「interface 拡張したのに dynamodb 未実装」の
 *   silent な後退を機械的に禁止する。baseline は Phase 2/3 で本実装するたびに削っていく。
 *
 * 検出パターン (call-site のみ。helper 定義行 `function notImplemented`/`function warnRead`/
 *   `function warnWrite` は除外):
 *   - `notImplemented('<method>')` / `notImplementedWrite('<method>')`
 *   - `warnRead('<method>', ...)`
 *   - `warnWrite('<method>', ...)`
 *
 * 使い方:
 *   node scripts/check-dynamodb-stub-parity.mjs            # baseline 照合 (CI / 既定)
 *   node scripts/check-dynamodb-stub-parity.mjs --list     # 現在の inventory を表示 (exit 0)
 *   node scripts/check-dynamodb-stub-parity.mjs --update   # baseline を現状で再生成 (本実装時のみ)
 *
 * exit:
 *   0 = baseline 以下 (新規 stub なし、または baseline 減少のみ)
 *   1 = baseline を超える新規 stub 追加、または baseline ファイル不在
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DYNAMO_DIR = join(REPO_ROOT, 'src', 'lib', 'server', 'db', 'dynamodb');
const BASELINE_PATH = join(__dirname, 'dynamodb-stub-baseline.json');

// call-site を検出する (helper 定義行は function キーワードで始まるため除外される)
const STUB_CALL_RE = /\b(?:notImplemented(?:Write)?|warnRead|warnWrite)\s*\(\s*['"]([^'"]+)['"]/g;

/** 各 repo file の stub method 名一覧を収集する。 */
function collectInventory() {
	const inventory = {};
	const files = readdirSync(DYNAMO_DIR)
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
		.sort();

	for (const file of files) {
		const content = readFileSync(join(DYNAMO_DIR, file), 'utf8');
		const methods = new Set();
		for (const line of content.split('\n')) {
			// helper 定義行 (`function notImplemented(method: string)`) は除外
			if (/^\s*function\s+(?:notImplemented|warnRead|warnWrite)/.test(line)) continue;
			let m;
			STUB_CALL_RE.lastIndex = 0;
			while ((m = STUB_CALL_RE.exec(line)) !== null) {
				methods.add(m[1]);
			}
		}
		if (methods.size > 0) {
			inventory[`src/lib/server/db/dynamodb/${file}`] = [...methods].sort();
		}
	}
	return inventory;
}

function loadBaseline() {
	try {
		return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
	} catch {
		return null;
	}
}

const args = process.argv.slice(2);
const inventory = collectInventory();

if (args.includes('--list')) {
	console.log(JSON.stringify(inventory, null, '\t'));
	const total = Object.values(inventory).reduce((s, m) => s + m.length, 0);
	console.log(
		`\n[dynamodb-stub-parity] ${Object.keys(inventory).length} repo / ${total} stub method`,
	);
	process.exit(0);
}

if (args.includes('--update')) {
	writeFileSync(BASELINE_PATH, `${JSON.stringify(inventory, null, '\t')}\n`, 'utf8');
	console.log(`[dynamodb-stub-parity] baseline updated: ${BASELINE_PATH}`);
	process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
	console.error(
		`[dynamodb-stub-parity] FAIL: baseline 不在 (${BASELINE_PATH})。` +
			'`node scripts/check-dynamodb-stub-parity.mjs --update` で生成してください。',
	);
	process.exit(1);
}

// baseline を超える新規 stub を検出する。
const violations = [];
for (const [file, methods] of Object.entries(inventory)) {
	const allowed = new Set(baseline[file] ?? []);
	for (const method of methods) {
		if (!allowed.has(method)) {
			violations.push(`${file} :: ${method}`);
		}
	}
}

if (violations.length > 0) {
	console.error('[dynamodb-stub-parity] FAIL: baseline を超える新規 stub を検出しました。');
	console.error(
		'  DynamoDB は本番 cognito Lambda (DATA_SOURCE=dynamodb) で稼働します。' +
			'interface を拡張したら DynamoDB 実装も本実装してください (ADR-0055 / #2818)。',
	);
	for (const v of violations) console.error(`  - ${v}`);
	console.error(
		'\n  意図的に baseline を更新する場合 (= 別 repo を本実装して stub が減った等):' +
			'\n    node scripts/check-dynamodb-stub-parity.mjs --update',
	);
	process.exit(1);
}

// baseline が現状より多い (= 本実装で stub が減った) 場合はガイダンスのみ (success)。
const baselineTotal = Object.values(baseline).reduce((s, m) => s + m.length, 0);
const currentTotal = Object.values(inventory).reduce((s, m) => s + m.length, 0);
if (currentTotal < baselineTotal) {
	console.log(
		`[dynamodb-stub-parity] OK (stub 減少: baseline ${baselineTotal} → 現状 ${currentTotal})。` +
			' baseline を更新してください: node scripts/check-dynamodb-stub-parity.mjs --update',
	);
} else {
	console.log(
		`[dynamodb-stub-parity] OK: ${Object.keys(inventory).length} repo / ${currentTotal} stub method (baseline 以下)。`,
	);
}
process.exit(0);
