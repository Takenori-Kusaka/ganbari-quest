#!/usr/bin/env node
/**
 * scripts/check-local-tz-date-getters.mjs (#4015 / ADR-0061 same-class-N → guard)
 *
 * ローカル TZ 日付 getter (`getFullYear()` / `getMonth()` / `getDate()` / `getDay()`) の
 * 無秩序な使用を止める CI ガード。
 *
 * ## なぜ必要か
 *
 * 本番 runtime は 2 種類あり、プロセス TZ が一致しない。
 *
 *   - AWS Lambda / CI runner : UTC → JST 00:00〜09:00 の 9 時間、暦日が 1 日前になる
 *   - NUC セルフホスト        : JST → JST と一致する
 *
 * つまりローカル getter は「同じコードが環境ごとに違う日付を返す」。#4003 ではこれで
 * 子供ホームの週次チャレンジが毎週 9 時間まるごと消えた (3 例目)。日付計算の SSOT は
 * `src/lib/domain/date-utils.ts` (JST 基準) 側に既に存在していたが、**違反を検知する手段が
 * 無かったため新規コードに同じ形が入り続けた**。本 gate がその検知手段。
 *
 * ## 検査ルール
 *
 * 1. `SEARCH_ROOTS` 配下の `.ts` / `.svelte` を走査し、コメント行以外のローカル getter を数える
 *    (`getUTCFullYear()` 等の UTC getter は TZ 非依存なので対象外)
 * 2. **no-silent-gap**: 検出のあった file が `ALLOWLIST` に無ければ fail
 *    (新規 file で黙って増えることを防ぐ)
 * 3. **ratchet**: allowlist entry の `max` を超えた occurrence 数は fail
 *    (allowlist 済 file の中で新規に増えることも防ぐ)
 * 4. **理由の強制**: `reason` が空 / 未設定の entry があれば、違反 0 件でも fail
 *    (「除外はしたが理由が無い」= #3956 で観測した形骸化を作らない)
 *
 * allowlist に載っているのは #4015 の全数棚卸で **(b) 安全** と判定した箇所のみ。分類基準:
 *
 *   - b1: `YYYY-MM-DD` を `T00:00:00Z` (UTC 深夜) でパースし、そこから加減算する
 *         (UTC+0 以上の TZ では暦要素が一致するため UTC / JST 両 runtime で同結果)
 *   - b2: `YYYY-MM-DD` を `T00:00:00` (ローカル深夜) でパースし、ローカル getter で読む
 *         (パースと読み出しが同じ TZ 系で閉じている)
 *   - b3: `setDate(getDate() + N)` が「N 日後の絶対時刻 (期限)」生成で、暦要素を外に出さない
 *
 * **新しく (a) 相当 (= 実時刻の瞬間からローカル getter で暦要素を取り出す) を書かないこと。**
 * その用途は `date-utils.ts` の `todayDateJST` / `toJSTDateString` / `weekStartJST` /
 * `weekEndJST` / `addDaysJST` / `jstDayOfWeek` / `jstYearMonth` / `monthKeyJST` /
 * `shiftMonthKey` / `monthStartJST` / `monthEndJST` / `isInJstMonth` が担う。
 *
 * 使用法: node scripts/check-local-tz-date-getters.mjs
 * CI: 検出時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain as isMainModule } from './lib/is-main.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/** 走査ルート (REPO_ROOT 相対)。tests/ は意図的な時刻固定が多いため対象外 (#4015 No-gos)。 */
export const SEARCH_ROOTS = ['src'];

/** 走査対象拡張子 */
export const EXTENSIONS = ['.ts', '.svelte'];

/**
 * ローカル TZ 日付 getter。`getUTC*` は先頭の `.` で自然に除外される
 * (`.getDate(` は `.getUTCDate(` に一致しない)。
 */
export const LOCAL_TZ_GETTER = /\.(getFullYear|getMonth|getDate|getDay)\s*\(\s*\)/;

