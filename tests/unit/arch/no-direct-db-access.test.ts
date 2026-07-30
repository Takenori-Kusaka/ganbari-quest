// tests/unit/arch/no-direct-db-access.test.ts
// services/ 層が db/client, db/schema, drizzle-orm を直接 import しないことを検証するアーキテクチャテスト

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

const SERVICES_DIR = join(process.cwd(), 'src', 'lib', 'server', 'services');

const FORBIDDEN_IMPORTS = [
	{ pattern: /from\s+['"].*\/db\/client['"]/, description: 'db/client の直接 import' },
	{ pattern: /from\s+['"].*\/db\/schema['"]/, description: 'db/schema の直接 import' },
	{ pattern: /from\s+['"]drizzle-orm['"]/, description: 'drizzle-orm の直接 import' },
	{
		pattern: /from\s+['"].*\/db\/sqlite\/.*['"]/,
		description: 'sqlite/ 実装の直接 import',
	},
	{
		pattern: /from\s+['"].*\/db\/dynamodb\/.*['"]/,
		description: 'dynamodb/ 実装の直接 import',
	},
];

function getServiceFiles(): string[] {
	try {
		return readdirSync(SERVICES_DIR)
			.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
			.map((f) => join(SERVICES_DIR, f));
	} catch {
		return [];
	}
}

describe('アーキテクチャ: services/ は DB を直接参照しない', () => {
	const serviceFiles = getServiceFiles();

	it('サービスファイルが存在する', () => {
		expect(serviceFiles.length).toBeGreaterThan(0);
	});

	for (const filePath of serviceFiles) {
		const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

		for (const { pattern, description } of FORBIDDEN_IMPORTS) {
			it(`${fileName} は ${description} を含まない`, () => {
				const content = readFileSync(filePath, 'utf-8');
				const lines = content.split('\n');
				const violatingLines = lines
					.map((line, idx) => ({ line: line.trim(), lineNum: idx + 1 }))
					.filter(({ line }) => pattern.test(line) && !line.startsWith('//'));

				if (violatingLines.length > 0) {
					const details = violatingLines
						.map(({ line, lineNum }) => `  L${lineNum}: ${line}`)
						.join('\n');
					expect.fail(
						`${fileName} に禁止された import があります:\n${details}\n\nservices/ 層は facade (db/*.ts) 経由でアクセスしてください。`,
					);
				}
			});
		}
	}
});
