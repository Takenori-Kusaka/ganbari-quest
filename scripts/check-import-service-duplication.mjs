#!/usr/bin/env node
/**
 * scripts/check-import-service-duplication.mjs
 *
 * #2373 / AN-5 #2180 補強 6: 補佐設計品質ガード 6
 *
 * `src/lib/server/services/*-import-service.ts` のうち 150 行超のものを列挙する
 * awareness 用 script。CI 必須化ではなく warning のみ。
 *
 * 背景: 補佐が 5 EPIC 連続 (#2253 / #2266 / #2294 / #2319 / #2327) でマーケプレ関連
 * Issue を起票した際、抽象クラス / Strategy / Factory パターンを 5 回連続で見逃した
 * 教訓。3 件目以降の類似 service 起票時に補佐 / PO 双方に awareness を与える。
 *
 * 使用法:
 *   node scripts/check-import-service-duplication.mjs
 *
 * 出力:
 *   - 150 行超の `*-import-service.ts` ファイル一覧 (path + 行数)
 *   - 3 件以上検出時は「Strategy / Factory / Registry 適用判断」prompting メッセージ
 *
 * exit code:
 *   常に 0 (warning のみ、CI fail させない)
 *
 * SSOT:
 *   - `docs/sessions/po-session.md` §「補佐設計品質ガード 6」
 *   - `docs/sessions/dev-session.md` §「3 つ目の類似 service / component 実装時」
 *   - `.claude/skills/issue-triage/SKILL.md` §「手順 F」
 *   - `CLAUDE.md` §「補佐設計品質ガード 6」
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '../..');
const SERVICES_DIR = join(REPO_ROOT, 'src', 'lib', 'server', 'services');
const LINE_THRESHOLD = 150;
const SUFFIX = '-import-service.ts';

function findImportServices() {
	let entries;
	try {
		entries = readdirSync(SERVICES_DIR);
	} catch (_err) {
		console.warn(`[check-import-service-duplication] services dir not found: ${SERVICES_DIR}`);
		return [];
	}

	const results = [];
	for (const name of entries) {
		if (!name.endsWith(SUFFIX)) continue;
		const fullPath = join(SERVICES_DIR, name);
		const stat = statSync(fullPath);
		if (!stat.isFile()) continue;
		const content = readFileSync(fullPath, 'utf8');
		const lineCount = content.split('\n').length;
		results.push({ name, fullPath, lineCount });
	}
	return results.sort((a, b) => b.lineCount - a.lineCount);
}

function main() {
	const services = findImportServices();
	const over = services.filter((s) => s.lineCount > LINE_THRESHOLD);

	console.log('[check-import-service-duplication] #2373 / AN-5 #2180 補強 6');
	console.log(`Scanning ${SERVICES_DIR}`);
	console.log(`Found ${services.length} *-import-service.ts file(s):`);
	for (const s of services) {
		const marker = s.lineCount > LINE_THRESHOLD ? ' [OVER 150]' : '';
		console.log(`  - ${s.name}: ${s.lineCount} lines${marker}`);
	}

	if (over.length >= 3) {
		console.log('');
		console.log('=== WARNING: 3+ import-service files exceed 150 lines ===');
		console.log('補佐設計品質ガード 6 (#2373): 3 件目以降の類似 service 起票 / 実装時、');
		console.log('Strategy / Factory / Registry パターン適用判断を PO に必須確認すること。');
		console.log('');
		console.log('参照 SSOT:');
		console.log('  - docs/sessions/po-session.md §「補佐設計品質ガード 6」');
		console.log('  - docs/sessions/dev-session.md §「3 つ目の類似 service / component 実装時」');
		console.log('  - .claude/skills/issue-triage/SKILL.md §「手順 F」');
	} else if (over.length > 0) {
		console.log('');
		console.log(
			`Info: ${over.length} file(s) exceed 150 lines (below 3-file threshold for abstract-pattern review).`,
		);
	} else {
		console.log('');
		console.log('OK: no import-service files exceed 150 lines.');
	}

	// Always exit 0 (warning only, do not fail CI)
	process.exit(0);
}

main();
