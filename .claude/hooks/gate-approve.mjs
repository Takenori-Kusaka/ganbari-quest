#!/usr/bin/env node

/**
 * .claude/hooks/gate-approve.mjs (ADR-0056)
 *
 * Claude Code `PreToolUse` hook で呼出される検査スクリプト。
 *
 * 機能:
 *   stdin から Claude Code が渡す tool_input JSON を読み取り、command 文字列が
 *   `gh pr (merge|review --approve)` を含むとき、`tmp/adversarial-evidence/<pr-number>.json`
 *   の存在 + TTL (30 分) + schema 必須 field 充足を検証する。検証 fail なら exit 2 で
 *   approve action を物理 block する。
 *
 * 対象経路 (#4001 / #4082 R1):
 *   Bash だけでなく **任意の副作用を起こしうるツール全経路** (SSOT: ./command-execution-tools.mjs)。
 *   matcher が `"Bash"` だけだった間、PowerShell ツールで同じコマンドを叩けば gate が
 *   起動せず素通しできた (gate bypass)。判定軸は「shell か」ではなく「任意の副作用を
 *   起こせるか」であり、汎用コード実行 MCP も対象に含む。判別できない入力は allow ではなく block。
 *
 * 検出の原則 (#4057):
 *   approve 行為の識別は **PR 番号の書き方に依存させない**。`pulls/<ref>/{reviews,merge}` は
 *   ref がリテラルでも変数展開 (`$n`) でもコマンド置換でも approve として捕捉し、番号を
 *   確定できない場合は block する (「番号が取れない = 検証不能 = 通さない」)。
 *
 * 設計根拠 (Research SSOT §5.1 / §5.2):
 *   - arXiv:2511.09710 で structured response schema 強制が echoing 30-40% → <10% を実証
 *   - Sleeper Agents (Hubinger 2024): instruction 経由の役割強化は drift trigger に対処できない
 *     → agent 内部自覚に依存せず Bash command を物理 block する hook が必要
 *
 * Recursive loop 防止 (#4082 R2 で範囲を絞った):
 *   `process.env.CLAUDE_SUBAGENT_ID` 存在時 (Adversarial Reviewer subagent context) は
 *   **読み取り専用の review 参照だけ** allow する。旧実装は無条件 allow だったため、この env が
 *   立った context ではどのツール経由でも approve が素通りした。loop 防止に必要なのは
 *   「evidence 生成のために review を読む」ことだけなので、mutation は subagent でも block する。
 *
 * 入力 (stdin, JSON):
 *   {
 *     "session_id": "...",
 *     "tool_name": "Bash",
 *     "tool_input": { "command": "gh pr merge 2588 --squash", ... }
 *   }
 *
 * 出力:
 *   - allow: exit 0 (stdout/stderr 何も出さない)
 *   - deny:  exit 2 + stderr に修正手順 ("Adversarial Reviewer subagent を先に dispatch")
 *
 * fail-closed (#3999):
 *   判定 SSOT (`scripts/lib/is-main.mjs`) の import 解決失敗・main() 内の想定外例外は、
 *   いずれも exit 2 (block) に倒す。Claude Code は exit 2 のみを block として扱うため、
 *   これらを既定の exit 1 のまま落とすと **tool 実行が継続し approve が素通しする**。
 *
 * 関連:
 *   - ADR-0056 (本 hook の設計根拠 SSOT)
 *   - docs/research/qm-drift-prevention-2026-05-28.md (research primary source)
 *   - .claude/skills/adversarial-reviewer/SKILL.md (subagent 仕様)
 *   - scripts/verify-adversarial-output.mjs (schema validation 本体、本 hook が import)
 *   - .claude/settings.json (PreToolUse 設定、本 hook を hooks[].hooks[] に追加)
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `scripts/lib/` の SSOT module を **dynamic import** で読み込む理由 (#3999 / #4027)。
 *
 * static import にすると解決失敗が module 評価前の `ERR_MODULE_NOT_FOUND` になり、Node は
 * **exit 1** で落ちる。Claude Code の PreToolUse hook は **exit 2 のみ**を block として扱い、
 * それ以外の非 0 は non-blocking error として tool 実行を継続する。つまり `scripts/` を含まない
 * checkout では **evidence 無しで approve / merge が通っていた** (fail-open)。
 *
 * security control は「判定不能」を「許可」ではなく **block** に倒す (fail-closed)。
 * dynamic import なら解決失敗を catch でき、exit 2 を自分で選べる。
 *
 * 対象は **相対 import の全部**: `../../scripts/lib/is-main.mjs` (実行主体判定) /
 * `../../scripts/lib/gh-command.mjs` (#4027 の gh コマンド解析 SSOT) /
 * `./command-execution-tools.mjs` (#4082 R1 の対象ツール SSOT)。
 *
 * **1 本だけ dynamic 化しても同 class の穴は残る** (#4075): #3999 が `is-main.mjs` を塞いだ後も
 * `command-execution-tools.mjs` は static import のままで、当該ファイルを含まない checkout では
 * `ERR_MODULE_NOT_FOUND` = exit 1 = 素通しに倒れていた。以後 sibling を 1 本足しただけで
 * 穴が復活しないよう、`tests/unit/hooks/gate-approve-fail-closed.test.ts` の fitness function が
 * **hook 本文に相対 module の static import が 0 件**であることを機械検証する。
 */
