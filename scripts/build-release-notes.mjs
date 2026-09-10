#!/usr/bin/env node
/**
 * scripts/build-release-notes.mjs (#4883)
 *
 * リリース時に Discord 📢 アップデート情報 へ投稿する「顧客向けお知らせ本文」を組み立てる。
 *
 * ## なぜ独立した script なのか
 *
 * 旧実装は `.github/workflows/deploy.yml` の bash に埋まっており、テストが 1 件も無かった。
 * その結果、以下 4 つの欠陥が誰にも気付かれないまま顧客へ配信され続けた（Issue #4883）:
 *
 *   1. `sed 's/^fix: /修正: /'` が scope 付き (`fix(auth):`) にマッチせず、10 件中 1 件しか拾えない
 *   2. `actions/checkout` が tag を fetch せず差分範囲が常に「直近 10 コミット」に落ちる
 *   3. `sed 's/#[0-9]\+//g'` が `(#4559)` を `()` にする
 *   4. AI が「顧客に伝えることは無い (SKIP)」と判断した場合まで fallback が発火し、
 *      生のコミット件名で上書きする（fail-open）
 *
 * ## 設計原則
 *
 * **顧客向け文面の出典はコミット件名ではなく PR body である。**
 * `## 顧客価値・目的` は PR の必須セクション（.github/PR_TEMPLATE_SECTIONS.json）であり、
 * 変更を最もよく理解している人間が顧客向けの言葉で書いた文が既に存在する。これを一次ソースにする。
 *
 * **fail-closed。** 顧客向けと確定できない項目は落とす。0 件なら投稿しない。
 * 「機械的に判定できないから生テキストを出す」は、顧客に意味不明な通知を届ける方向の degrade であり
 * 採らない。判定の誤りは「載らない」側に倒れる（安全側）ため、denylist の網羅性に依存しない。
 *
 * ## 使用法
 *
 *   node scripts/build-release-notes.mjs \
 *     --commits-file <commits.txt> --prs-file <prs.jsonl> \
 *     [--result <result.json>] [--discord-payload <payload.json>]
 *
 *   commits.txt: `git log --format=%s --no-merges` の出力（1 行 1 コミット件名）
 *   prs.jsonl:   1 行 1 PR の JSON（`{ number, body, labels }`）
 *   stdout:      `post` または `skip` のみ（呼び出し側が判定に使う）
 *   stderr:      `::warning::` / `::notice::` 形式の説明
 *
 *   `--discord-payload` は status が post のときだけ書き出す。skip のとき呼び出し側は
 *   Discord へ投稿しない（生テキストへ degrade しない）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain as isMainModule } from './lib/is-main.mjs';
import { parseSimpleBlock } from './lib/parse-labels-ts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const LABELS_TS = path.join(REPO_ROOT, 'src/lib/domain/labels.ts');

// ============================================================
// 定数
// ============================================================

/** 顧客に見える変化を伴う Conventional Commits type → 表示区分 */
const CUSTOMER_VISIBLE_TYPES = /** @type {const} */ ({
	feat: 'feature',
	perf: 'feature',
	fix: 'fix',
});

/** 通知に載せる項目数の上限（Discord embed の可読性 + ADR-0012 anti-engagement） */
const MAX_ITEMS = 8;

/** 1 項目の上限文字数。これを超える文は「見出し」として成立していない */
const MAX_ITEM_LENGTH = 140;

/**
 * 顧客向け通知で許可する英字語。
 *
 * 顧客向け日本語文に英字語が出るのは、ほぼ必ず開発者語彙の持ち込みである
 * (`approve gate` / `childId` / `fail-closed` / `API` …)。よって
 * 「2 文字以上の英字の連なりは原則不可、明示した語だけ許可」という構造的な規則にする。
 * denylist と違い、新しい開発者語彙が増えても穴が開かない。
 */
const ALLOWED_ASCII_WORDS = new Set(['AI']);

