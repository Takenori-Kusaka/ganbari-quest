// tests/unit/architecture/pin-length-ssot-fitness.test.ts
// #4698: おやカギコードの桁数を `PIN_LENGTH` (src/lib/domain/constants/oyakagi.ts) 1 箇所に閉じ込める fitness function。
//
// 背景: ゲート UI (`PinInput length={4}`) / verify・setup・reset API (`/^\d{4,6}$/`) / 設定画面 action
// (4〜8 桁) / ラベル (「4〜6桁」「4桁」) が **それぞれ桁数を直書き** していたため三重に食い違い、
// 設定画面の案内どおり 5〜8 桁に変更した親がゲート (4 桁で自動送信) から締め出された。
// 同 class の直書きが再び生まれないよう、桁数リテラルの再出現を CI で止める (ADR-0061 same-class-N→guard)。
//
// ── 検出するもの ─────────────────────────────────────────────────────────────
//   (1) `src/` 配下の PIN 形式 regex 直書き (`^\d{4}$` / `^\d{4,6}$` / `^\d{4,8}$` 等、先頭 4 桁固定の
//       anchored digit pattern)。validator は `isValidPinFormat` / `PIN_PATTERN`
//       (`$lib/domain/constants/oyakagi`) / `pinSchema` (`$lib/domain/validation/auth`) を import する
//   (2) `.svelte` の `<PinInput length={4}>` 数値リテラル (おやカギ入力セル数)。`length={PIN_LENGTH}` にする。
//       OTP (6 桁確認コード) の `length={6}` は対象外 (PIN ではない)
//   (3) `labels.ts` / `terms.ts` でおやカギ文言 (`OYAKAGI_TERMS` 参照行) に桁数リテラル (`N桁` / `N〜M桁`) を書くこと。
//       `${OYAKAGI_TERMS.digitRange}` を使う
//   (4) 顧客可視 UI (labels.ts / terms.ts / *.svelte / tutorial-chapters.ts) に旧既定値「5086」の案内が残ること
//       (#2992 以降は初回作成フローのため誤案内。ロジック定数 DEFAULT_PIN は legacy local 照合専用で可視 UI には出さない)
//   (5) SSOT 自体の値 (PIN_LENGTH = 4、OYAKAGI_TERMS.digitRange が PIN_LENGTH 由来)
//
// #4661 の `tests/unit/domain/oyakagi-pin-length-ssot.test.ts` とは補完関係:
//   あちらは「列挙した呼び出し点」を精査する (桁数直書き / 表示側の digitRange 経由)。
//   本 test は **src 全走査** で列挙漏れ自体を拾い、加えて既定値 5086 の顧客可視 UI 残存を見る。
// ── 検出しないもの ────────────────────────────────────────────────────────────
//   - 設計書 (docs/) の桁数記述。レビューで担保する
//   - 文字列 / コメント内の regex (stripCommentsAndStrings で潰すため)。regex リテラル本体のみ対象

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIN, PIN_LENGTH, PIN_PATTERN } from '../../../src/lib/domain/constants/oyakagi';
import { OYAKAGI_TERMS } from '../../../src/lib/domain/terms';
import { stripCommentsAndStrings } from './helpers/strip-comments-and-strings';