/** @type {((importMetaUrl: string, argv1?: string) => boolean) | undefined} */
let isMain;
/** @type {typeof import('../../scripts/lib/gh-command.mjs') | undefined} */
let gh;
/** @type {typeof import('./command-execution-tools.mjs') | undefined} */
let tools;
/**
 * 読み込めなかった module の一覧 (repo 相対パス + error)。
 * 1 本でも欠けたら fail-closed で exit 2 に倒す。どの module が欠けたかを stderr に出すため、
 * 「最初の 1 件」ではなく全件を保持する。
 * @type {{ path: string; err: unknown }[]}
 */
const moduleLoadFailures = [];
/** @type {unknown} import 解決に失敗したときの error (成功時は null) */
let isMainLoadError = null;
try {
	({ isMain } = await import('../../scripts/lib/is-main.mjs'));
} catch (err) {
	moduleLoadFailures.push({ path: 'scripts/lib/is-main.mjs', err });
}
try {
	gh = await import('../../scripts/lib/gh-command.mjs');
} catch (err) {
	moduleLoadFailures.push({ path: 'scripts/lib/gh-command.mjs', err });
}
try {
	tools = await import('./command-execution-tools.mjs');
} catch (err) {
	moduleLoadFailures.push({ path: '.claude/hooks/command-execution-tools.mjs', err });
}
if (moduleLoadFailures.length > 0) isMainLoadError = moduleLoadFailures[0].err;

/**
 * gh-command SSOT を取り出す。読み込めていなければ throw する (呼出元は main() 経由で
 * exit 2 に倒れる。判定材料が無いまま `false` を返して素通しさせない)。
 *
 * @returns {typeof import('../../scripts/lib/gh-command.mjs')}
 */
function ghLib() {
	if (!gh) {
		throw isMainLoadError instanceof Error
			? isMainLoadError
			: new Error('scripts/lib/gh-command.mjs を読み込めません');
	}
	return gh;
}

/**
 * 対象ツール SSOT を取り出す。読み込めていなければ throw する (#4075)。
 *
 * `?? []` のような既定値で代用すると「どのツールが shell か分からないまま検査を続ける」ことに
 * なり、`tool_input.command` を読めないまま allow に倒れうる。判定材料が無いなら止める。
 *
 * @returns {typeof import('./command-execution-tools.mjs')}
 */
function toolsLib() {
	if (!tools) {
		throw isMainLoadError instanceof Error
			? isMainLoadError
			: new Error('.claude/hooks/command-execution-tools.mjs を読み込めません');
	}
	return tools;
}

