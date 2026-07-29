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
 * 対象経路 (#4001):
 *   Bash だけでなく **コマンド実行系ツール全経路** (SSOT: ./command-execution-tools.mjs)。
 *   matcher が `"Bash"` だけだった間、PowerShell ツールで同じコマンドを叩けば gate が
 *   起動せず素通しできた (gate bypass)。判別できない入力は allow ではなく block する。
 *
 * 設計根拠 (Research SSOT §5.1 / §5.2):
 *   - arXiv:2511.09710 で structured response schema 強制が echoing 30-40% → <10% を実証
 *   - Sleeper Agents (Hubinger 2024): instruction 経由の役割強化は drift trigger に対処できない
 *     → agent 内部自覚に依存せず Bash command を物理 block する hook が必要
 *
 * Recursive loop 防止:
 *   `process.env.CLAUDE_SUBAGENT_ID` 存在時 (Adversarial Reviewer subagent context) は
 *   無条件 allow。subagent が evidence 生成中に approve 系コマンドを叩いても block されない。
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
import { COMMAND_EXECUTION_TOOLS } from './command-execution-tools.mjs';

/**
 * 判定 SSOT (`scripts/lib/is-main.mjs`) を **dynamic import** で読み込む理由 (#3999)。
 *
 * static import にすると解決失敗が module 評価前の `ERR_MODULE_NOT_FOUND` になり、Node は
 * **exit 1** で落ちる。Claude Code の PreToolUse hook は **exit 2 のみ**を block として扱い、
 * それ以外の非 0 は non-blocking error として tool 実行を継続する。つまり `scripts/` を含まない
 * checkout では **evidence 無しで approve / merge が通っていた** (fail-open)。
 *
 * security control は「判定不能」を「許可」ではなく **block** に倒す (fail-closed)。
 * dynamic import なら解決失敗を catch でき、exit 2 を自分で選べる。
 */
/** @type {((importMetaUrl: string, argv1?: string) => boolean) | undefined} */
let isMain;
/** @type {unknown} import 解決に失敗したときの error (成功時は null) */
let isMainLoadError = null;
try {
	({ isMain } = await import('../../scripts/lib/is-main.mjs'));
} catch (err) {
	isMainLoadError = err;
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
 * 誤検知側に倒す方針 (既存 scripts/claude-hook-prevent-qa-account-pr.mjs と同方針)。
 * 過剰 block コスト < drift identification trap が穴になるコスト。
 *
 * @param {unknown} command  Bash tool_input.command 文字列
 * @returns {boolean}        対象操作なら true
 */
export function isApproveAction(command) {
	if (typeof command !== 'string') return false;
	const normalized = normalizeCommand(command);
	// gh pr merge
	if (/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(normalized)) return true;
	// gh pr review --approve
	if (/\bgh(?:\.exe)?\s+pr\s+review\b[^\n]*--approve\b/.test(normalized)) return true;
	// gh api .../pulls/<N>/merge (REST 直叩き)
	if (/\bgh(?:\.exe)?\s+api\b[^\n]*\/pulls\/\d+\/merge\b/.test(normalized)) return true;
	// gh api .../pulls/<N>/reviews (review 系 REST)
	if (/\bgh(?:\.exe)?\s+api\b[^\n]*\/pulls\/\d+\/reviews\b/.test(normalized)) return true;
	return false;
}

/**
 * PowerShell 経路で現れる表記ゆれを吸収してから regex 判定するための正規化 (#4001)。
 *
 * 吸収する差分 (Windows agent が自然に書く形):
 *   - 呼び出し演算子 + 引用符付き exe: `& 'gh' pr merge 1` / `& "gh.exe" pr merge 1`
 *   - backtick 行継続: "gh pr `\n merge 1"
 *   - 連続空白 / タブ
 *
 * 変換は「検出側を広げる」方向にのみ効く (正規化しても既存 Bash 表記の判定は変わらない)。
 * 変数間接参照 (`$c = 'gh pr merge 1'; iex $c`) 等の任意難読化は文字列検査では原理的に
 * 追えないが、それは Bash 経路にも元からある性質であり本 fix で新たに開いた穴ではない。
 *
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
	return command
		.replace(/`\r?\n/g, ' ') // PowerShell 行継続
		.replace(/&\s*(['"])([^'"]+)\1/g, '$2') // & 'gh' → gh
		.replace(/(['"])(gh(?:\.exe)?)\1/gi, '$2') // 'gh' → gh
		.replace(/[ \t]+/g, ' ');
}

/**
 * hook payload から「検査すべきコマンド文字列」を取り出す (#4001)。
 *
 * fail-closed 方針: **抽出できない = approve ではない、とは扱わない**。
 *   - tool_name が無い / 文字列でない → BLOCK (どの経路か判別できない)
 *   - SSOT (COMMAND_EXECUTION_TOOLS) のツールなのに `tool_input.command` が文字列でない
 *     → BLOCK (検査対象を読めない = 素通しさせない)
 *   - SSOT に無いツール名 → allow に倒さず、tool_input 内の全文字列 (+ 連結形) を走査する。
 *     matcher だけ広げて SSOT 更新を忘れた場合でも approve 系を掴めるようにするため。
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
	if (COMMAND_EXECUTION_TOOLS.includes(toolName)) {
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
	// 引数配列 (["gh","pr","merge","4001"]) 形式にも当たるよう連結形も候補に入れる
	return { ok: true, commands: strings.length > 1 ? [...strings, strings.join(' ')] : strings };
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
	if (typeof command !== 'string') return null;
	// #4001: PowerShell 表記ゆれ (& 'gh' / gh.exe / backtick 継続) を吸収してから抽出する
	const normalized = normalizeCommand(command);
	// gh pr <merge|review> [args] <N>
	const m1 = normalized.match(/\bgh(?:\.exe)?\s+pr\s+(?:merge|review)\b[^\n]*?\b(\d{1,6})\b/);
	if (m1) return Number(m1[1]);
	// gh api .../pulls/<N>/...
	const m2 = normalized.match(/\/pulls\/(\d{1,6})\b/);
	if (m2) return Number(m2[1]);
	return null;
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
	// Recursive loop 防止: subagent context は無条件 allow
	if (process.env.CLAUDE_SUBAGENT_ID) {
		process.exit(0);
	}

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

	const command = resolved.commands.find((c) => isApproveAction(c));
	if (command === undefined) {
		// approve 系コマンドでなければ対象外
		process.exit(0);
	}

	const prNumber = extractPrNumber(command);
	if (prNumber === null) {
		process.stderr.write(
			`[gate-approve] BLOCK: approve 系コマンドだが PR 番号を command から抽出できませんでした。\n`,
		);
		process.stderr.write(
			`  対処: PR 番号を command に明示してから再実行してください (例: \`gh pr merge 2588 --squash\`)。\n`,
		);
		process.exit(2);
	}

	const result = verifyEvidence(prNumber);
	if (result.ok) {
		process.exit(0);
	}

	// deny: stderr に修正手順を出す
	process.stderr.write(
		`[gate-approve] BLOCK: PR #${prNumber} の Adversarial Reviewer evidence 検証 fail.\n`,
	);
	process.stderr.write(`  reason: ${result.reason}\n`);
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
	const msg = err instanceof Error ? err.message : String(err);
	process.stderr.write(
		`[gate-approve] BLOCK: 判定 SSOT scripts/lib/is-main.mjs を読み込めませんでした。\n`,
	);
	process.stderr.write(`  reason: ${msg}\n`);
	process.stderr.write(
		`  ADR-0056 の approve gate は判定不能時に block 側へ倒します (fail-closed / #3999)。\n`,
	);
	process.stderr.write(
		`  対処: checkout に scripts/lib/is-main.mjs があるか、hook を repo root から起動しているかを確認してください。\n`,
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
