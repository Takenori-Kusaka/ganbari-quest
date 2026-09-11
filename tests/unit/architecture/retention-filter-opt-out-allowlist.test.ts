// tests/unit/architecture/retention-filter-opt-out-allowlist.test.ts
// #4818 (ADR-0061 same-class-N→guard): 履歴取得の保持期間 opt-out を allowlist で固定する。
//
// ## なぜ guard にするか
//
// 「履歴取得が保持期間 (ADR-0049) を通っていない」は **2 度起きている**:
//
//   1. 「記録 > 交換」タブ (`getRedemptionRequestsForChild`) — 元から一度も通っていなかった
//   2. 「記録 > 達成」タブ (`getChildChallengeRecords`) — #4763 が新設時に渡し忘れた
//
// どちらも「渡さない」が **全期間を返す** として静かに成立したのが原因なので、まず 3 つの
// 履歴取得 service の range を**必須引数**にして、渡し忘れを型で落とすようにした。
//
// ただし必須化だけでは「とりあえず空 range を渡して黙らせる」経路が残る。それを
// `NO_RETENTION_FILTER` という名前付き定数に一本化したうえで、**使ってよい場所を本 test の
// allowlist に固定**する。新しい opt-out は allowlist の更新 = PR での明示的な判断を伴う。
//
// ## 落ちたときの直し方
//
// - 履歴を出す画面で落ちた → opt-out をやめ、`applyRetentionFilter(planTier, …)` の結果を渡す
// - 履歴ではない用途 (最新状態の導出など) で意図的に絞らない → 下の allowlist に理由付きで足す

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (実行時間が入力サイズに比例する)。区分は
// scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN_DIR = resolve(REPO_ROOT, 'src');

/** 定数そのものを定義している file (使用箇所ではない)。 */
const DEFINITION_FILE = 'src/lib/server/services/plan-limit-service.ts';

/**
 * 保持期間で絞らないことが正しい呼び出し元。
 *
 * **履歴一覧はここに入らない。** 入れてよいのは「履歴として見せるのではなく、現在の状態を
 * 導出するために全期間を読む必要がある」用途だけ。
 */
const ALLOWED_OPT_OUT: Record<string, string> = {
	'src/routes/(child)/[uiMode=uiMode]/shop/+page.server.ts':
		'各ごほうびの「最新申請状態」(交換済みバッジ / 再申請ガード) の導出。履歴一覧ではない。' +
		'絞ると古い申請しか無いごほうびのバッジだけ消えて状態表示が不定になる。' +
		'履歴として見せるのは「記録 > 交換」タブ側で、そちらは保持期間を通す。',
};

function walkSourceFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walkSourceFiles(full, acc);
		} else if (/\.(ts|js|svelte)$/.test(entry.name)) {
			acc.push(full);
		}
	}
	return acc;
}

/**
 * `NO_RETENTION_FILTER` を **import している** file を検出する。
 *
 * 素の文字列一致にすると docstring の言及 (「絞らない用途では `NO_RETENTION_FILTER` を渡す」)
 * まで拾ってしまうため、実際に値を取り込んでいる import 文だけを見る。
 */
const OPT_OUT_IMPORT =
	/import\s*\{[^}]*\bNO_RETENTION_FILTER\b[^}]*\}\s*from\s*['"][^'"]*plan-limit-service['"]/;

/** `src` 配下で opt-out を import している file (定義元を除く) を repo 相対パスで返す。 */
function findOptOutFiles(): string[] {
	return walkSourceFiles(SCAN_DIR, [])
		.filter((full) => OPT_OUT_IMPORT.test(readFileSync(full, 'utf8')))
		.map((full) => relative(REPO_ROOT, full).replaceAll('\\', '/'))
		.filter((rel) => rel !== DEFINITION_FILE)
		.sort();
}

describe('#4818 保持期間フィルタの opt-out は allowlist に固定する', () => {
	it('NO_RETENTION_FILTER を使う file は allowlist と完全一致する', () => {
		expect(findOptOutFiles()).toEqual(Object.keys(ALLOWED_OPT_OUT).sort());
	});

	it('allowlist の各エントリは実在する file を指す (腐った allowlist を残さない)', () => {
		const actual = new Set(findOptOutFiles());
		for (const file of Object.keys(ALLOWED_OPT_OUT)) {
			expect(actual.has(file), `allowlist に載っているが opt-out していない: ${file}`).toBe(true);
		}
	});

	it('allowlist の理由は空欄・定型 stub でない', () => {
		for (const [file, reason] of Object.entries(ALLOWED_OPT_OUT)) {
			expect(reason.trim().length, `理由が短すぎる: ${file}`).toBeGreaterThan(20);
			expect(/^(TODO|n\/a|なし|-)$/i.test(reason.trim())).toBe(false);
		}
	});

	// 定義元が消えた / 名前が変わったのに本 test が緑のまま残ると、guard が何も見なくなる。
	it('定数の定義元が存在する (guard が空振りしていないこと)', () => {
		const source = readFileSync(resolve(REPO_ROOT, DEFINITION_FILE), 'utf8');
		expect(source).toContain('export const NO_RETENTION_FILTER');
	});
});