/** 顧客向け文でないことが明らかな日本語の開発者語彙（英字を含まないため上の規則で拾えない） */
const DEVELOPER_JARGON = [
	'述語',
	'冪等',
	'リファクタリング',
	'リグレッション',
	'デグレ',
	'フォールバック',
	'マイグレーション',
	'スキーマ',
	'エンドポイント',
	'ロールバック',
	'テストケース',
	'カバレッジ',
	'開発チーム',
	'開発者向け',
];

/** 顧客向け通知の対象外であることを PR が明示するラベル */
const EXCLUDED_PR_LABELS = new Set(['refactor:internal-no-doc-impact']);

/** PR body 内の明示宣言。`none` で opt-out */
const DECLARATION_PATTERN = /<!--\s*release-note:\s*([\s\S]*?)\s*-->/i;

const CUSTOMER_VALUE_HEADING = '## 顧客価値・目的';

// ============================================================
// labels.ts SSOT
// ============================================================

/** @type {Record<string, string> | null} */
let cachedLabels = null;

/**
 * 通知の固定文言を labels.ts（SSOT、docs/DESIGN.md §6）から読む。
 *
 * @returns {{ release: Record<string, string>, app: Record<string, string> }}
 */
export function loadLabels() {
	if (cachedLabels === null) {
		const src = fs.readFileSync(LABELS_TS, 'utf8');
		cachedLabels = {
			...prefixKeys(parseSimpleBlock(src, 'RELEASE_NOTES_LABELS'), 'release.'),
			...prefixKeys(parseSimpleBlock(src, 'APP_LABELS'), 'app.'),
		};
	}
	const flat = cachedLabels;
	return {
		release: unprefixKeys(flat, 'release.'),
		app: unprefixKeys(flat, 'app.'),
	};
}

/**
 * @param {Record<string, string>} obj
 * @param {string} prefix
 * @returns {Record<string, string>}
 */
function prefixKeys(obj, prefix) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const [k, v] of Object.entries(obj)) out[`${prefix}${k}`] = v;
	return out;
}

/**
 * @param {Record<string, string>} obj
 * @param {string} prefix
 * @returns {Record<string, string>}
 */
function unprefixKeys(obj, prefix) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
	}
	return out;
}

// ============================================================
// コミット件名の解釈
// ============================================================

/**
 * @typedef {object} ParsedCommit
 * @property {string} type Conventional Commits の type（`fix` / `feat` …）
 * @property {string | undefined} scope
 * @property {number | undefined} prNumber 末尾 `(#NNNN)` から取れた PR 番号
 * @property {string} subject 元の件名
 */

/**
 * コミット件名を Conventional Commits として解釈する。
 *
 * 旧実装は `^fix: ` のような素の prefix しか見ておらず、`fix(auth):` を取りこぼしていた
 * （#4883 RC1）。本関数は scope と breaking marker (`!`) を明示的に扱う。
 *
 * 解釈できない件名は **null**（= 顧客向け通知の対象外）。推測しない。
 *
 * @param {string} subject
 * @returns {ParsedCommit | null}
 */