// 走査 test (scope: 'repo'、scripts/lib/ci/repo-scan-test-registry.mjs で宣言済、#4085)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
/** SSOT 本体。PIN 形式 regex を定義してよい唯一の file (#4661 で constants に集約)。 */
const VALIDATOR_SSOT = 'src/lib/domain/constants/oyakagi.ts';

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, out);
		} else if (/\.(ts|svelte|js)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

const files = walk(SRC_DIR);
const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join('/');
const read = (f: string) => readFileSync(f, 'utf-8');

describe('#4698 おやカギコード桁数 SSOT fitness', () => {
	it('走査対象が存在する (検査しなかったことを silent に通さない)', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('[P1] PIN 形式 regex (`^\\d{4...}$`) を validation/auth.ts 以外で直書きしない', () => {
		// `^\d{4}$` / `^\d{4,6}$` / `^\d{4,8}$` … (anchored、先頭 4 桁固定)。日付 `^\d{4}-` は `}` の直後が `$` でないため対象外
		const pinRegexLiteral = /\^\\d\{4(?:,\d+)?\}\$/;
		const violations: string[] = [];
		for (const f of files) {
			const r = rel(f);
			if (r === VALIDATOR_SSOT) continue;
			const body = stripCommentsAndStrings(read(f));
			if (pinRegexLiteral.test(body)) violations.push(r);
		}
		expect(
			violations,
			`PIN 形式 regex 直書き。isValidPinFormat / PIN_PATTERN を import する:\n${violations.join('\n')}`,
		).toEqual([]);
	});

	it('[P2] <PinInput length={4}> の数値リテラルを使わない (length={PIN_LENGTH} にする)', () => {
		const literal = new RegExp(`<PinInput[\\s\\S]*?\\blength=\\{${PIN_LENGTH}\\}`);
		const violations: string[] = [];
		for (const f of files) {
			if (!f.endsWith('.svelte')) continue;
			const body = read(f).replace(/<!--[\s\S]*?-->/g, ' ');
			// 個々の <PinInput …> タグ単位で判定 (複数タグを跨いで誤マッチしないよう分割)
			const tags = body.match(/<PinInput\b[^>]*>/g) ?? [];
			if (tags.some((t) => literal.test(t))) violations.push(rel(f));
		}
		expect(violations, `PinInput length に桁数リテラル:\n${violations.join('\n')}`).toEqual([]);
	});

	it('[P3] labels.ts / terms.ts のおやカギ文言に桁数リテラル (N桁 / N〜M桁) を書かない', () => {
		const targets = ['src/lib/domain/labels.ts', 'src/lib/domain/terms.ts'];
		const digitsLiteral = /[0-9０-９]+(?:\s*[〜～\-–]\s*[0-9０-９]+)?\s*桁/;
		const violations: string[] = [];
		for (const t of targets) {
			const lines = read(path.join(REPO_ROOT, t)).split('\n');
			lines.forEach((line, i) => {
				const trimmed = line.trim();
				if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
				if (!/OYAKAGI_TERMS\.|おやカギ/.test(line)) return;
				if (digitsLiteral.test(line)) violations.push(`${t}:${i + 1}: ${trimmed}`);
			});
		}
		expect(
			violations,
			`おやカギ文言の桁数は \${OYAKAGI_TERMS.digitRange} 経由にする:\n${violations.join('\n')}`,
		).toEqual([]);
	});

	it('[P4] 顧客可視 UI に旧既定値 5086 の案内が残らない (labels / terms / svelte / tutorial)', () => {
		const violations: string[] = [];
		for (const f of files) {
			const r = rel(f);
			if (r === 'src/lib/domain/constants/oyakagi.ts') continue; // ロジック定数 SSOT (legacy local 照合専用)
			if (
				!(
					r.endsWith('.svelte') ||
					r === 'src/lib/domain/labels.ts' ||
					r === 'src/lib/domain/terms.ts' ||
					r.endsWith('tutorial-chapters.ts')
				)
			)
				continue;
			// 文字列リテラル (= 表示文言) の中に DEFAULT_PIN 値が現れたら違反。コメントは対象外
			const noComments = read(f)
				.replace(/\/\*[\s\S]*?\*\//g, ' ')
				.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
				.replace(/<!--[\s\S]*?-->/g, ' ');
			if (noComments.includes(DEFAULT_PIN)) violations.push(r);
		}
		expect(
			violations,
			`「初期値は ${DEFAULT_PIN}」系の誤案内が残存:\n${violations.join('\n')}`,
		).toEqual([]);
	});

	it('[P5] SSOT の値: PIN_LENGTH = 4 (PO 判断)、PIN_PATTERN / OYAKAGI_TERMS.digitRange は PIN_LENGTH 由来', () => {
		expect(PIN_LENGTH).toBe(4);
		expect(PIN_PATTERN.source).toBe(`^\\d{${PIN_LENGTH}}$`);
		expect(OYAKAGI_TERMS.digitRange).toBe(`${PIN_LENGTH}桁`);
	});
});
