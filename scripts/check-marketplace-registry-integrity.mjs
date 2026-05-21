#!/usr/bin/env node
/**
 * scripts/check-marketplace-registry-integrity.mjs (Issue #2374、EPIC #2362 P4 / AN-5 #2180 補強 7)
 *
 * `MarketplaceTypeRegistry` (ADR-0052) の完整性を CI で常時検証する。
 *
 * 検証内容:
 *   1. `src/lib/marketplace/types.ts` の `MARKETPLACE_TYPE_CODES` (SSOT 5 値) を抽出
 *   2. `src/lib/marketplace/index.ts` で全 type が `import './types/<code>'` で side-effect import されている
 *   3. `src/lib/marketplace/types/<code>.ts` が存在し、以下を全て持つ
 *      - `marketplaceRegistry.register(...)` 呼出
 *      - Descriptor object (typeCode / displayLabel / description / strategy / requiresChildId)
 *      - `strategy` import (`../strategies/<code>-strategy.js`)
 *      - `schema` import (`../schemas/<code>-schema.js`)
 *   4. Strategy ファイル (`src/lib/marketplace/strategies/<code>-strategy.ts`) が存在
 *   5. Schema ファイル (`src/lib/marketplace/schemas/<code>-schema.ts`) が存在
 *
 * 1 件でも欠落 → exit 1、明確な error メッセージ + 追加すべきファイル path 提示。
 *
 * AST parse は重いため正規表現 + ファイル存在チェック (本 script は構造完整性のみで
 * Strategy 内部の型整合は `svelte-check` が別途検証するため十分)。
 *
 * 使用法:
 *   node scripts/check-marketplace-registry-integrity.mjs
 *   node scripts/check-marketplace-registry-integrity.mjs --root <dir>   # #2389: 任意 root (fixture isolation 等) で検証
 *   npm run check:marketplace-registry-integrity
 *
 * --root <dir> 引数 (#2389、Copilot AC1 fixture isolation):
 *   検証対象を <dir> 直下の `src/lib/marketplace/**` に差し替える。テストや CI で
 *   特定の異常シナリオ fixture を分離した木構造で検証する用途。指定が無ければ従来通り
 *   リポジトリルートの `src/lib/marketplace/**` を対象とする。
 *
 * 関連:
 *   - ADR-0052 (MarketplaceTypeRegistry + ImportStrategy)
 *   - EPIC #2362 / Issue #2374 (本 CI gate の起票)
 *   - Issue #2389 (PR #2386 follow-up — fixture 隔離化)
 *   - AN-5 #2180 補強 7 (構造的再発防止)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

/**
 * CLI 引数を解析して { root } を返す (#2389)。
 * 受け付ける形式: `--root <dir>` / `--root=<dir>`
 */
function parseArgs(argv) {
	let root = DEFAULT_REPO_ROOT;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--root') {
			const next = argv[i + 1];
			if (!next) {
				console.error(`[check-marketplace-registry-integrity] --root に値が指定されていません`);
				process.exit(2);
			}
			root = path.resolve(next);
			i++;
		} else if (a.startsWith('--root=')) {
			root = path.resolve(a.slice('--root='.length));
		}
	}
	return { root };
}

const { root: REPO_ROOT } = parseArgs(process.argv.slice(2));

const MARKETPLACE_DIR = path.join(REPO_ROOT, 'src/lib/marketplace');
const TYPES_TS = path.join(MARKETPLACE_DIR, 'types.ts');
const INDEX_TS = path.join(MARKETPLACE_DIR, 'index.ts');

