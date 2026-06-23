// tests/unit/architecture/fetch-error-handling-ratchet.test.ts
// #3225 P2 (EPIC #3217 / ADR-0061 決定④ fitness function): client fetch の silent-failure
// 再発防止 ratchet。
//
// 背景: バックエンドエラー時にユーザへ何も通知されない silent-failure が複数画面で反復した
//   (#3186 → #3204 → EPIC #3217)。これは WCAG 3.3.1 (A) + 4.1.3 (AA) 二重違反。P0/P1 で
//   helper (notifyApiError 等) を導入し既存 silent を解消したが、**新規の未処理 fetch が再び
//   混入する**のを機械で止めるのが本 ratchet (ADR-0061 = band-aid でなく class を lock)。
//
// 検出ロジック (heuristic): routes / features の .svelte 内の client `fetch(` 呼び出しのうち、
//   直後ウィンドウに「エラー処理の痕跡」(res.ok チェック / catch / notify* / showToast / throw)
//   が**一切ない**ものを「未処理 fetch」として数える。base-token-routes-ratchet と同型の
//   baseline ratchet で「新規違反 0 (= 増やさない)」を固定し、段階削減を促す。
//
// 既存の未処理 fetch (fire-and-forget な既読化 fetch 等) は BASELINE に織り込む。helper 配線で
//   解消したら BASELINE を下げる (ratchet-down)。新規 silent fetch を足すと CI が落ちる。
//
// 注: server fetch (`+server.ts` / `+page.server.ts` / services の server-to-server) は
//   別概念のため対象外 (.svelte の client fetch のみ走査)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN_DIRS = [resolve(REPO_ROOT, 'src/routes'), resolve(REPO_ROOT, 'src/lib/features')];

// client fetch 呼び出し。
const FETCH_CALL_RE = /\bfetch\s*\(/g;
// fetch 直後ウィンドウ内に「エラー処理の痕跡」があれば handled とみなす。
//   - `<var>.ok` チェック (res.ok / resp.ok / response.ok 等)
//   - catch / notify* / showToast (例外・通知)
//   - form action result 処理 (deserialize / result.type / actionResult.type / .type === 'failure'|'error')
//   - 失敗表示 state の代入 (actionMessage / *Error =)
//   - throw (上位へ委譲)
const ERROR_HANDLING_RE =
	/\b\w+\.ok\b|notifyApiError|notifyNetworkError|notifyActionError|showToast|\.catch\s*\(|catch\s*[({]|throw\b|deserialize\s*\(|\.type\s*===?\s*['"](?:failure|error)['"]|\btype\b\s*===?\s*['"](?:failure|error)['"]|actionMessage\s*=|Error\s*=/;
// 直前ウィンドウに try ブロックがあれば fetch は try/catch に包まれている (handled)。
const TRY_BEFORE_RE = /\btry\s*\{/;
// fetch 直後 / 直前の走査ウィンドウ (form action 処理ブロックは長いので広めに取る)。
const WINDOW_CHARS = 1100;
const BACKWARD_CHARS = 240;
// 明示 exempt マーカー (意図的な fire-and-forget。直前/同行コメントに付与)。
const EXEMPT_MARKER = 'fetch-error-exempt';

// #3225 P2 時点の既存「未処理 fetch」occurrence 数。helper 配線で解消したら下げる。増加は CI fail。
//   現 develop の 1 件は `(child)/[uiMode]/home` の togglePin (PR #3253 で age-tier 文言配線、
//   merge 後は実測 0 に減る)。#3253 が先に merge されれば本 baseline を 0 に ratchet-down する。
const BASELINE_UNHANDLED = 1;

function walkSvelteFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walkSvelteFiles(full, acc);
		} else if (entry.name.endsWith('.svelte')) {
			acc.push(full);
		}
	}
	return acc;
}

interface Unhandled {
	file: string;
	line: number;
}

function findUnhandledFetches(): Unhandled[] {
	const found: Unhandled[] = [];
	for (const dir of SCAN_DIRS) {
		for (const file of walkSvelteFiles(dir, [])) {
			const content = readFileSync(file, 'utf-8');
			FETCH_CALL_RE.lastIndex = 0;
			let m: RegExpExecArray | null = FETCH_CALL_RE.exec(content);
			while (m !== null) {
				const start = m.index;
				const window = content.slice(start, start + WINDOW_CHARS);
				const before = content.slice(Math.max(0, start - BACKWARD_CHARS), start);
				const handled =
					ERROR_HANDLING_RE.test(window) ||
					TRY_BEFORE_RE.test(before) ||
					before.includes(EXEMPT_MARKER);
				if (!handled) {
					const line = content.slice(0, start).split('\n').length;
					found.push({ file: file.replace(REPO_ROOT, '').replace(/\\/g, '/'), line });
				}
				m = FETCH_CALL_RE.exec(content);
			}
		}
	}
	return found;
}

describe('#3225 P2: client fetch silent-failure 再発防止 ratchet (EPIC #3217 / ADR-0061)', () => {
	it('エラー処理のない client fetch は baseline を超えない (新規 silent fetch 0)', () => {
		const unhandled = findUnhandledFetches();
		expect(
			unhandled.length,
			`エラー処理 (res.ok チェック / catch / notifyApiError 等 / showToast) を伴わない client ` +
				`fetch が baseline (${BASELINE_UNHANDLED}) を超えた (実測 ${unhandled.length})。\n` +
				`新規 fetch は失敗時にユーザへ可視フィードバックを出すこと (src/lib/ui/error-notify.ts の ` +
				`notifyApiError / notifyNetworkError、ADR-0062)。意図的な fire-and-forget は直前コメントに ` +
				`'${EXEMPT_MARKER}' を付与する。\n該当:\n${unhandled.map((u) => `  ${u.file}:${u.line}`).join('\n')}`,
		).toBeLessThanOrEqual(BASELINE_UNHANDLED);
	});

	it('baseline は実測と大きく乖離していない (削減済なら ratchet-down を促す)', () => {
		// 3 件以上まとめて解消したのに baseline 据置の場合に気付けるよう緩い下限を置く
		// (1→0 のような小差では発火しない。base-token-routes-ratchet と同型)。
		const actual = findUnhandledFetches().length;
		expect(
			BASELINE_UNHANDLED - actual,
			`未処理 fetch が baseline より 3 以上少ない (実測 ${actual} / baseline ${BASELINE_UNHANDLED})。` +
				'BASELINE_UNHANDLED を実測値へ下げて ratchet を締める。',
		).toBeLessThan(3);
	});
});
