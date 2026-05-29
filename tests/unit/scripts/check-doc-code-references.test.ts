import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	findViolationsInFile,
	isCheckableImplPath,
} from '../../../scripts/check-doc-code-references.mjs';

describe('check-doc-code-references (#2584)', () => {
	describe('isCheckableImplPath', () => {
		it('AC2: 自然言語列挙の誤検出を防止するため、スラッシュを含まないパスは除外する', () => {
			// 表セル内での "src tests docs site" のような文字列
			expect(isCheckableImplPath('src')).toBe(false);
			expect(isCheckableImplPath('tests')).toBe(false);
			expect(isCheckableImplPath('docs')).toBe(false);
			expect(isCheckableImplPath('site')).toBe(false);

			// 通常のパスはマッチする
			expect(isCheckableImplPath('src/lib/domain')).toBe(true);
			expect(isCheckableImplPath('tests/unit/scripts')).toBe(true);
		});

		it('短すぎる断片や変数を含むものは除外される', () => {
			expect(isCheckableImplPath('src/')).toBe(false); // < 5 length
			expect(isCheckableImplPath(`src/\${file}`)).toBe(false);
		});
	});

	describe('findViolationsInFile', () => {
		let tmpDir: string;
		let testFile: string;

		beforeEach(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-refs-test-'));
			testFile = path.join(tmpDir, 'test-doc.md');

			// ダミーの実在ファイルを作成
			fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, 'src', 'lib', 'index.ts'), '');
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it('AC1: <!-- doc-code-refs: ignore-line --> の直後の行を無視する', () => {
			const mdContent = `
これは正常なテストです。
src/lib/index.ts は実在するので違反になりません。

src/non-existent.ts は実在しないので違反になります。

<!-- doc-code-refs: ignore-line -->
src/ignored.ts も実在しませんが無視されます。
`;
			fs.writeFileSync(testFile, mdContent);

			const violations = findViolationsInFile(testFile, tmpDir);

			// src/non-existent.ts のみが検出されるはず
			expect(violations).toHaveLength(1);
			expect(violations[0].path).toBe('src/non-existent.ts');
		});

		it('連続する ignore-line も正しく処理される', () => {
			const mdContent = `
<!-- doc-code-refs: ignore-line -->
src/ignored1.ts
<!-- doc-code-refs: ignore-line -->
src/ignored2.ts
src/non-existent2.ts
`;
			fs.writeFileSync(testFile, mdContent);

			const violations = findViolationsInFile(testFile, tmpDir);
			expect(violations).toHaveLength(1);
			expect(violations[0].path).toBe('src/non-existent2.ts');
		});
	});
});