/**
 * allowlist — #4015 の全数棚卸で (b) 安全と判定した箇所のみ。
 *
 * `file`: REPO_ROOT 相対 path (`/` 区切り) / `max`: 許容 occurrence 数 (ratchet 上限)
 * `reason`: **必須**。空文字なら本 script 自身が fail する。
 */
export const ALLOWLIST = [
	{
		file: 'src/lib/domain/labels.ts',
		max: 0,
		reason:
			'(SSOT 化済) 週次チャート曜日は jstDayOfWeek() 経由に置換済。将来の再混入を 0 で pin する',
	},
	{
		file: 'src/lib/server/services/birthday-bonus-service.ts',
		max: 6,
		reason:
			'(b2) 誕生日 / 基準日とも YYYY-MM-DD + T00:00:00 のローカル深夜パースで、ローカル getter による読み出しと同じ TZ 系で閉じている (年齢差分・年判定とも TZ 非依存)',
	},
	{
		file: 'src/lib/server/services/report-service.ts',
		max: 3,
		reason:
			'(b1) `new Date(startDate)` = YYYY-MM-DD の UTC 深夜パースに対する日次ループの ±1 日加算。暦要素の文字列化は toJSTDateString() に委譲済',
	},
	{
		file: 'src/lib/server/services/plan-limit-service.ts',
		max: 2,
		reason:
			'(b1) 保持期間 cutoff (JST 基準の YYYY-MM-DD) を UTC 深夜でパースしてからの -1 日。UTC+0 以上の runtime で同一文字列になる',
	},
	{
		file: 'src/lib/server/services/daily-mission-service.ts',
		max: 2,
		reason:
			'(b2) JST 日付文字列をローカル深夜でパースし、ローカル getter で日数を戻す。パースと読み出しが同じ TZ 系',
	},
	{
		file: 'src/lib/server/services/usage-log-service.ts',
		max: 4,
		reason:
			'(b3) 検索範囲の上下端 / 日次バケット offset として「±N 日後の絶対時刻」を作るのみで、暦要素をローカル getter で外に出していない',
	},
	{
		file: 'src/lib/server/services/child-challenge-service.ts',
		max: 1,
		reason: '(b3) 集計入力の「14 日前の絶対時刻」生成のみ。暦要素の露出なし',
	},
	{
		file: 'src/lib/server/services/activity-pin-service.ts',
		max: 1,
		reason: '(b3) 使用頻度集計の「N 日前の絶対時刻」生成のみ。暦要素の露出なし',
	},
	{
		file: 'src/lib/server/services/grace-period-service.ts',
		max: 1,
		reason: '(b3) 物理削除猶予期限 = N 日後の絶対時刻を作り ISO で保存するのみ',
	},
	{
		file: 'src/lib/server/services/cloud-export-service.ts',
		max: 1,
		reason: '(b3) エクスポート PIN の有効期限 = N 日後の絶対時刻を作り ISO で保存するのみ',
	},
	{
		file: 'src/lib/server/services/viewer-token-service.ts',
		max: 1,
		reason: '(b3) 閲覧トークン失効時刻 = N 日後の絶対時刻を作り ISO で保存するのみ',
	},
	{
		file: 'src/lib/server/db/demo/daily-mission-repo.ts',
		max: 1,
		reason: '(b1) missionDate (YYYY-MM-DD) の UTC 深夜パースからの -1 日',
	},
	{
		file: 'src/lib/server/demo/demo-data.ts',
		max: 2,
		reason: '(b1) 固定日付 / 固定瞬間を起点とした -N 日。デモ fixture であり実時刻起点でない',
	},
	{
		file: 'src/lib/server/debug-plan.ts',
		max: 1,
		reason:
			'(b3) DEBUG_TRIAL の擬似終了日を「7 日後の絶対時刻」で作り、暦日化は toJSTDateString() に委譲 (dev 専用、本番ビルド無効)',
	},
	{
		file: 'src/routes/api/v1/admin/tenant/cancel/+server.ts',
		max: 1,
		reason: '(b3) 解約猶予期限 = N 日後の絶対時刻を作り ISO で保存するのみ',
	},
	{
		file: 'src/routes/(child)/[uiMode=uiMode]/(character)/history/+page.server.ts',
		max: 2,
		reason: '(b3) 履歴取得範囲の「N 日前の絶対時刻」生成のみ。暦日化は toJSTDateString() に委譲済',
	},
	{
		file: 'src/routes/(child)/[uiMode=uiMode]/(character)/history/+page.svelte',
		max: 3,
		reason:
			'(b2) recordedAt 由来の YYYY-MM-DD をローカル深夜パースし、ローカル getter で表示用の月 / 日 / 曜日にする。パースと読み出しが同じ TZ 系',
	},
	{
		file: 'src/routes/(parent)/admin/reports/+page.svelte',
		max: 1,
		reason:
			'(b2) 選択中の月キー文字列からローカルコンストラクタで構築した Date をローカル getter で読む。実時刻由来でない',
	},
	{
		file: 'src/lib/features/admin/components/ChildListCard.svelte',
		max: 1,
		reason:
			'(b1) 誕生日 (YYYY-MM-DD) の UTC 深夜パースを月 / 日の表示に使う。UTC+0 以上の TZ で暦要素が一致',
	},
	{
		file: 'src/lib/features/child-home/BabyHomePage.stories.svelte',
		max: 4,
		reason:
			'(dev) Storybook の fixture 生成 (「N ヶ月前生まれ」等の相対誕生日)。本番ビルドに含まれず顧客に見える値を作らない',
	},
	{
		file: 'src/lib/ui/primitives/BirthdayInput.svelte',
		max: 1,
		reason:
			'(b2) 月の日数算出 `new Date(y, m, 0).getDate()` はローカルコンストラクタ + ローカル getter で閉じており、返る日数は TZ 非依存',
	},
];

