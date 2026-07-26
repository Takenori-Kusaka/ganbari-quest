// tests/unit/infra/cdk-hook-timeout-guard.test.ts
// #3975: 「infra suite の beforeAll が明示 timeout を持たない」class を機械 gate 化する。
//
// 背景: CDK 合成 (`new cdk.App()` → `Template.fromStack()`) は 1 回目に `aws-cdk-lib` の
// cold load を含み、Windows ローカルでは vite.config.ts の既定 `hookTimeout: 10_000` を超える。
// CI (Linux) は収まるため **ローカルだけが恒常 red** になり、pre-ready Step 3 の red が
// 「またいつものやつ」として無視される — gate が形式だけ残って実効を失う経路 (ADR-0061)。
//
// 本ディレクトリの 7 suite のうち 6 本は既に明示 timeout を持ち、`dsql-cdk.test.ts` だけが
// 欠けていた = 「規約はあるが機械強制がなく、新しい suite が黙って外れる」same-class N 状態。
// 新規 infra suite が timeout 指定を忘れても、次に遅くなるまで誰も気付かないため gate 化する。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const INFRA_TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 既定 hookTimeout (10s) では CDK 合成に足りないため、最低これ以上を要求する。 */
const MIN_HOOK_TIMEOUT_MS = 60_000;

/**
 * `beforeAll(` の開き括弧から対応する閉じ括弧までを取り出す。
 * 正規表現では入れ子の括弧・文字列を数え切れないため、括弧の対応を実際に走査する。
 */
function extractCallArgs(source: string, callStart: number): string | null {
	let depth = 0;
	for (let i = callStart; i < source.length; i++) {
		const ch = source[i];
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) return source.slice(callStart + 1, i);
		}
	}
	return null;
}

/** `beforeAll(fn, 60_000)` の第 2 引数 (ms) を返す。未指定なら null。 */
function readHookTimeouts(source: string): (number | null)[] {
	const results: (number | null)[] = [];
	const marker = /\bbeforeAll\s*\(/g;
	let m: RegExpExecArray | null = marker.exec(source);
	while (m !== null) {
		const open = m.index + m[0].length - 1;
		const args = extractCallArgs(source, open);
		// 末尾引数が数値リテラル (`60_000` / `60000`) のときだけ timeout 指定とみなす。
		const tail = args?.trimEnd().match(/,\s*([\d_]+)\s*$/);
		results.push(tail ? Number(tail[1].replaceAll('_', '')) : null);
		m = marker.exec(source);
	}
	return results;
}

describe('#3975 infra suite の beforeAll は明示 hook timeout を持つ', () => {
	const files = fs
		.readdirSync(INFRA_TEST_DIR)
		.filter((f) => f.endsWith('.test.ts'))
		.filter((f) => f !== path.basename(fileURLToPath(import.meta.url)));

	it('[G0] 走査対象の infra test file を 1 本以上発見する (0 件マッチの素通りを防ぐ)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it(`[G1] beforeAll を持つ全 suite が ${MIN_HOOK_TIMEOUT_MS}ms 以上の明示 timeout を渡す`, () => {
		const violations: string[] = [];
		for (const file of files) {
			const source = fs.readFileSync(path.join(INFRA_TEST_DIR, file), 'utf8');
			readHookTimeouts(source).forEach((ms, i) => {
				if (ms === null) {
					violations.push(`${file}: beforeAll #${i + 1} に timeout 指定がない`);
				} else if (ms < MIN_HOOK_TIMEOUT_MS) {
					violations.push(`${file}: beforeAll #${i + 1} の timeout ${ms}ms が下限未満`);
				}
			});
		}
		expect(
			violations,
			`infra suite の beforeAll は CDK 合成の cold load を含むため明示 timeout が必須:\n` +
				`${violations.join('\n')}\n` +
				`→ 該当 beforeAll の第 2 引数に ${MIN_HOOK_TIMEOUT_MS} 以上を渡す ` +
				`(理由は dsql-cdk.test.ts の beforeAll コメントを参照)`,
		).toEqual([]);
	});

	// 抽出ロジック自体の検証。規約に従うデータだけを見て「違反を検出できないこと」を
	// 見逃さないよう、**規約から外れた形**を実名で混ぜる (dev-session §QA 指摘台帳 観点 3)。
	it('[G2] timeout 未指定 / 下限未満 / 入れ子括弧 を正しく読み分ける', () => {
		expect(readHookTimeouts('beforeAll(() => { synth(); });')).toEqual([null]);
		expect(readHookTimeouts('beforeAll(() => { synth(); }, 10_000);')).toEqual([10000]);
		expect(readHookTimeouts('beforeAll(() => { synth(); }, 60_000);')).toEqual([60000]);
		expect(readHookTimeouts('beforeAll(() => { f(g(h())); }, 120000);')).toEqual([120000]);
		// 同一 file に複数 beforeAll があっても各々を独立に読む
		expect(readHookTimeouts('beforeAll(a);\nbeforeAll(b, 60_000);')).toEqual([null, 60000]);
	});
});