/**
 * `scripts/lib/gh-command.mjs` の同名関数への薄い委譲 (既存呼出し互換の re-export)。
 *
 * dynamic import 化 (上記) により `export { normalizeCommand }` の static 再 export が
 * 使えないため wrapper で公開する。
 *
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
	return ghLib().normalizeCommand(command);
}

export const EVIDENCE_TTL_MS = 30 * 60 * 1000; // 30 分 (ADR-0056 §決定 1)
export const REQUIRED_OBJECT_COUNT = 3; // must_object_count 強制値 (Echoing 抑制)
export const REQUIRED_AXES = new Set(['business', 'UX', 'security']);
export const MIN_REASON_LENGTH = 100;

/**
 * stdin (Claude Code が渡す JSON) を全部読み取る。
 */
async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/**
 * Bash command 文字列が `gh pr merge` または `gh pr review --approve` を含むか判定。
 *
 * 検出範囲:
 *   - `gh pr merge` (任意の subargs)
 *   - `gh pr review --approve` (任意の subargs)
 *   - `gh api repos/.../pulls/<N>/merge` (REST 直叩き、PR merge 相当)
 *   - `gh api repos/.../pulls/<N>/reviews` POST (REST 直叩き、approve review 相当)
 *
 * 判定材料は **サブコマンドと API パス**に限る (#4027)。引数の値 (`--body` / `--body-file` /
 * heredoc) は見ない — hook 自身を説明する文書に approve コマンド例を書くだけで止まる誤検知を防ぐ。
 * そのうえで検出幅は従来どおり (method を問わない / 引用符や別 shell 経由でも捕捉する):
 * 過剰 block コスト < drift identification trap が穴になるコスト。
 *
 * @param {unknown} command  Bash tool_input.command 文字列
 * @returns {boolean}        対象操作なら true
 */
export function isApproveAction(command) {
	if (typeof command !== 'string') return false;
	// #4027: `--body` / `--body-file` / heredoc の中身は判定材料にしない。
	// hook 自身を説明する Issue / PR 本文に approve コマンド例を書くだけで BLOCK される事故の再発防止。
	const lib = ghLib();
	const sanitized = lib.sanitizeForDetection(command);
	// gh pr merge
	if (/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(sanitized)) return true;
	// gh pr review --approve
	if (/\bgh(?:\.exe)?\s+pr\s+review\b[^\n]*--approve\b/.test(sanitized)) return true;
	// gh api .../pulls/<ref>/{merge,reviews} (REST 直叩き)。
	// #4027: 部分一致でなく **引数として渡された API パス** で判定する。method は問わない
	// (approve 相当を method 表記で回避されないよう検出幅は従来どおり維持する)。
	// #4057: `<ref>` は数字リテラルに限定しない。番号の書き方 (`4002` / `$n` / `$(…)`) で
	// gate の有無が変わってはならない。番号が確定できるかどうかは別工程で扱う。
	return findApprovePathHits(sanitized).length > 0;
}

/**
 * approve 相当の API パスを列挙する (#4057)。
 *
 * 2 種類を拾う:
 *   - `repos/o/r/pulls/<ref>/{reviews,merge}` … ref の形 (数字 / 変数 / 置換) を問わない
 *   - **確定できない pulls 配下パス** … `$(…)` / `$VAR` / backtick 等で実際に叩かれる URL が
 *     決まらないもの。分類不能を「approve ではない」に潰すと、書き方を変えるだけで抜けられる
 *
 * コレクション (`repos/o/r/pulls`) は対象外 (PR 作成 = ADR-0022 L1 の責務)。
 *
 * @param {string} sanitized  sanitizeForDetection 済み文字列
 * @returns {{ path: string; method: string; indeterminate: boolean }[]}
 */