/** ANSI color helpers (CI ログ可読性) */
const COLOR = {
	red: (s) => `\x1b[31m${s}\x1b[0m`,
	green: (s) => `\x1b[32m${s}\x1b[0m`,
	yellow: (s) => `\x1b[33m${s}\x1b[0m`,
	bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * `MARKETPLACE_TYPE_CODES` を `types.ts` から抽出。
 *
 * 期待される定義 (ADR-0052):
 *   export const MARKETPLACE_TYPE_CODES = [
 *       'activity-pack',
 *       'reward-set',
 *       ...
 *   ] as const satisfies readonly MarketplaceTypeCode[];
 */
function extractTypeCodes() {
	if (!fs.existsSync(TYPES_TS)) {
		throw new Error(
			`[check-marketplace-registry-integrity] 必須ファイルが存在しません: ${path.relative(REPO_ROOT, TYPES_TS)}`,
		);
	}
	const src = fs.readFileSync(TYPES_TS, 'utf8');
	const match = src.match(/MARKETPLACE_TYPE_CODES\s*=\s*\[([^\]]+)\]/m);
	if (!match) {
		throw new Error(
			`[check-marketplace-registry-integrity] ${path.relative(REPO_ROOT, TYPES_TS)} に MARKETPLACE_TYPE_CODES の定義が見つかりません`,
		);
	}
	const codes = [...match[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
	if (codes.length === 0) {
		throw new Error(
			`[check-marketplace-registry-integrity] MARKETPLACE_TYPE_CODES が空です (types.ts)`,
		);
	}
	return codes;
}

/**
 * `index.ts` で `import './types/<code>'` の side-effect import が
 * 各 type に対して存在するか確認。
 */
function checkIndexImports(typeCodes) {
	if (!fs.existsSync(INDEX_TS)) {
		return [
			{
				typeCode: '(all)',
				kind: 'missing-index',
				message: `${path.relative(REPO_ROOT, INDEX_TS)} が存在しません`,
				fix: `src/lib/marketplace/index.ts を ADR-0052 §3 の構造で作成してください`,
			},
		];
	}
	// コメント (line comment / block comment / JSDoc) を除外してから match する
	// (`// ... activity-pack ...` / ` * import './types/X';` 等の偽陽性を防ぐ)
	const raw = fs.readFileSync(INDEX_TS, 'utf8');
	// 1. block / JSDoc コメント (/* ... */) 全体を除去
	// 2. line コメント (//) を行末まで除去
	const srcNoComments = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	const errors = [];
	for (const code of typeCodes) {
		// match: import './types/<code>'; or import './types/<code>.js';
		const pattern = new RegExp(`import\\s+['"]\\./types/${escapeRegex(code)}(\\.js)?['"]`);
		if (!pattern.test(srcNoComments)) {
			errors.push({
				typeCode: code,
				kind: 'missing-side-effect-import',
				message: `${path.relative(REPO_ROOT, INDEX_TS)} に \`import './types/${code}'\` が存在しません`,
				fix: `src/lib/marketplace/index.ts に \`import './types/${code}.js';\` を 1 行追加してください`,
			});
		}
	}
	return errors;
}

/**
 * 各 type module (`src/lib/marketplace/types/<code>.ts`) の構造完整性を検証。
 *
 * 必要条件:
 *   - ファイル存在
 *   - `marketplaceRegistry.register(...)` 呼出
 *   - typeCode 文字列リテラル一致
 *   - strategy / schema import 行存在
 */
function checkTypeModules(typeCodes) {
	const errors = [];
	for (const code of typeCodes) {
		const modulePath = path.join(MARKETPLACE_DIR, 'types', `${code}.ts`);
		const relPath = path.relative(REPO_ROOT, modulePath);

		if (!fs.existsSync(modulePath)) {
			errors.push({
				typeCode: code,
				kind: 'missing-type-module',
				message: `${relPath} が存在しません`,
				fix: `src/lib/marketplace/types/${code}.ts を作成し、Strategy + Schema を import して marketplaceRegistry.register({...}) を呼んでください (ADR-0052 §3、既存 activity-pack.ts を template に)`,
			});
			continue;
		}

		const src = fs.readFileSync(modulePath, 'utf8');

		// 必須要素 1: marketplaceRegistry.register 呼出
		if (!/marketplaceRegistry\.register\s*\(/.test(src)) {
			errors.push({
				typeCode: code,
				kind: 'missing-register-call',
				message: `${relPath} に \`marketplaceRegistry.register(...)\` 呼出が無い`,
				fix: `${relPath} 末尾に \`marketplaceRegistry.register(${camelCase(code)}Descriptor);\` を追加`,
			});
		}

		// 必須要素 2: typeCode リテラル一致
		const typeCodePattern = new RegExp(`typeCode\\s*:\\s*['"]${escapeRegex(code)}['"]`);
		if (!typeCodePattern.test(src)) {
			errors.push({
				typeCode: code,
				kind: 'missing-typecode-literal',
				message: `${relPath} の Descriptor で typeCode: '${code}' が見つからない`,
				fix: `${relPath} の Descriptor に \`typeCode: '${code}',\` を明記`,
			});
		}

		// 必須要素 3: Strategy import
		const strategyImportPattern = new RegExp(
			`from\\s+['"][^'"]*strategies/${escapeRegex(code)}-strategy(\\.js)?['"]`,
		);
		if (!strategyImportPattern.test(src)) {
			errors.push({
				typeCode: code,
				kind: 'missing-strategy-import',
				message: `${relPath} に Strategy import (\`../strategies/${code}-strategy\`) が無い`,
				fix: `${relPath} に \`import { ${camelCase(code)}Strategy } from '$lib/marketplace/strategies/${code}-strategy.js';\` を追加`,
			});
		}

		// 必須要素 4: Schema import (challenge-set は description が必須でない箇所もあるため warn 相当だが、5 type 全 SSOT で schema を持つ運用)
		const schemaImportPattern = new RegExp(
			`from\\s+['"][^'"]*schemas/${escapeRegex(code)}-schema(\\.js)?['"]`,
		);
		if (!schemaImportPattern.test(src)) {
			errors.push({
				typeCode: code,
				kind: 'missing-schema-import',
				message: `${relPath} に Schema import (\`../schemas/${code}-schema\`) が無い`,
				fix: `${relPath} に \`import { ${pascalCase(code)}PayloadSchema } from '$lib/marketplace/schemas/${code}-schema.js';\` を追加`,
			});
		}

		// 必須要素 5: 必須 Descriptor フィールド
		for (const field of ['displayLabel', 'description', 'strategy', 'requiresChildId']) {
			const fieldPattern = new RegExp(`\\b${field}\\s*:`);
			if (!fieldPattern.test(src)) {
				errors.push({
					typeCode: code,
					kind: 'missing-descriptor-field',
					message: `${relPath} の Descriptor で必須フィールド \`${field}\` が見つからない`,
					fix: `${relPath} の Descriptor に \`${field}: ...\` を追加 (ADR-0052 §3 / 既存 activity-pack.ts を参照)`,
				});
			}
		}
	}
	return errors;
}

/**
 * 各 type の Strategy ファイル存在を確認 (TypeScript compile では import 解決失敗が
 * `svelte-check` で検知されるが、本 script でも明示的に存在確認することで PR レビュー
 * 時の早期発見を促す)。
 */
function checkStrategyFiles(typeCodes) {
	const errors = [];
	for (const code of typeCodes) {
		const strategyPath = path.join(MARKETPLACE_DIR, 'strategies', `${code}-strategy.ts`);
		if (!fs.existsSync(strategyPath)) {
			errors.push({
				typeCode: code,
				kind: 'missing-strategy-file',
				message: `${path.relative(REPO_ROOT, strategyPath)} が存在しません`,
				fix: `src/lib/marketplace/strategies/${code}-strategy.ts に \`ImportStrategy<${pascalCase(code)}Payload>\` を実装してください (既存 activity-pack-strategy.ts を template に)`,
			});
		}
		const schemaPath = path.join(MARKETPLACE_DIR, 'schemas', `${code}-schema.ts`);
		if (!fs.existsSync(schemaPath)) {
			errors.push({
				typeCode: code,
				kind: 'missing-schema-file',
				message: `${path.relative(REPO_ROOT, schemaPath)} が存在しません`,
				fix: `src/lib/marketplace/schemas/${code}-schema.ts に Valibot schema を実装してください (既存 activity-pack-schema.ts を template に)`,
			});
		}
	}
	return errors;
}

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 'activity-pack' → 'activityPack' */
function camelCase(kebab) {
	return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** 'activity-pack' → 'ActivityPack' */
function pascalCase(kebab) {
	const camel = camelCase(kebab);
	return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// ─── main ─────────────────────────────────────────────────────────

function main() {
	console.log(
		COLOR.bold(
			'[check-marketplace-registry-integrity] ADR-0052 / EPIC #2362 / Issue #2374 / AN-5 #2180 補強 7',
		),
	);

	let typeCodes;
	try {
		typeCodes = extractTypeCodes();
	} catch (e) {
		console.error(COLOR.red('FATAL: '), e.message);
		process.exit(1);
	}

	console.log(`  MARKETPLACE_TYPE_CODES (${typeCodes.length} type): ${typeCodes.join(', ')}`);

	const allErrors = [
		...checkIndexImports(typeCodes),
		...checkTypeModules(typeCodes),
		...checkStrategyFiles(typeCodes),
	];

	if (allErrors.length === 0) {
		console.log(
			COLOR.green(
				`  ✓ Registry 完整性 OK — 全 ${typeCodes.length} type が register / strategy / schema 揃いで定義されています`,
			),
		);
		process.exit(0);
	}

	// グループ化 (typeCode ごと)
	const grouped = new Map();
	for (const err of allErrors) {
		const list = grouped.get(err.typeCode) ?? [];
		list.push(err);
		grouped.set(err.typeCode, list);
	}

	console.error(COLOR.red(`\n  ✗ ${allErrors.length} 件の完整性違反を検出しました\n`));

	for (const [typeCode, errs] of grouped) {
		console.error(COLOR.yellow(`[${typeCode}]`));
		for (const err of errs) {
			console.error(`  - ${err.kind}: ${err.message}`);
			console.error(`    ${COLOR.green('fix')}: ${err.fix}`);
		}
		console.error('');
	}

	console.error(
		COLOR.bold(
			'構造的再発防止 (AN-5 #2180 補強 7): 新 type を MARKETPLACE_TYPE_CODES に追加した場合、',
		),
	);
	console.error(
		'  以下 5 件を同 PR で完結させてください (ADR-0052 §3、Strangler Fig 部分 commit 禁止):',
	);
	console.error('    1. src/lib/marketplace/schemas/<code>-schema.ts (Valibot schema)');
	console.error('    2. src/lib/marketplace/strategies/<code>-strategy.ts (ImportStrategy 実装)');
	console.error('    3. src/lib/marketplace/types/<code>.ts (Descriptor + register 呼出)');
	console.error("    4. src/lib/marketplace/index.ts に `import './types/<code>.js';` 追加");
	console.error('    5. tests/unit/marketplace/strategies/<code>-strategy.test.ts');

	process.exit(1);
}

main();
