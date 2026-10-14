#!/usr/bin/env node
/**
 * scripts/check-workflow-run-expressions.mjs (#4570)
 *
 * `.github/workflows/*.yml` の `run:` 本文に、注入 / 露出の入口になる `${{ }}` が
 * 直接書かれていたら fail する。値は `env:` に渡し、本文では `"$VAR"` で参照する。
 *
 * 検出対象と対象外の線引き・理由は `scripts/lib/ci/workflow-run-expressions.mjs` の冒頭を参照。
 *
 * 使い方:
 *   node scripts/check-workflow-run-expressions.mjs
 *
 * 終了コード: 違反なし=0 / 違反あり=1 / workflow が 1 件も見つからない=1 (検査の空振りを通さない)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRunExpressionViolations } from './lib/ci/workflow-run-expressions.mjs';
import { isMain } from './lib/is-main.mjs';

const WORKFLOW_DIR = '.github/workflows';

export function checkWorkflows(dir = WORKFLOW_DIR) {
	const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
	const violations = [];
	for (const f of files) {
		const text = readFileSync(join(dir, f), 'utf8');
		for (const v of findRunExpressionViolations(text)) violations.push({ file: f, ...v });
	}
	return { scanned: files.length, violations };
}

function main() {
	const { scanned, violations } = checkWorkflows();
	if (scanned === 0) {
		console.error(
			`❌ ${WORKFLOW_DIR} に workflow が 1 件も見つかりません (検査が空振りしています)`,
		);
		process.exit(1);
	}
	if (violations.length > 0) {
		console.error(
			`❌ workflow の run: 本文に \${{ }} で注入 / 露出の入口になる式が直接書かれています (#4570)`,
		);
		for (const v of violations) {
			console.error(`  ${WORKFLOW_DIR}/${v.file}:${v.line}  \${{ ${v.expr} }}`);
			console.error(`      ${v.text}`);
		}
		console.error('');
		console.error('対処: 値を step の `env:` に渡し、run: 本文では "$VAR" として参照する。');
		console.error('      例) env に BASE_BRANCH を渡し、run: では git fetch origin "$BASE_BRANCH" と書く');
		process.exit(1);
	}
	console.log(`✅ ${scanned} workflow の run: 本文に危険な \${{ }} はありません`);
}

if (isMain(import.meta.url)) main();