export function parseCommitSubject(subject) {
	if (typeof subject !== 'string') return null;
	const trimmed = subject.trim();
	const m = trimmed.match(/^([a-z]+)(?:\(([^)]*)\))?!?:\s+(.+)$/);
	if (!m || m[1] === undefined) return null;
	const prMatch = trimmed.match(/\(#(\d+)\)\s*$/);
	return {
		type: m[1],
		scope: m[2] === undefined || m[2] === '' ? undefined : m[2],
		prNumber: prMatch?.[1] === undefined ? undefined : Number(prMatch[1]),
		subject: trimmed,
	};
}

/**
 * Conventional Commits type を顧客向け表示区分へ落とす。
 *
 * 対象外の型（docs / test / chore / ci / build / refactor / style / 未知）は null。
 * scope の有無に依存しないため、`chore(audit):` も確実に除外される（#4883 RC1）。
 *
 * @param {string} type
 * @returns {'feature' | 'fix' | null}
 */
export function classifyCommitType(type) {
	return (
		/** @type {Record<string, 'feature' | 'fix' | undefined>} */ (CUSTOMER_VISIBLE_TYPES)[type] ??
		null
	);
}

// ============================================================
// 本文の整形・判定
// ============================================================

/**
 * 顧客向け本文として出す前の整形。
 *
 * チケット参照を消したあとに空カッコ・二重空白を残さない（#4883 RC3）。
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeNoteText(text) {
	if (typeof text !== 'string') return '';
	let out = text;
	out = out.replace(/<!--[\s\S]*?-->/g, ' '); // HTML コメント
	out = out.replace(/#\d+/g, ''); // チケット / PR 参照
	out = out.replace(/[([（【]\s*[)\]）】]/g, ''); // 参照を消して空になったカッコ
	out = out.replace(/\s+/g, ' '); // 連続空白（除去後の二重空白を含む）
	out = out.replace(/\s+([、。」）】])/g, '$1'); // 句読点直前の空白
	return out.trim();
}

/**
 * 顧客向け文として成立しない理由を返す（成立していれば null）。
 *
 * fail-closed。判定に迷うものは「載せない」側へ倒す。載らなかった PR は warning に
 * 列挙され、Dev は `<!-- release-note: ... -->` で明示宣言すればそのまま載せられる。
 *
 * @param {string} text
 * @returns {string | null}
 */
export function findCustomerUnsafeReason(text) {
	if (text === '') return '本文が空';
	if (text.length > MAX_ITEM_LENGTH) return `長すぎる (${text.length} 文字 > ${MAX_ITEM_LENGTH})`;
	if (text.includes('`')) return 'コード片 (バッククォート) を含む';
	if (/[/\\][A-Za-z0-9_.-]+/.test(text)) return 'パスらしき文字列を含む';

	for (const word of text.match(/[A-Za-z][A-Za-z0-9_-]+/g) ?? []) {
		if (!ALLOWED_ASCII_WORDS.has(word)) return `英字語を含む: ${word}`;
	}
	for (const jargon of DEVELOPER_JARGON) {
		if (text.includes(jargon)) return `開発者語彙を含む: ${jargon}`;
	}
	return null;
}

/**
 * PR body から `## 顧客価値・目的` の第 1 文を取り出す。
 *
 * セクションが無い / 説明コメントだけ の場合は null を返す。**コミット件名へは落ちない。**
 *
 * @param {string} body
 * @returns {string | null}
 */
export function extractCustomerValueSentence(body) {
	if (typeof body !== 'string') return null;
	const start = body.indexOf(CUSTOMER_VALUE_HEADING);
	if (start === -1) return null;

	const afterHeading = body.slice(start + CUSTOMER_VALUE_HEADING.length);
	const nextHeading = afterHeading.search(/^##\s/m);
	const section = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);

	const cleaned = section.replace(/<!--[\s\S]*?-->/g, '').trim();
	if (cleaned === '') return null;

	const firstLine = cleaned.split('\n').find((l) => l.trim() !== '');
	if (firstLine === undefined) return null;

	const period = firstLine.indexOf('。');
	const sentence = period === -1 ? firstLine.trim() : firstLine.slice(0, period + 1).trim();
	return sentence === '' ? null : sentence;
}

/**
 * @typedef {object} ResolvedNote
 * @property {'included' | 'rejected' | 'opted-out'} status
 * @property {string} [text]
 * @property {'declaration' | 'customer-value'} [source]
 * @property {string} [reason]
 */

/**
 * 1 つの PR body から顧客向け 1 行を決める。
 *
 * 優先順:
 *   1. `<!-- release-note: none -->` → 明示 opt-out（静かに除外）
 *   2. `<!-- release-note: 本文 -->` → 著者が顧客向けと宣言した文（そのまま採用）
 *   3. `## 顧客価値・目的` 第 1 文 → 整形したうえで顧客向け判定を通す
 *   4. いずれも無い / 判定に落ちた → rejected（**コミット件名で代替しない**）
 *
 * @param {string} body
 * @returns {ResolvedNote}
 */
export function resolveReleaseNote(body) {
	const declaration = typeof body === 'string' ? body.match(DECLARATION_PATTERN) : null;
	if (declaration?.[1] !== undefined) {
		const declared = declaration[1].trim();
		if (/^(none|なし|no|skip)$/i.test(declared)) {
			return { status: 'opted-out' };
		}
		const text = sanitizeNoteText(declared);
		if (text === '') return { status: 'rejected', reason: '明示宣言が空' };
		if (text.length > MAX_ITEM_LENGTH) {
			return { status: 'rejected', reason: `明示宣言が長すぎる (${text.length} 文字)` };
		}
		return { status: 'included', text, source: 'declaration' };
	}

	const sentence = extractCustomerValueSentence(body);
	if (sentence === null) {
		return { status: 'rejected', reason: `${CUSTOMER_VALUE_HEADING} が無い / 空` };
	}

	const text = sanitizeNoteText(sentence);
	const unsafe = findCustomerUnsafeReason(text);
	if (unsafe !== null) return { status: 'rejected', reason: unsafe };

	return { status: 'included', text, source: 'customer-value' };
}

// ============================================================
// 組み立て
// ============================================================

/**
 * @typedef {object} PullRequestInput
 * @property {number} number
 * @property {string} body
 * @property {string[]} [labels]
 */

/**
 * @typedef {object} ReleaseNoteItem
 * @property {'feature' | 'fix'} category
 * @property {string} text
 * @property {number} prNumber
 * @property {'declaration' | 'customer-value'} source
 */

/**
 * @typedef {object} ReleaseNotesResult
 * @property {'post' | 'skip'} status
 * @property {string} title
 * @property {string} description
 * @property {string} footer
 * @property {ReleaseNoteItem[]} items
 * @property {string[]} warnings
 */

/**
 * コミット一覧 + PR body 一覧から Discord 投稿本文を組み立てる。
 *
 * @param {{ commits: string[], pullRequests: PullRequestInput[], today?: Date }} input
 * @returns {ReleaseNotesResult}
 */
export function buildReleaseNotes(input) {
	const { release, app } = loadLabels();
	const commits = Array.isArray(input?.commits) ? input.commits : [];
	const pullRequests = Array.isArray(input?.pullRequests) ? input.pullRequests : [];

	/** @type {Map<number, PullRequestInput>} */
	const prByNumber = new Map();
	for (const pr of pullRequests) {
		if (typeof pr?.number === 'number') prByNumber.set(pr.number, pr);
	}

	/** @type {ReleaseNoteItem[]} */
	const items = [];
	/** @type {string[]} */
	const warnings = [];
	/** @type {Set<number>} */
	const seenPrs = new Set();

	for (const subject of commits) {
		const parsed = parseCommitSubject(subject);
		if (parsed === null) continue;

		const category = classifyCommitType(parsed.type);
		if (category === null) continue;

		if (parsed.prNumber === undefined) {
			warnings.push(`PR 番号を特定できないコミットを除外しました: ${parsed.subject}`);
			continue;
		}
		if (seenPrs.has(parsed.prNumber)) continue;
		seenPrs.add(parsed.prNumber);

		const pr = prByNumber.get(parsed.prNumber);
		if (pr === undefined) {
			warnings.push(
				`PR #${parsed.prNumber} の本文を取得できなかったため除外しました（コミット件名では代替しません）`,
			);
			continue;
		}
		if ((pr.labels ?? []).some((l) => EXCLUDED_PR_LABELS.has(l))) continue;

		const note = resolveReleaseNote(pr.body ?? '');
		if (note.status === 'opted-out') continue;
		if (note.status === 'rejected') {
			warnings.push(
				`PR #${parsed.prNumber} を除外しました（${note.reason}）。` +
					'顧客へ伝えたい変更なら PR body に <!-- release-note: 顧客向けの 1 文 --> を書いてください',
			);
			continue;
		}
		if (note.text === undefined || note.source === undefined) continue;

		items.push({ category, text: note.text, prNumber: parsed.prNumber, source: note.source });
	}

	const selected = items.slice(0, MAX_ITEMS);
	const title = release.title ?? '';
	const footer = app.name ?? '';

	if (selected.length === 0) {
		// fail-closed: 顧客向けと確定できる項目が 1 件も無いなら投稿しない。
		return { status: 'skip', title, description: '', footer, items: [], warnings };
	}

	const bullet = release.bullet ?? '• ';
	/** @type {string[]} */
	const blocks = [];
	for (const [category, heading] of /** @type {const} */ ([
		['feature', release.sectionFeature],
		['fix', release.sectionFix],
	])) {
		const lines = selected.filter((i) => i.category === category).map((i) => `${bullet}${i.text}`);
		if (lines.length > 0) blocks.push(`${heading}\n${lines.join('\n')}`);
	}
	blocks.push(release.feedbackGuide ?? '');

	return {
		status: 'post',
		title,
		description: blocks.filter((b) => b !== '').join('\n\n'),
		footer,
		items: selected,
		warnings,
	};
}

/**
 * 日本時間の「YYYY年M月D日」を返す。
 *
 * ランナーの locale / TZ に依存させない（`Asia/Tokyo` を明示、#4015 / #4127 の JST SSOT 原則）。
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function formatJstDate(now = new Date()) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
	}).formatToParts(now);
	// 環境によって 2 桁ゼロ埋めになるため、表示上は前ゼロを落とす（旧実装の `%-m` / `%-d` 相当）
	const get = (/** @type {string} */ type) =>
		String(Number(parts.find((p) => p.type === type)?.value ?? '0'));
	return `${get('year')}年${get('month')}月${get('day')}日`;
}

