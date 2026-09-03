// tests/unit/architecture/admin-action-result-no-http-ok.test.ts (#4693 / ADR-0061)
//
// **form action の結果は ActionResult の `type` で判定する。HTTP の `ok` で判定しない。**
//
// # なぜ必要か
//
// SvelteKit の `fail(403, { error })` は「失敗」を ActionResult の本文で表す。これを
// `resp.ok` で分岐すると失敗が成功として扱われ、**サーバーが上限で拒否しているのに
// 画面には「一括追加しました」「コピーが完了しました」と出て 1 件も増えない** (#4693 実測)。
// 出るべきだった上限メッセージとアップグレード導線がまるごと消える。
//
// 同じ穴が同じ file の別 handler で 2 件同時に存在していた (copy / bulk) ので、
// 「読み方」を helper に集約したうえで、`resp.ok` 判定に戻れないことを機械で保つ。
//
// # 何を fail させるか
//
// `fetch('?/action')` を行う `.svelte` が、そのレスポンスを `.ok` で分岐している状態。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// #4693: 走査は `src/routes` だけでは足りない。form action を fetch する `.svelte` は
// `src/lib/features/**` にも実在する (`AdminHome.svelte` の `?/dismissPremiumWelcome`) ため、
// routes だけを見た「`resp.ok` 判定 0 件」は主張より狭い保証になる。UI コードのある 2 root を歩く。
const SCAN_ROOTS = [join(REPO_ROOT, 'src/routes'), join(REPO_ROOT, 'src/lib')];

function walkSvelte(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walkSvelte(full, acc);
		else if (entry.name.endsWith('.svelte')) acc.push(full);
	}
	return acc;
}

/**
 * `const <name> = await fetch('?/action', …)` で受けた変数名を集める。
 *
 * REST endpoint (`fetch('/api/v1/...')`) の `.ok` 判定は正当 (HTTP status が結果そのもの) なので、
 * **form action の戻り値を受けた変数だけ**を対象にする。
 */
function formActionResponseVars(src: string): string[] {
	const vars: string[] = [];
	const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+fetch\(\s*[`'"]\?\//g;
	let m: RegExpExecArray | null = re.exec(src);
	while (m !== null) {
		if (m[1]) vars.push(m[1]);
		m = re.exec(src);
	}
	return vars;
}

/** form action のレスポンス変数を `.ok` で分岐している行 (コメント行は除く) */
function httpOkBranches(src: string, vars: string[]): string[] {
	if (vars.length === 0) return [];
	const pattern = new RegExp(`\\b(${vars.join('|')})\\.ok\\b`);
	return src
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => !line.startsWith('//') && !line.startsWith('*'))
		.filter((line) => pattern.test(line));
}

// repo 走査 test (#4085): src/routes 全体を歩くため既定 5s では並列実行の負荷で落ちる。
vi.setConfig({ testTimeout: 60_000 });

describe('#4693 form action の結果は ActionResult で判定する', () => {
	it('?/action を fetch する .svelte が resp.ok で成否を分岐していない', () => {
		const violations: string[] = [];
		for (const file of SCAN_ROOTS.flatMap((root) => walkSvelte(root))) {
			const src = readFileSync(file, 'utf-8');
			const vars = formActionResponseVars(src);
			if (vars.length === 0) continue;
			const hits = httpOkBranches(src, vars);
			if (hits.length > 0) {
				violations.push(`${relative(REPO_ROOT, file).replace(/\\/g, '/')}: ${hits.join(' | ')}`);
			}
		}
		expect(
			violations,
			[
				'form action の結果を HTTP status で判定しています。',
				`  該当: ${violations.join('\n         ')}`,
				'→ readAdminActionResult(resp) ($lib/features/admin/action-result) を使ってください。',
				'  fail() は ActionResult の type で失敗を表すため、ok 判定では',
				'  「サーバーは拒否したのに画面は成功」になります (#4693)。',
			].join('\n'),
		).toEqual([]);
	});

	it('判定 helper が存在し、ActionResult の type を読んでいる', () => {
		const helper = readFileSync(
			join(REPO_ROOT, 'src/lib/features/admin/action-result.ts'),
			'utf-8',
		);
		expect(helper).toContain("result.type === 'success'");
		expect(helper).toContain("result.type === 'failure'");
	});
});
