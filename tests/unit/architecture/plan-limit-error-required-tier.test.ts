// tests/unit/architecture/plan-limit-error-required-tier.test.ts (#4710 / ADR-0061)
//
// **プラン制限の 403 は、要求 tier を知っている経路からしか返せない**ことを機械で保証する。
//
// # なぜ必要か
//
// `apiError('PLAN_LIMIT_EXCEEDED', …)` は userMessage を `ERROR_DEFINITIONS` の固定文
// (「この機能はスタンダードプラン以上でご利用いただけます」) から取る。呼び出し側が
// premium 限定機能を拒否しても文面は変わらないため、**スタンダード契約者が AI 提案を叩くと
// 「スタンダード以上にしてください」と言われる** (#4710 実測 `POST /api/v1/activities/suggest`)。
// 既にスタンダードなので、顧客はこの案内では次の行動を取れない。
//
// 個々の endpoint で文言を足すのではなく、**要求 tier を引数で受ける `planLimitError()` を
// 唯一の入口にする**ことで、tier を知らずに 403 を返すこと自体を不可能にする。
//
// # 何を fail させるか
//
// `apiError('PLAN_LIMIT_EXCEEDED', …)` の直接呼び出しが production code に現れた状態。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/** src 配下の .ts / .svelte を再帰列挙する。 */
function walk(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, acc);
		else if (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) acc.push(full);
	}
	return acc;
}

/**
 * `apiError('PLAN_LIMIT_EXCEEDED'` を書いてよい file。
 * 定義側 (errors.ts) は ERROR_DEFINITIONS に code を持つため一致するが、呼び出しではない。
 */
const ALLOWED = new Set(['src/lib/server/errors.ts', 'src/lib/domain/errors.ts']);

// repo 走査 test (#4085): src 全体を歩くため既定 5s では並列実行の負荷で落ちる。
vi.setConfig({ testTimeout: 60_000 });

describe('#4710 プラン制限 403 は要求 tier を伴う経路からのみ返す', () => {
	const files = walk(SRC_ROOT);

	it("production code に apiError('PLAN_LIMIT_EXCEEDED') の直接呼び出しが無い", () => {
		const violations: string[] = [];
		for (const file of files) {
			const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
			if (ALLOWED.has(rel)) continue;
			const src = readFileSync(file, 'utf-8');
			// 呼び出し形のみを見る (コメント中の言及は `apiError(` を伴わないので当たらない)
			if (/apiError\(\s*'PLAN_LIMIT_EXCEEDED'/.test(src)) violations.push(rel);
		}
		expect(
			violations,
			[
				'プラン制限の 403 を要求 tier 無しで返しています。',
				`  該当: ${violations.join(', ')}`,
				"→ planLimitError('standard' | 'family', message) を使ってください。",
				'  固定 userMessage は「スタンダード以上に」しか言えず、',
				'  スタンダード契約者が premium 限定機能を叩いたときに次の行動を示せません (#4710)。',
			].join('\n'),
		).toEqual([]);
	});

	// QM #4767: `apiError('PLAN_LIMIT_EXCEEDED')` を避けても、`json({ error: { code: 'PLAN_LIMIT_EXCEEDED' … } })`
	// を route で手組みすれば同じ穴が開く (errors.ts の quotaLimitError 自体がその形で書かれていた)。
	// code リテラルの出現そのものを errors.ts の外で禁止し、「入口は errors.ts の helper だけ」を保つ。
	it("production code に code: 'PLAN_LIMIT_EXCEEDED' の手組みが無い (入口は errors.ts の helper だけ)", () => {
		const violations: string[] = [];
		for (const file of files) {
			const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
			if (ALLOWED.has(rel)) continue;
			const src = readFileSync(file, 'utf-8');
			if (/code:\s*['"`]PLAN_LIMIT_EXCEEDED['"`]/.test(src)) violations.push(rel);
		}
		expect(
			violations,
			[
				'PLAN_LIMIT_EXCEEDED を errors.ts の helper (planLimitError / quotaLimitError) を通さず手組みしています。',
				`  該当: ${violations.join(', ')}`,
			].join('\n'),
		).toEqual([]);
	});

	it('planLimitError が実在し、要求 tier を引数に取る', () => {
		const src = readFileSync(join(SRC_ROOT, 'lib/server/errors.ts'), 'utf-8');
		expect(src).toMatch(/export function planLimitError\(\s*requiredTier: 'standard' \| 'family',/);
	});

	// #4710 追加: 要求 tier を引数で受け取れても、**そもそも何の失敗かを message の部分一致で
	// 見分けていたら**同じ穴が開く。実際 `POST /api/v1/export/cloud` は
	// 「プラン未達」と「保管上限」の 2 事象を `msg.includes('スタンダード') || msg.includes('上限')`
	// で拾い、**両方**を planLimitError('standard') に潰していた。上限に達するのは契約中の顧客
	// だけなので、既にスタンダードな顧客に「スタンダード以上でご利用いただけます」と返っていた。
	//
	// 加えてこの判定はプラン名・文言を変えた瞬間に外れ、403 が 500 に化ける (文言は labels.ts
	// SSOT から組み立てられるので、変わることが前提の値である)。
	//
	// 失敗の種類は**型で**運ぶこと (専用 Error class を throw し `instanceof` で分岐する)。
	it('プラン / 上限の判定を例外 message の部分一致で行っていない', () => {
		// `.includes('…スタンダード…')` 等、プラン系の語の部分一致で分岐している呼び出し形。
		// コメント中の言及に当たらないよう、`.includes(` を伴う形だけを見る。
		const sniff =
			/\.includes\(\s*['"`][^'"`]*(スタンダード|プラン|アップグレード|上限)[^'"`]*['"`]/;

		/**
		 * accepted residual は **0 件** (PO 回答 2026-09-03 §4 #2 follow-up で解消)。
		 *
		 * 旧: `DashboardService` が client 層で HTTP レスポンス body の message を見ており、
		 * 是正には activity-pin API 側に固有 code が要るとして残置していた。その固有 code
		 * (`PIN_LIMIT_EXCEEDED`) を `errors.ts` に足し、route が service の拒否理由を 1:1 で
		 * 写像するようにしたため、client は code だけで分岐でき部分一致は消えた。
		 * **残置 entry ごと削除して guard を締める** (旧コメントの指示どおり)。
		 */

		const violations: string[] = [];
		for (const file of files) {
			const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
			if (sniff.test(readFileSync(file, 'utf-8'))) violations.push(rel);
		}
		expect(
			violations,
			[
				'失敗の種類をプラン系の語の部分一致で判定しています。',
				`  該当: ${violations.join(', ')}`,
				'→ service 側で専用 Error class を throw し、instanceof で分岐してください。',
				'  文言は labels.ts SSOT から組み立てられる = 変わる値なので、部分一致は',
				'  いずれ外れて 403 が 500 になります。外れる前も「プラン未達」と「上限到達」を',
				'  同じ案内に潰し、契約済みの顧客に契約を促します (#4710)。',
			].join('\n'),
		).toEqual([]);
	});
});