function findApprovePathHits(sanitized) {
	const lib = ghLib();
	/** @type {{ path: string; method: string; indeterminate: boolean }[]} */
	const hits = [];
	for (const { argv } of lib.findGhInvocations(sanitized)) {
		const api = lib.parseGhApiInvocation(argv);
		if (!api.isApi) continue;
		for (const path of api.paths) {
			const isSubresource =
				lib.isPullsSubresourcePathAnyRef(path, 'merge') ||
				lib.isPullsSubresourcePathAnyRef(path, 'reviews');
			const indeterminate = lib.isPullsScopedPath(path) && lib.hasUnresolvedExpansion(path);
			if (isSubresource || indeterminate) {
				hits.push({ path, method: api.method, indeterminate });
			}
		}
	}
	return hits;
}

/**
 * subagent context で許してよい **読み取り専用**の approve パス参照か (#4082 R2)。
 *
 * Adversarial Reviewer subagent は evidence 生成のために「既存 review の一覧」を読む。これは
 * `pulls/<n>/reviews` を叩くため本 gate の検出網 (method 非依存) に掛かるが、**副作用は無い**。
 * 旧実装はこれを通すために `CLAUDE_SUBAGENT_ID` が立っていれば**どのコマンドでも無条件 allow**
 * にしていた (= どのツール経由でも素通り、#4082 R2)。loop 防止に必要なのは「読む」ことだけなので、
 * 許可をそこまで絞る。
 *
 * 以下はいずれも false (= subagent でも evidence gate に掛ける):
 *   - `gh pr merge` / `gh pr review --approve` (CLI の変更操作)
 *   - method が GET でない `gh api` (POST / PUT / PATCH / DELETE、method 不明も POST 扱い)
 *   - パスが確定できない形 (分類不能を allow に倒さない)
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isReadOnlyApproveInspection(command) {
	if (typeof command !== 'string') return false;
	const lib = ghLib();
	const sanitized = lib.sanitizeForDetection(command);
	if (/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(sanitized)) return false;
	if (/\bgh(?:\.exe)?\s+pr\s+review\b[^\n]*--approve\b/.test(sanitized)) return false;
	const hits = findApprovePathHits(sanitized);
	if (hits.length === 0) return false;
	return hits.every((hit) => !hit.indeterminate && hit.method === 'GET');
}

/**
 * hook payload から「検査すべきコマンド文字列」を取り出す (#4001)。
 *
 * fail-closed 方針: **抽出できない = approve ではない、とは扱わない**。
 *   - tool_name が無い / 文字列でない → BLOCK (どの経路か判別できない)
 *   - shell ツール (SHELL_COMMAND_TOOLS) なのに `tool_input.command` が文字列でない
 *     → BLOCK (検査対象を読めない = 素通しさせない)
 *   - コード実行ツール (CODE_EXECUTION_TOOLS) / SSOT に無いツール名 → allow に倒さず、
 *     tool_input 内の全文字列 (+ 連結形) を走査する。payload の key 名 (`code` / `script` / …)
 *     はツールごとに違うため、key を決め打ちせず値の型で拾う (#4082 R1)
 *   - 走査できる文字列が **1 つも無い** → BLOCK (検査していないのに通した、を作らない)
 *
 * @param {unknown} payload
 * @returns {{ ok: true; commands: string[] } | { ok: false; reason: string }}
 */
