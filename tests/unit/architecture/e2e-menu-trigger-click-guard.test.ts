// tests/unit/architecture/e2e-menu-trigger-click-guard.test.ts
// #4609: Ark UI Menu の trigger を「裸の click()」で押す E2E spec を作らせない。
//
// ## なぜ機械で止めるか
//
// Ark UI Menu の listener は **hydration 完了後**に attach される。SSR された trigger は
// 先に visible になるため、
//
//   await expect(trigger).toBeVisible();   // ← SSR markup で通る
//   await trigger.click();                 // ← listener 未 attach なら握り潰される
//   await expect(item).toBeVisible();      // ← Portal の DOM はあるので "hidden" で落ちる
//
// という順序で「**要素はあるが不可視**」の形で失敗する。負荷の高い環境ほど hydration が
// 遅れて再現しやすく、空いた環境では通るため **flake として現れて実バグと区別しにくい**
// (#4609 はこの切り分けに 1 Issue を要した)。
//
// 正しい待ち方は既にリポジトリにある — `tests/e2e/helpers/goal-flows.ts` の `openMenu`
// (menu item の visible を成功条件に再 click、#2260 Fix-6 で確立)。**不足していたのは
// 「それを既定に強制する規律」**なので、ここで機械化する (#2544 の render-only 禁止と同じ構図)。
//
// 同 class の再発回数: admin-unified-import-hub (tablet flake) / #2260 Fix-6 /
// admin-activities-add-ux / #4609 admin-checklists — 4 例目で guard 化 (ADR-0061 same-class-N→guard)。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (実行時間が入力サイズに比例する)。区分宣言は
// scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
vi.setConfig({ testTimeout: 30_000 });

const E2E_DIR = path.resolve(__dirname, '../../..', 'tests/e2e');

/**
 * menu trigger と判定する testid の形。
 *
 * `OverflowMenu` primitive は呼び出し側が `testid` を渡す規約で、実装は
 * `<resource>-overflow-menu` に揃っている (`src/routes/(parent)/admin/<resource>/+page.svelte`)。
 * `AdminResourceHeader` の「+ 追加」dropdown も同じ Ark Menu で、trigger は
 * `<resource>-add-menu` 系。どちらも hydration 前 click を握り潰す。
 */
const MENU_TRIGGER_TESTID = /^[a-z0-9-]*(overflow-menu|add-menu)$/;

/** 裸の click: `getByTestId('<trigger>').click()` が同一行または直後の行に現れる形。 */
const BARE_CLICK = /getByTestId\(\s*'([a-z0-9-]+)'\s*\)\s*\.click\(\)/g;

function listSpecFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...listSpecFiles(full));
		else if (entry.name.endsWith('.spec.ts')) found.push(full);
	}
	return found;
}

describe('#4609 Ark UI Menu trigger の裸 click を禁止する', () => {
	it('E2E spec が menu trigger を裸の click() で押していない', () => {
		const violations: string[] = [];

		for (const file of listSpecFiles(E2E_DIR)) {
			const source = fs.readFileSync(file, 'utf-8');
			const lines = source.split('\n');
			lines.forEach((line, index) => {
				BARE_CLICK.lastIndex = 0;
				let match: RegExpExecArray | null = BARE_CLICK.exec(line);
				while (match !== null) {
					const testid = match[1] as string;
					if (MENU_TRIGGER_TESTID.test(testid)) {
						violations.push(
							`${path.relative(E2E_DIR, file)}:${index + 1}  getByTestId('${testid}').click()`,
						);
					}
					match = BARE_CLICK.exec(line);
				}
			});
		}

		expect(
			violations,
			[
				'Ark UI Menu の trigger を裸の click() で押しています。',
				'hydration 前だと click が握り潰され、menu item が "hidden" のまま落ちます',
				'(負荷次第で通るため flake として現れ、実バグと区別できません)。',
				'',
				"対処: tests/e2e/helpers/goal-flows.ts の openMenu(page, '<trigger testid>', '<item testid>') を使う。",
				'',
				violations.join('\n'),
			].join('\n'),
		).toEqual([]);
	});

	// 検査対象が実在することの対照 (glob が空振りしていたら guard は無意味)。
	it('走査対象の E2E spec が存在し、menu trigger を使う spec を実際に読んでいる', () => {
		const files = listSpecFiles(E2E_DIR);
		expect(files.length).toBeGreaterThan(50);

		const usesTrigger = files.filter((file) =>
			/getByTestId\(\s*'[a-z0-9-]*(overflow-menu|add-menu)'/.test(fs.readFileSync(file, 'utf-8')),
		);
		expect(usesTrigger.length, 'menu trigger を参照する spec が 1 件も無い').toBeGreaterThan(0);
	});
});
