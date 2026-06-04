/**
 * tests/unit/scripts/check-license-key-leak.test.ts (#2836 PR-L4 / #2860 PR-L5)
 *
 * scripts/check-license-key-leak.mjs の純関数 (副作用なし) を検証する。
 * PR-L5 (#2860) で DB 層 / enum / service 層を物理削除し、allowlist は LEGACY_URL_MAP のみに縮小
 * (完全ゼロ化)。
 * - isFileAllowlisted: LEGACY_URL_MAP file のみ allowlist (旧 DB 層 allowlist は撤去済)
 * - isCommentLine: 履歴コメント行を許容
 * - findViolationsInContent: allowlist 外のコード行 license key 参照を検出
 * - findAllViolations: 実 repo (src/ + site/) で再導入ゼロを保証
 */

import { describe, expect, it } from 'vitest';

import {
	findAllViolations,
	findViolationsInContent,
	isCommentLine,
	isFileAllowlisted,
} from '../../../scripts/check-license-key-leak.mjs';

describe('check-license-key-leak (#2836)', () => {
	describe('isFileAllowlisted', () => {
		it.each([
			'src/lib/server/routing/legacy-url-map.ts',
		])('LEGACY_URL_MAP file のみ allowlist: %s', (rel) => {
			expect(isFileAllowlisted(rel)).toBe(true);
		});

		it.each([
			// PR-L5 (#2860) で DB 層を物理削除したため、旧 allowlist file は scan 対象 (= false) に戻った
			'src/lib/server/db/dynamodb/auth-repo.ts',
			'src/lib/server/db/sqlite/auth-repo.ts',
			'src/lib/domain/validation/auth.ts',
			'src/lib/server/auth/entities.ts',
			'src/lib/server/services/license-service.ts',
			'src/lib/runtime/env.ts',
			// LP / ラベル / UI file は元から allowlist 対象外
			'src/lib/domain/labels.ts',
			'src/lib/features/admin/components/SaasLicensePanel.svelte',
			'src/routes/(parent)/admin/subscription/+page.server.ts',
			'site/pricing.html',
		])('DB 層 (撤去後) / LP / ラベル / UI file は allowlist 対象外: %s', (rel) => {
			expect(isFileAllowlisted(rel)).toBe(false);
		});

		it('Windows path 区切り (\\) でも判定できる', () => {
			expect(isFileAllowlisted('src\\lib\\server\\routing\\legacy-url-map.ts')).toBe(true);
		});
	});

	describe('isCommentLine', () => {
		it.each([
			'// license key 撤去済 (#2818)',
			'  // ライセンスキー適用 UI は撤去済',
			' * licenseKey 因子を撤廃 (#2813)',
			'/* LICENSE_KEY block comment */',
			'<!-- 旧 license-key.html は削除済 -->',
			'# license-key reference in shell/yaml',
		])('コメント行は true: %s', (line) => {
			expect(isCommentLine(line)).toBe(true);
		});

		it.each([
			"const x = 'ライセンスキー';",
			'subject: ライセンスキーをお届け',
			'<a href="/help/license-key">',
		])('コード行は false: %s', (line) => {
			expect(isCommentLine(line)).toBe(false);
		});
	});

	describe('findViolationsInContent', () => {
		it('allowlist 外 file のコード行 license key 参照を検出する', () => {
			const content = ['const a = 1;', "const msg = 'ライセンスキーを入力';", 'const b = 2;'].join(
				'\n',
			);
			const result = findViolationsInContent('site/some-new-page.html', content);
			expect(result).toHaveLength(1);
			expect(result[0]?.line).toBe(2);
			expect(result[0]?.file).toBe('site/some-new-page.html');
		});

		it('コメント行の license key 参照は許容する (検出ゼロ)', () => {
			const content = ['// 旧 licenseKey は撤去済 (#2818)', 'const ok = true;'].join('\n');
			expect(findViolationsInContent('src/lib/features/foo.svelte', content)).toHaveLength(0);
		});

		it('allowlist file (legacy-url-map) 内のコード行 license key 参照は許容する', () => {
			const content = ["{ from: '/help/license-key', to: '/admin/subscription' },"].join('\n');
			expect(
				findViolationsInContent('src/lib/server/routing/legacy-url-map.ts', content),
			).toHaveLength(0);
		});

		it('license key 参照のないコード行は検出しない', () => {
			const content = ['const a = 1;', 'const b = 2;'].join('\n');
			expect(findViolationsInContent('site/index.html', content)).toHaveLength(0);
		});
	});

	describe('findAllViolations (実 repo gate)', () => {
		it('現在の src/ + site/ に再導入された license key 参照はゼロ (本 PR 自身が PASS)', () => {
			const violations = findAllViolations();
			if (violations.length > 0) {
				// 失敗時に違反箇所を表示
				throw new Error(
					`license key 再導入を ${violations.length} 件検出:\n` +
						violations
							.map((v: { file: string; line: number }) => `  ${v.file}:${v.line}`)
							.join('\n'),
				);
			}
			expect(violations).toHaveLength(0);
		});
	});
});
