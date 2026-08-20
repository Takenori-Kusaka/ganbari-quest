// tests/unit/architecture/app-version-generated-at-build-4716.test.ts (#4716 item 14)
//
// 設定 > サポートに出る「バージョン: v1.20260411.0」が 4 ヶ月前の値で固定されていた。
// 原因は `src/lib/version.ts` が生成物としてコミットされている一方、生成コマンド
// (`npm run version:generate`) が build からも CI からも一度も呼ばれていなかったこと。
// 顧客が問い合わせ時に伝えるのがこの文字列なので、古いままだと運営側が版を特定できない。
//
// 対処は `prebuild` フック (npm が `build` の直前に自動実行する) で毎ビルド再生成すること。
// 本 test は「その配線が外れたら落ちる」ことだけを見る (値そのものは生成時刻依存なので見ない)。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
	scripts: Record<string, string>;
};

describe('#4716 アプリバージョンはビルドのたびに生成される', () => {
	it('version:generate script が存在する', () => {
		expect(pkg.scripts['version:generate']).toBeDefined();
	});

	it('prebuild が version:generate を呼ぶ (npm が build の直前に自動実行する)', () => {
		const prebuild = pkg.scripts.prebuild;
		expect(prebuild).toBeDefined();
		expect(prebuild).toContain('version:generate');
	});

	it('build 本体は prebuild を前提にしている (build 内で直接生成しない = 二重生成を作らない)', () => {
		expect(pkg.scripts.build).not.toContain('version:generate');
	});

	it('生成物 src/lib/version.ts が期待する形を保っている', () => {
		const src = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8');
		expect(src).toMatch(/export const APP_VERSION = 'v\d+\.\d{8}\.\d+' as const;/);
		expect(src).toMatch(/export const APP_VERSION_DATE = '[^']+' as const;/);
	});
});