/**
 * relPath (`/` 区切り) の allowlist entry を返す
 * @param {string} relPath
 * @returns {{file: string, max: number, reason: string} | undefined}
 */
export function findAllowlistEntry(relPath) {
	const normalized = relPath.replace(/\\/g, '/');
	return ALLOWLIST.find((e) => e.file === normalized);
}

/**
 * allowlist 自体の健全性検査。`reason` が空 / 空白のみの entry を返す。
 * 「除外したが理由が無い」形骸化を構造的に禁じる (#3956 の教訓)。
 * @returns {Array<{file: string, max: number, reason: string}>}
 */
export function findAllowlistEntriesWithoutReason() {
	return ALLOWLIST.filter((e) => typeof e.reason !== 'string' || e.reason.trim() === '');
}

/**
 * line がコメント行なら true (経緯記述・SSOT 説明は許容する)
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
	const trimmed = line.trimStart();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('*') ||
		trimmed.startsWith('/*') ||
		trimmed.startsWith('<!--')
	);
}

/**
 * 1 ファイル分の content からローカル TZ getter 行を抽出する (純関数)。
 * @param {string} relPath REPO_ROOT 相対 path
 * @param {string} content ファイル内容
 * @returns {Array<{file: string, line: number, snippet: string}>}
 */
export function findOccurrencesInContent(relPath, content) {
	/** @type {Array<{file: string, line: number, snippet: string}>} */
	const out = [];
	content.split(/\r?\n/).forEach((line, idx) => {
		if (!LOCAL_TZ_GETTER.test(line)) return;
		if (isCommentLine(line)) return;
		out.push({
			file: relPath.replace(/\\/g, '/'),
			line: idx + 1,
			snippet: line.trim().slice(0, 120),
		});
	});
	return out;
}

/**
 * occurrence 群を allowlist と突き合わせ、違反 (no-silent-gap / ratchet 超過) を返す。
 * @param {Array<{file: string, line: number, snippet: string}>} occurrences
 * @returns {Array<{kind: 'not-allowlisted'|'over-max', file: string, count: number, max: number, samples: Array<{file: string, line: number, snippet: string}>}>}
 */