/**
 * Discord webhook へ渡す embed payload を組み立てる。
 *
 * @param {ReleaseNotesResult} result
 * @param {Date} [now]
 * @returns {object}
 */
export function buildDiscordPayload(result, now = new Date()) {
	return {
		embeds: [
			{
				title: result.title,
				description: result.description,
				color: 5763719,
				footer: { text: `${result.footer} • ${formatJstDate(now)}` },
			},
		],
	};
}

// ============================================================
// CLI
// ============================================================

/**
 * JSON Lines を読む。壊れた行は握りつぶさず警告してから捨てる。
 *
 * @param {string} filePath
 * @returns {PullRequestInput[]}
 */
function readJsonLines(filePath) {
	if (filePath === undefined || !fs.existsSync(filePath)) return [];
	/** @type {PullRequestInput[]} */
	const out = [];
	for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
		if (line.trim() === '') continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			console.error(`::warning::PR の JSON 行を解釈できませんでした: ${line.slice(0, 120)}`);
		}
	}
	return out;
}

function main() {
	const args = process.argv.slice(2);
	const commitsFile = valueOf(args, '--commits-file');
	const prsFile = valueOf(args, '--prs-file');
	const resultPath = valueOf(args, '--result');
	const discordPayloadPath = valueOf(args, '--discord-payload');

	if (commitsFile === undefined) {
		console.error(
			'usage: node scripts/build-release-notes.mjs --commits-file <commits.txt> --prs-file <prs.jsonl> [--result <result.json>] [--discord-payload <payload.json>]',
		);
		process.exit(2);
	}

	const commits = fs
		.readFileSync(commitsFile, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l !== '');

	const result = buildReleaseNotes({ commits, pullRequests: readJsonLines(prsFile) });

	for (const warning of result.warnings) console.error(`::warning::${warning}`);
	console.error(
		result.status === 'post'
			? `::notice::リリース通知 ${result.items.length} 項目を組み立てました`
			: '::notice::顧客向けと確定できる項目が 0 件のため、リリース通知は投稿しません',
	);

	if (resultPath !== undefined) {
		fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
	}
	if (discordPayloadPath !== undefined && result.status === 'post') {
		fs.writeFileSync(
			discordPayloadPath,
			JSON.stringify(buildDiscordPayload(result), null, 2),
			'utf8',
		);
	}

	// 呼び出し側 (workflow) は stdout の 1 語だけを見る
	console.log(result.status);
}

/**
 * @param {string[]} args
 * @param {string} name
 * @returns {string | undefined}
 */
function valueOf(args, name) {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
}

if (isMainModule(import.meta.url)) main();