export function resolveInspectableCommands(payload) {
	const toolName = /** @type {{ tool_name?: unknown }} */ (payload ?? {}).tool_name;
	const toolInput = /** @type {{ tool_input?: unknown }} */ (payload ?? {}).tool_input;
	if (typeof toolName !== 'string' || toolName.trim() === '') {
		return {
			ok: false,
			reason: 'payload に tool_name がありません (どの実行経路か判別できないため block)',
		};
	}
	if (toolsLib().SHELL_COMMAND_TOOLS.includes(toolName)) {
		const command = /** @type {{ command?: unknown }} */ (toolInput ?? {}).command;
		if (typeof command !== 'string') {
			return {
				ok: false,
				reason: `${toolName} の tool_input.command が文字列ではありません (検査できないため block)`,
			};
		}
		return { ok: true, commands: [command] };
	}
	const strings = collectStrings(toolInput);
	if (strings.length === 0) {
		return {
			ok: false,
			reason: `${toolName} の tool_input に検査できる文字列がありません (検査せずに通さない)`,
		};
	}
	// 引数配列 (["gh","pr","merge","4001"]) 形式にも当たるよう連結形も候補に入れる
	const candidates = strings.length > 1 ? [...strings, strings.join(' ')] : [...strings];
	// コード実行 payload は shell 文字列ではなく**プログラム言語の構文**なので、コマンドが
	// `subprocess.run(["gh","pr","merge","4082"])` のように区切り文字で分断されて現れる (#4082 R1)。
	// 区切り文字を空白に均した変種も候補に足し、言語構文に埋まった形でも掴めるようにする。
	for (const s of [...candidates]) {
		const flattened = flattenCodePunctuation(s);
		if (flattened !== s) candidates.push(flattened);
	}
	return { ok: true, commands: candidates };
}

/**
 * コード片に含まれる区切り文字を空白に均す (#4082 R1、shell 以外の payload 専用)。
 *
 * **限界**: 任意言語の構文を完全に解釈することはできない (変数経由の組み立て・base64・
 * 動的 eval は原理的に検出できない)。ここで塞げるのは「コマンドがリテラルとして書かれている」
 * 場合だけである。残余は ADR-0056 の残存 bypass として記録し、事後監査
 * (`scripts/audit-approve-evidence.mjs`) が経路非依存の検知層を担う。
 *
 * @param {string} code
 * @returns {string}
 */
