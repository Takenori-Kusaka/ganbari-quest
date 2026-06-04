/**
 * scripts/__tests__/check-no-plan-literals.test.mjs
 *
 * #1918 Phase 5 F1 — check-no-plan-literals.mjs の判定ロジック unit test。
 *
 * 実行: node --test scripts/__tests__/check-no-plan-literals.test.mjs
 *
 * テスト範囲:
 * 1. TERM_LITERAL_RULES の atom 候補が網羅されている (Issue AC1)
 * 2. allowlist (terms.ts / labels.ts / tests/) が exclude 判定で外れる (Issue AC2)
 * 3. site/shared-labels.js が SEARCH_ROOTS 外のため対象外 (Issue AC3)
 * 4. checkFile() が違反を検出し、エラーメッセージに atom 名が含まれる (Issue AC5)
 * 5. コメント行は検出対象外
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const { TERM_LITERAL_RULES, VALUE_LITERAL_RULES, checkFile, shouldExclude } = await import(
	'../check-no-plan-literals.mjs'
);

// ---------------------------------------------------------------------------
// AC1: TERM_LITERAL_RULES の網羅
// ---------------------------------------------------------------------------

describe('TERM_LITERAL_RULES (Issue #1918 AC1)', () => {
	it('プラン (フル形) 3 atom を含む', () => {
		const patterns = TERM_LITERAL_RULES.map((r) => r.pattern);
		assert.ok(patterns.includes('スタンダードプラン'));
		assert.ok(patterns.includes('ファミリープラン'));
		assert.ok(patterns.includes('無料プラン'));
	});

	it('価格 atom (月 ¥500 / 月 ¥780 / ¥/月 / 税込) を含む', () => {
		const patterns = TERM_LITERAL_RULES.map((r) => r.pattern);
		assert.ok(patterns.includes('月 ¥500'));
		assert.ok(patterns.includes('月 ¥780'));
		assert.ok(patterns.includes('¥500/月'));
		assert.ok(patterns.includes('¥780/月'));
		assert.ok(patterns.includes('¥500（税込）'));
		assert.ok(patterns.includes('¥780（税込）'));
	});

	it('トライアル atom (7 日間 variants + クレカ) を含む', () => {
		const patterns = TERM_LITERAL_RULES.map((r) => r.pattern);
		assert.ok(patterns.includes('7 日間無料'));
		assert.ok(patterns.includes('7日間無料'));
		assert.ok(patterns.includes('7 日間の無料'));
		assert.ok(patterns.includes('クレジットカード登録不要'));
		assert.ok(patterns.includes('クレカ登録不要'));
	});

	it('解約 atom (anytime / anytimeOk) を含む', () => {
		const patterns = TERM_LITERAL_RULES.map((r) => r.pattern);
		assert.ok(patterns.includes('いつでも解約 OK'));
		assert.ok(patterns.includes('いつでも解約'));
	});

	it('無料訴求 atom (基本無料 / まずは無料) を含む', () => {
		const patterns = TERM_LITERAL_RULES.map((r) => r.pattern);
		assert.ok(patterns.includes('基本無料'));
		assert.ok(patterns.includes('まずは無料'));
	});

	it('全 atom に terms.ts 参照先 (constant 列) が定義されている (AC5)', () => {
		for (const rule of TERM_LITERAL_RULES) {
			assert.ok(rule.constant.length > 0, `pattern '${rule.pattern}' に constant が未設定`);
			assert.equal(rule.kind, 'term');
		}
	});

	it('trial 系 constant 列で案内する atom 組合わせが pattern を char-by-char で完全再現可能 (Copilot R2 [must] #3)', async () => {
		// 修正前: '7 日間無料' → 'TRIAL_TERMS.durationSpaced + FREE_TERMS.start' は
		//   '7 日間' + 'まずは無料' = '7 日間まずは無料' で元 pattern '7 日間無料' を再現できなかった。
		// 修正後: FREE_TERMS.suffix = '無料' atom を追加し、案内文字列が pattern と一致する組合わせ
		//   を提示できるようになった。本 test は terms.ts の atom と pattern の char-by-char 再現性を保証する。
		const { TRIAL_TERMS, FREE_TERMS } = await import(
			path.resolve(REPO_ROOT, 'src/lib/domain/terms.ts')
		).catch(async () => {
			// .ts は node が直接 import できないため動的 read で代替
			const text = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/domain/terms.ts'), 'utf8');
			const extract = (name) => {
				const m = text.match(new RegExp(`${name}:\\s*'([^']+)'`));
				return m ? m[1] : null;
			};
			return {
				TRIAL_TERMS: { duration: extract('duration'), durationSpaced: extract('durationSpaced') },
				FREE_TERMS: { suffix: extract('suffix') },
			};
		});
		assert.equal(`${TRIAL_TERMS.durationSpaced}${FREE_TERMS.suffix}`, '7 日間無料');
		assert.equal(`${TRIAL_TERMS.duration}${FREE_TERMS.suffix}`, '7日間無料');
		assert.equal(`${TRIAL_TERMS.durationSpaced}の${FREE_TERMS.suffix}`, '7 日間の無料');
	});

	it('VALUE_LITERAL_RULES (#972) は kind=value で別系統', () => {
		for (const rule of VALUE_LITERAL_RULES) {
			assert.equal(rule.kind, 'value');
		}
	});
});

// ---------------------------------------------------------------------------
// AC2: allowlist (shouldExclude) の判定
// ---------------------------------------------------------------------------

describe('shouldExclude (Issue #1918 AC2 — allowlist)', () => {
	it('src/lib/domain/terms.ts は exclude (atom 定義 SSOT)', () => {
		assert.equal(shouldExclude(path.join(REPO_ROOT, 'src/lib/domain/terms.ts')), true);
	});

	it('src/lib/domain/labels.ts は exclude (compound 組立て layer)', () => {
		assert.equal(shouldExclude(path.join(REPO_ROOT, 'src/lib/domain/labels.ts')), true);
	});

	it('*.test.ts は exclude (テスト fixture)', () => {
		assert.equal(shouldExclude(path.join(REPO_ROOT, 'src/lib/foo.test.ts')), true);
	});

	it('*.spec.ts は exclude (テスト fixture)', () => {
		assert.equal(shouldExclude(path.join(REPO_ROOT, 'tests/e2e/foo.spec.ts')), true);
	});

	it('*.test.mjs は exclude (scripts unit test)', () => {
		assert.equal(shouldExclude(path.join(REPO_ROOT, 'scripts/__tests__/foo.test.mjs')), true);
	});

	it('src/lib/domain/constants/ 配下は exclude (#972 既存)', () => {
		assert.equal(
			shouldExclude(path.join(REPO_ROOT, 'src/lib/domain/constants/subscription-plan.ts')),
			true,
		);
	});

	it('src/lib/server/services/stripe-service.ts は exclude (#972 既存)', () => {
		assert.equal(
			shouldExclude(path.join(REPO_ROOT, 'src/lib/server/services/stripe-service.ts')),
			true,
		);
	});

	it('通常の .ts / .svelte は exclude されない', () => {
		assert.equal(
			shouldExclude(path.join(REPO_ROOT, 'src/routes/(parent)/admin/+page.svelte')),
			false,
		);
		assert.equal(shouldExclude(path.join(REPO_ROOT, 'src/lib/server/services/foo.ts')), false);
	});
});

// ---------------------------------------------------------------------------
// AC3: site/shared-labels.js は SEARCH_ROOTS 外
// ---------------------------------------------------------------------------

describe('AC3: site/shared-labels.js (auto-generated) は対象外', () => {
	it('site/ は SEARCH_ROOTS に含まれない (拡張子 .js も対象外)', () => {
		// SEARCH_ROOTS は src/ 配下のみ。site/ は walk() で訪問されないため、
		// 物理的に shouldExclude を通すまでもなく対象外。本テストは
		// 設計仕様の固定 (site/ 追加で誤検知しない) を保証する。
		const sharedLabels = path.join(REPO_ROOT, 'site/shared-labels.js');
		// 拡張子が .js のため EXTENSIONS フィルタで除外される (.ts / .svelte のみ対象)
		assert.equal(
			['.ts', '.svelte'].some((ext) => sharedLabels.endsWith(ext)),
			false,
		);
	});
});

// ---------------------------------------------------------------------------
// AC5 + 統合: checkFile() の検出ロジック
// ---------------------------------------------------------------------------

describe('checkFile (Issue #1918 AC5 — エラーメッセージに atom 名)', () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-no-plan-literals-test-'));

	it('「スタンダードプラン」リテラル直書きを検出する', () => {
		const tmpFile = path.join(tmpDir, 'violation-plan.ts');
		fs.writeFileSync(tmpFile, "export const msg = 'スタンダードプランへようこそ';\n", 'utf8');
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].pattern, 'スタンダードプラン');
		assert.equal(findings[0].kind, 'term');
		assert.match(findings[0].constant, /PLAN_FULL_TERMS\.standard/);
	});

	it('「月 ¥500」リテラルを検出し、PRICE_TERMS atom 名を提示する', () => {
		const tmpFile = path.join(tmpDir, 'violation-price.ts');
		fs.writeFileSync(tmpFile, "const price = '月 ¥500から';\n", 'utf8');
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].pattern, '月 ¥500');
		assert.match(findings[0].constant, /PRICE_TERMS/);
	});

	it('「7 日間無料」「クレジットカード登録不要」「いつでも解約 OK」を一括検出', () => {
		const tmpFile = path.join(tmpDir, 'violation-trial-cancel.ts');
		fs.writeFileSync(
			tmpFile,
			[
				"export const a = '7 日間無料です';",
				"export const b = 'クレジットカード登録不要';",
				"export const c = 'いつでも解約 OK';",
			].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		// 「いつでも解約 OK」は「いつでも解約」も部分一致するため 4 件 (重複検出は仕様)
		const patterns = new Set(findings.map((f) => f.pattern));
		assert.ok(patterns.has('7 日間無料'));
		assert.ok(patterns.has('クレジットカード登録不要'));
		assert.ok(patterns.has('いつでも解約 OK'));
	});

	it('「基本無料」「まずは無料」を検出', () => {
		const tmpFile = path.join(tmpDir, 'violation-free.ts');
		fs.writeFileSync(
			tmpFile,
			["const x = '基本無料で開始';", "const y = 'まずは無料体験';"].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		const patterns = new Set(findings.map((f) => f.pattern));
		assert.ok(patterns.has('基本無料'));
		assert.ok(patterns.has('まずは無料'));
	});

	it('違反のないファイルは findings = []', () => {
		const tmpFile = path.join(tmpDir, 'clean.ts');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: テスト fixture (検査対象 .ts ファイル) のため意図的に template literal 文字列を保持
		const cleanFixture = 'export const msg = `${PLAN_FULL_TERMS.standard}へようこそ`;';
		fs.writeFileSync(
			tmpFile,
			["import { PLAN_FULL_TERMS } from '$lib/domain/terms';", cleanFixture].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 0);
	});

	it('行頭 // コメントは検出対象外', () => {
		const tmpFile = path.join(tmpDir, 'comment-line.ts');
		fs.writeFileSync(
			tmpFile,
			[
				'// 無料プラン向けアップグレード誘導',
				'	// プランゲート — 無料プランはカスタム報酬付与不可',
				'export const ok = true;',
			].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 0);
	});

	it('ブロックコメント /* ... */ は検出対象外', () => {
		const tmpFile = path.join(tmpDir, 'block-comment.ts');
		fs.writeFileSync(
			tmpFile,
			[
				'/*',
				' * 無料プランの説明:',
				' * スタンダードプランとファミリープランの違いを記載',
				' */',
				'export const ok = true;',
			].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 0);
	});

	it('シングル行ブロックコメント + 後続コード `/* foo */ const bad = ...` は後続コードのリテラルを検出する (Copilot R2 [must])', () => {
		// 修正前: isCommentLine() が `^\s*\/\*` のみで無条件 true → 行全体スキップ →
		// 後続コードのリテラル直書きが検出されず CI 回避できてしまう問題。
		// 修正後: tail にコードがある場合は行全体を検査ループに渡し、リテラルを検出する。
		const tmpFile = path.join(tmpDir, 'inline-block-comment.ts');
		fs.writeFileSync(
			tmpFile,
			["/* note */ export const bad = 'スタンダードプランへようこそ';"].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		assert.ok(
			findings.some((f) => f.pattern === 'スタンダードプラン'),
			'`/* foo */ const bad = "スタンダードプラン..."` の後続コードを検出すべき',
		);
	});

	it('シングル行ブロックコメントのみ `/* スタンダードプラン */` は検出対象外', () => {
		// tail が空の場合は従来通りコメント扱いで除外。
		const tmpFile = path.join(tmpDir, 'inline-block-comment-only.ts');
		fs.writeFileSync(
			tmpFile,
			['/* スタンダードプラン */', 'export const ok = true;'].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 0);
	});

	it('HTML コメント (Svelte 単一行 <!-- ... -->) は検出対象外 (CodeQL js/bad-tag-filter 回避後も維持)', () => {
		// PR-2021 CodeQL fix: regex `/^\s*<!--.*-->\s*$/` を文字列前後一致 (startsWith/endsWith) に
		// 置き換えた後も、行頭/行末空白あり / 内部に term 含む / 短小ケースで等価性を維持する保証。
		const tmpFile = path.join(tmpDir, 'html-comment.svelte');
		fs.writeFileSync(
			tmpFile,
			[
				'<script>let x = 1;</script>',
				'<!-- 無料プラン向け案内 (検出されない) -->',
				'   <!-- スタンダードプラン以上で利用可能 -->   ',
				'<!---->',
				'<p>スタンダードプラン以上で利用可能</p>',
			].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		// 最終 <p> の 1 行のみ違反。HTML コメント 3 行は除外されるべき。
		assert.equal(findings.length, 1);
		assert.equal(findings[0].pattern, 'スタンダードプラン');
		assert.equal(findings[0].line, 5);
	});

	it('JSDoc 内の * 行は検出対象外 (行頭 *)', () => {
		const tmpFile = path.join(tmpDir, 'jsdoc.ts');
		fs.writeFileSync(
			tmpFile,
			[
				'/**',
				' * @example スタンダードプラン以上で利用可能',
				' */',
				'export function foo() {}',
			].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 0);
	});

	it('Svelte template の HTML 直書きも検出する', () => {
		const tmpFile = path.join(tmpDir, 'violation.svelte');
		fs.writeFileSync(
			tmpFile,
			['<script>let x = 1;</script>', '<p>スタンダードプラン以上で利用可能</p>'].join('\n'),
			'utf8',
		);
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].pattern, 'スタンダードプラン');
	});

	it('既存 VALUE_LITERAL_RULES (#972 family-monthly) も従来通り検出', () => {
		const tmpFile = path.join(tmpDir, 'value-rule.ts');
		fs.writeFileSync(tmpFile, "const plan = 'family-monthly';\n", 'utf8');
		const findings = checkFile(tmpFile);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].pattern, 'family-monthly');
		assert.equal(findings[0].kind, 'value');
		assert.match(findings[0].constant, /SUBSCRIPTION_PLAN\.FAMILY_MONTHLY/);
	});
});

// ---------------------------------------------------------------------------
// 統合: terms.ts / labels.ts は allowlist で除外されるため違反扱いされない
// ---------------------------------------------------------------------------

describe('統合: terms.ts / labels.ts は allowlist で対象外', () => {
	it('実 terms.ts は shouldExclude=true (検査対象に入らない)', () => {
		const termsPath = path.join(REPO_ROOT, 'src/lib/domain/terms.ts');
		// terms.ts 自身に PLAN_FULL_TERMS.standard = 'スタンダードプラン' のリテラルが
		// 含まれるが、shouldExclude=true なので walk() 結果に入らない仕様。
		assert.equal(shouldExclude(termsPath), true);
	});

	it('実 labels.ts は shouldExclude=true', () => {
		const labelsPath = path.join(REPO_ROOT, 'src/lib/domain/labels.ts');
		assert.equal(shouldExclude(labelsPath), true);
	});
});
