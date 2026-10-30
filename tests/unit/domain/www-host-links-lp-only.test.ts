// www.ganbari-quest.com は LP (GitHub Pages) 専用ホストで、アプリの画面 (/auth/signup 等) は
// apex の ganbari-quest.com で配信される。www 側に存在しない path への href が、
// LP の追従 CTA（スマホ）・デモの「本当に始める」・デモのログイン遷移で 404 になっていた。
// 「www は site/ に実在する静的ファイルだけを指す」を、リンクが書かれうる全ソースで固定する。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_LABELS } from '../../../src/lib/domain/labels';

const ROOT = join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['src', 'site', 'scripts', 'infra/lambda'];
const SKIP_DIR = new Set(['node_modules', '.svelte-kit', 'screenshots', 'build']);
const EXT = /\.(ts|js|mjs|svelte|html|json)$/;
const WWW_URL = /https:\/\/www\.ganbari-quest\.com(\/[A-Za-z0-9_./%-]*)?/g;

function* walk(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIR.has(name)) continue;
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) yield* walk(full);
		else if (EXT.test(name)) yield full;
	}
}

/** www の path が LP (site/) に実在しない URL を返す。root (path 空) は LP のトップなので許す。 */
function badWwwUrls(file: string): string[] {
	const found: string[] = [];
	for (const m of readFileSync(file, 'utf8').matchAll(WWW_URL)) {
		const path = (m[1] ?? '/').replace(/^\//, '');
		if (path !== '' && !existsSync(join(ROOT, 'site', path))) {
			found.push(`${relative(ROOT, file)}: ${m[0]}`);
		}
	}
	return found;
}

function scanTargets(): string[] {
	return SCAN_DIRS.map((d) => join(ROOT, d))
		.filter((abs) => existsSync(abs))
		.flatMap((abs) => [...walk(abs)])
		.filter((file) => !file.endsWith('www-host-links-lp-only.test.ts'));
}

describe('www.ganbari-quest.com は LP の静的ファイルだけを指す', () => {
	it('www の path は site/ に実在する (アプリの /auth/* などを向けない)', () => {
		const files = scanTargets();
		expect(files.length, '走査 0 件 = 検査の空振り').toBeGreaterThan(50);
		expect(files.flatMap(badWwwUrls)).toEqual([]);
	}, 60_000);

	it('デモのサインアップ / ログイン先は、アプリのホスト (apex) を指す', () => {
		expect(DEMO_LABELS.signupHref).toBe('https://ganbari-quest.com/auth/signup');
		expect(DEMO_LABELS.loginHref).toBe('https://ganbari-quest.com/auth/login');
	});
});