function flattenCodePunctuation(code) {
	return code.replace(/["'`[\](),]/g, ' ').replace(/[ \t]+/g, ' ');
}

/**
 * 任意 JSON 値から string を再帰収集する (#4001、未知ツールの走査用)。
 *
 * @param {unknown} value
 * @param {number} depth
 * @returns {string[]}
 */
export function collectStrings(value, depth = 0) {
	if (depth > 6) return [];
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap((v) => collectStrings(v, depth + 1));
	if (value && typeof value === 'object') {
		return Object.values(value).flatMap((v) => collectStrings(v, depth + 1));
	}
	return [];
}

/**
 * Bash command から PR 番号を抽出する。
 *
 * 抽出パターン:
 *   - `gh pr merge 2588 ...` / `gh pr merge --repo X 2588`
 *   - `gh pr review 2588 --approve`
 *   - `gh api repos/.../pulls/2588/merge`
 *
 * 見つからない場合は null を返す (hook 側は deny する)。
 *
 * @param {string} command
 * @returns {number|null}
 */
export function extractPrNumber(command) {
	return extractPrNumbers(command).at(0) ?? null;
}

/**
 * command が approve 対象にしている PR 番号を **全て** 返す (#4057)。
 *
 * 1 コマンドで複数 PR を叩く形 (`gh pr merge 4002 && gh pr merge 4010` / ループ) があるため、
 * 「最初の 1 件」だけ検証すると 1 件分の evidence で複数 PR が通る。呼出側は返った番号
 * **全件**について evidence を検証し、approve 行為なのに 1 件も取れなければ block する。
 *
 * 番号を「推測」しないことが本関数の役割である。`for n in 4002 4010; do … /pulls/$n/reviews`
 * の `4002` はループの列挙値であって、そのコマンドが叩く PR とは限らない。近くにある数字を
 * 拾うと、evidence のある PR の番号で別 PR の approve が通ってしまう。
 *
 * @param {string} command
 * @returns {number[]}  昇順・重複排除
 */
export function extractPrNumbers(command) {
	if (typeof command !== 'string') return [];
	// #4001: PowerShell 表記ゆれ (& 'gh' / gh.exe / backtick 継続) を吸収してから抽出する
	// #4027: あわせて --body / heredoc の中身を除去し、body 内の PR 番号を拾わないようにする
	const normalized = ghLib().sanitizeForDetection(command);
	/** @type {Set<number>} */
	const numbers = new Set();
	// gh pr <merge|review> [args] <N>
	for (const m of normalized.matchAll(
		/\bgh(?:\.exe)?\s+pr\s+(?:merge|review)\b[^\n]*?\b(\d{1,6})\b/g,
	)) {
		numbers.add(Number(m[1]));
	}
	// gh api .../pulls/<N>/...
	for (const m of normalized.matchAll(/\/pulls\/(\d{1,6})\b/g)) {
		numbers.add(Number(m[1]));
	}
	return [...numbers].sort((a, b) => a - b);
}

/**
 * Adversarial evidence file (`tmp/adversarial-evidence/<pr>.json`) を検証する。
 *
 * 検証項目 (ADR-0056 §決定 3):
 *   1. file 存在
 *   2. mtime が EVIDENCE_TTL_MS 以内
 *   3. JSON parse 成功
 *   4. pr_number (number) が一致
 *   5. must_object_count === 3 (literal)
 *   6. objections.length === 3
 *   7. axis ∈ {business, UX, security} の Set 網羅
 *   8. 各 reason.length >= MIN_REASON_LENGTH
 *
 * @param {number} prNumber
 * @param {string} cwd  作業 dir (test では override 可)
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyEvidence(prNumber, cwd = process.cwd()) {
	const path = resolve(cwd, 'tmp', 'adversarial-evidence', `${prNumber}.json`);
	if (!existsSync(path)) {
		return { ok: false, reason: `evidence file 不在: ${path}` };
	}
	const stat = statSync(path);
	const ageMs = Date.now() - stat.mtimeMs;
	if (ageMs > EVIDENCE_TTL_MS) {
		const ageMin = Math.floor(ageMs / 60000);
		return { ok: false, reason: `evidence file TTL 切れ (${ageMin} 分前、上限 30 分)` };
	}

	let data;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `evidence file JSON parse fail: ${msg}` };
	}

	if (typeof data.pr_number !== 'number' || data.pr_number !== prNumber) {
		return { ok: false, reason: `pr_number mismatch (expected ${prNumber}, got ${data.pr_number})` };
	}
	if (data.must_object_count !== REQUIRED_OBJECT_COUNT) {
		return {
			ok: false,
			reason: `must_object_count !== ${REQUIRED_OBJECT_COUNT} (got ${data.must_object_count})`,
		};
	}
	if (!Array.isArray(data.objections) || data.objections.length !== REQUIRED_OBJECT_COUNT) {
		return {
			ok: false,
			reason: `objections.length !== ${REQUIRED_OBJECT_COUNT} (got ${data.objections?.length})`,
		};
	}
	const axesSeen = new Set();
	for (const obj of data.objections) {
		if (!obj || typeof obj !== 'object') {
			return { ok: false, reason: `objection が object でない` };
		}
		if (!REQUIRED_AXES.has(obj.axis)) {
			return {
				ok: false,
				reason: `objection.axis '${obj.axis}' が業務 / UX / security に該当しない`,
			};
		}
		if (typeof obj.reason !== 'string' || obj.reason.length < MIN_REASON_LENGTH) {
			return {
				ok: false,
				reason: `objection.reason が ${MIN_REASON_LENGTH} 文字未満 (axis=${obj.axis}、got ${obj.reason?.length} 文字)`,
			};
		}
		axesSeen.add(obj.axis);
	}
	if (axesSeen.size !== REQUIRED_AXES.size) {
		return {
			ok: false,
			reason: `3 軸 (business / UX / security) 全て網羅されていない (got: ${[...axesSeen].join(', ')})`,
		};
	}
	return { ok: true };
}

async function main() {
	let payload;
	try {
		const raw = await readStdin();
		payload = raw.trim() ? JSON.parse(raw) : {};
	} catch {
		// #4001: 旧実装は parse 失敗を exit 0 (通過) にしていたが、これは
		// 「読めなかった」を「approve ではない」に潰す fail-open だった。読めない入力は block する。
		process.stderr.write(
			`[gate-approve] BLOCK: hook payload (stdin JSON) を parse できませんでした。\n`,
		);
		process.stderr.write(
			`  approve 系コマンドか判別できないため、pass 側に倒さず block します (ADR-0056 / #4001)。\n`,
		);
		process.exit(2);
	}

	const resolved = resolveInspectableCommands(payload);
	if (!resolved.ok) {
		process.stderr.write(`[gate-approve] BLOCK: ${resolved.reason}\n`);
		process.stderr.write(
			`  対処: コマンド実行経路のツールを追加した場合は .claude/hooks/command-execution-tools.mjs の\n`,
		);
		process.stderr.write(
			`        COMMAND_EXECUTION_TOOLS と .claude/settings.json の matcher を同時に更新してください (#4001)。\n`,
		);
		process.exit(2);
	}

	const approveCommands = resolved.commands.filter((c) => isApproveAction(c));
	if (approveCommands.length === 0) {
		// approve 系コマンドでなければ対象外
		process.exit(0);
	}

	// Recursive loop 防止 (#4082 R2): subagent が evidence 生成のために review を **読む**のは通す。
	// 旧実装は subagent context を無条件 allow にしていたため、この env が立った context では
	// どのツール経由でも approve が素通りした。許可を「読み取り専用」に絞る。
	if (process.env.CLAUDE_SUBAGENT_ID && approveCommands.every((c) => isReadOnlyApproveInspection(c))) {
		process.exit(0);
	}

	// PR 番号は全件抽出する。1 コマンドで複数 PR を叩く形があるため、1 件の evidence で
	// 残りを通さない。1 件も取れない = 検証対象を特定できない = block (#4057)。
	const prNumbers = [...new Set(approveCommands.flatMap((c) => extractPrNumbers(c)))].sort(
		(a, b) => a - b,
	);
	if (prNumbers.length === 0) {
		process.stderr.write(
			`[gate-approve] BLOCK: approve 系コマンドだが PR 番号を command から抽出できませんでした。\n`,
		);
		process.stderr.write(
			`  検出したコマンド: ${(approveCommands.at(0) ?? '').slice(0, 200).replace(/\n/g, ' ')}\n`,
		);
		process.stderr.write(
			`  対処: PR 番号を command に **リテラルで** 明示してから再実行してください (例: \`gh pr merge 2588 --squash\`)。\n`,
		);
		process.stderr.write(
			`  Why: ループ変数 / コマンド置換 (\`/pulls/$n/reviews\`) では hook がどの PR の evidence を\n`,
		);
		process.stderr.write(
			`       検証すべきか確定できません。確定できないものは通さない側に倒します (#4057 / ADR-0056)。\n`,
		);
		process.exit(2);
	}

	/** @type {{ prNumber: number; reason: string }[]} */
	const failures = [];
	for (const prNumber of prNumbers) {
		const result = verifyEvidence(prNumber);
		if (!result.ok) failures.push({ prNumber, reason: result.reason });
	}
	if (failures.length === 0) {
		process.exit(0);
	}

	const [first] = failures;
	const prNumber = first.prNumber;
	// deny: stderr に修正手順を出す
	process.stderr.write(
		`[gate-approve] BLOCK: PR #${failures.map((f) => f.prNumber).join(', #')} の Adversarial Reviewer evidence 検証 fail.\n`,
	);
	for (const failure of failures) {
		process.stderr.write(`  reason (#${failure.prNumber}): ${failure.reason}\n`);
	}
	process.stderr.write(`  対処:\n`);
	process.stderr.write(
		`    1. Adversarial Reviewer subagent を dispatch する (\`.claude/skills/adversarial-reviewer/SKILL.md\` 参照)\n`,
	);
	process.stderr.write(
		`    2. subagent が \`tmp/adversarial-evidence/${prNumber}.json\` に structured JSON output を保存する\n`,
	);
	process.stderr.write(
		`    3. \`node scripts/verify-adversarial-output.mjs --pr ${prNumber}\` で schema 検証 PASS を確認\n`,
	);
	process.stderr.write(
		`    4. その後本コマンドを再実行する (30 分 TTL 以内 / ADR-0056 §決定 1)\n`,
	);
	process.stderr.write(
		`  根拠: ADR-0056 (QM Orchestrator role drift 構造的対処) / docs/research/qm-drift-prevention-2026-05-28.md\n`,
	);
	process.exit(2);
}

/**
 * 判定 SSOT を読み込めなかったときの fail-closed 終了 (#3999 AC1)。
 *
 * exit 2 は Claude Code が tool 実行を block する唯一の exit code。判定不能のまま exit 1 で
 * 落ちると tool 実行が継続し、evidence 無し approve が通る (= 本 Issue の事故形)。
 *
 * 副作用として、この状態では **approve 系以外の Bash コマンドも全て block される**
 * (本 hook は PreToolUse の Bash matcher で毎回起動されるため)。「approve 系のときだけ
 * block する」surgical 案も検討したが、SSOT を読めない = 「CLI 起動か import か」を判定できない
 * 状態であり、そこで main() を走らせるかどうかを推測すると、import 経由の呼び出し元を
 * 無言で exit させる別の silent failure を作る。判定不能時は**大きく・声を上げて止まる**方を採る。
 *
 * **surgical 案は技術的に不可能ではない**: approve 系かどうかの判定 regex は本 module 内に
 * 閉じており (isApproveAction、is-main.mjs に依存しない)、dynamic import へ変えた時点で
 * module 本体はロード済みなのでコマンド分類自体は可能。**できないから採らないのではなく、
 * 選んで採らない。** 後任が「不可能だった」と誤読しないよう明記する (QM 指摘 / PR #3999 レビュー)。
 *
 * @param {unknown} err
 */
function reportIsMainLoadFailure(err) {
	// どの module が欠けたかを列挙する。#4075 では `command-execution-tools.mjs` の欠落を
	// `is-main.mjs` の話として報告していると原因に辿り着けない。
	const failures =
		moduleLoadFailures.length > 0
			? moduleLoadFailures
			: [{ path: 'scripts/lib/is-main.mjs', err }];
	process.stderr.write(
		`[gate-approve] BLOCK: 判定 SSOT module を読み込めませんでした (${failures.map((f) => f.path).join(' / ')})。\n`,
	);
	for (const failure of failures) {
		const msg = failure.err instanceof Error ? failure.err.message : String(failure.err);
		process.stderr.write(`  reason (${failure.path}): ${msg}\n`);
	}
	process.stderr.write(
		`  ADR-0056 の approve gate は判定不能時に block 側へ倒します (fail-closed / #3999 / #4075)。\n`,
	);
	process.stderr.write(
		`  対処: checkout に上記 module があるか、hook を repo root から起動しているかを確認してください。\n`,
	);
}

// CLI として直接実行されたときのみ main() を呼ぶ。import 経由 (unit test) では実行されない。
// 判定は scripts/lib/is-main.mjs (SSOT, #3969)。従来の `fileURLToPath(import.meta.url) === process.argv[1]`
// は junction / symlink 経由の起動で常に false になり、**approve を素通しする**側に倒れていた。
// `typeof isMain !== 'function'` も block 側に含める。module が読めても isMain を export して
// いなければ判定不能であることに変わりはなく、ここを allow に倒すと同じ fail-open に戻る。
if (isMainLoadError || typeof isMain !== 'function') {
	reportIsMainLoadFailure(
		isMainLoadError ?? new Error('scripts/lib/is-main.mjs が isMain を export していません'),
	);
	process.exit(2);
} else if (isMain(import.meta.url)) {
	// main() 内の想定外例外も unhandled rejection (= exit 1 = 素通し) にせず block へ倒す (#3999)。
	main().catch((err) => {
		const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
		process.stderr.write(`[gate-approve] BLOCK: hook が想定外の例外で失敗しました。\n`);
		process.stderr.write(`  ${detail}\n`);
		process.exit(2);
	});
}