export function evaluateOccurrences(occurrences) {
	/** @type {Map<string, Array<{file: string, line: number, snippet: string}>>} */
	const byFile = new Map();
	for (const o of occurrences) {
		const list = byFile.get(o.file) ?? [];
		list.push(o);
		byFile.set(o.file, list);
	}
	/** @type {Array<{kind: 'not-allowlisted'|'over-max', file: string, count: number, max: number, samples: Array<{file: string, line: number, snippet: string}>}>} */
	const violations = [];
	for (const [file, list] of byFile) {
		const entry = findAllowlistEntry(file);
		if (!entry) {
			violations.push({
				kind: 'not-allowlisted',
				file,
				count: list.length,
				max: 0,
				samples: list.slice(0, 5),
			});
			continue;
		}
		if (list.length > entry.max) {
			violations.push({
				kind: 'over-max',
				file,
				count: list.length,
				max: entry.max,
				samples: list.slice(0, 5),
			});
		}
	}
	return violations;
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules') continue;
			walk(full, out);
		} else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			out.push(full);
		}
	}
	return out;
}

/**
 * REPO_ROOT 配下の SEARCH_ROOTS を走査し全 occurrence を返す
 * @param {string} [repoRoot]
 * @returns {Array<{file: string, line: number, snippet: string}>}
 */
export function findAllOccurrences(repoRoot = REPO_ROOT) {
	/** @type {Array<{file: string, line: number, snippet: string}>} */
	const occurrences = [];
	for (const root of SEARCH_ROOTS) {
		for (const file of walk(path.join(repoRoot, root))) {
			const rel = path.relative(repoRoot, file);
			occurrences.push(...findOccurrencesInContent(rel, fs.readFileSync(file, 'utf8')));
		}
	}
	return occurrences;
}

function main() {
	const noReason = findAllowlistEntriesWithoutReason();
	if (noReason.length > 0) {
		console.error(
			`[check-local-tz-date-getters] ✗ allowlist に理由 (reason) の無い entry が ${noReason.length} 件あります:\n`,
		);
		for (const e of noReason) console.error(`  ${e.file}`);
		console.error(
			'\n  除外は必ず「なぜ TZ 非依存と言えるか」を reason に書いてください (#4015 / #3956)。',
		);
		process.exit(1);
	}

	const violations = evaluateOccurrences(findAllOccurrences());
	if (violations.length === 0) {
		console.log(
			`[check-local-tz-date-getters] OK — allowlist (${ALLOWLIST.length} file、全件 reason 付き) 外のローカル TZ 日付 getter なし`,
		);
		process.exit(0);
	}

	console.error(
		`[check-local-tz-date-getters] ✗ ローカル TZ 日付 getter の違反を ${violations.length} file で検出しました (#4015):\n`,
	);
	for (const v of violations) {
		const head =
			v.kind === 'not-allowlisted'
				? `${v.file}: ${v.count} 件 (allowlist 未登録)`
				: `${v.file}: ${v.count} 件 (allowlist 上限 ${v.max} 件を超過)`;
		console.error(`  ${head}`);
		for (const s of v.samples) console.error(`    L${s.line}: ${s.snippet}`);
	}
	console.error('\n修正方針:');
	console.error(
		'  - 実時刻 (new Date() / DB timestamp) から暦要素を取り出しているなら **欠陥** です。',
	);
	console.error(
		'    $lib/domain/date-utils.ts の JST SSOT (todayDateJST / toJSTDateString / weekStartJST /',
	);
	console.error(
		'    weekEndJST / addDaysJST / jstDayOfWeek / jstYearMonth / monthKeyJST / shiftMonthKey /',
	);
	console.error('    monthStartJST / monthEndJST / isInJstMonth) に置換してください。');
	console.error(
		'  - TZ 非依存と言い切れる場合のみ、本 script の ALLOWLIST に file / max / reason を追加します。',
	);
	console.error(
		'    reason には「なぜ TZ 非依存か」を必ず書いてください (空だと本 gate が落ちます)。',
	);
	process.exit(1);
}

if (isMainModule(import.meta.url)) {
	main();
}
