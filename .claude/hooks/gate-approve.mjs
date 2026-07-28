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
 * 関連:
 *   - ADR-0056 (本 hook の設計根拠 SSOT)
 *   - docs/research/qm-drift-prevention-2026-05-28.md (research primary source)
 *   - .claude/skills/adversarial-reviewer/SKILL.md (subagent 仕様)
 *   - scripts/verify-adversarial-output.mjs (schema validation 本体、本 hook が import)
 *   - .claude/settings.json (PreToolUse 設定、本 hook を hooks[].hooks[] に追加)
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	findGhInvocations,
	isPullsSubresourcePath,
	normalizeCommand,
	parseGhApiInvocation,
	sanitizeForDetection,
} from '../../scripts/lib/gh-command.mjs';
import { isMain } from '../../scripts/lib/is-main.mjs';
import { COMMAND_EXECUTION_TOOLS } from './command-execution-tools.mjs';

export { normalizeCommand };

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
	// #4027: `--body` / `--body-file` / heredoc の中身は判定材料にしない。
	// hook 自身を説明する Issue / PR 本文に approve コマンド例を書くだけで BLOCK される事故の再発防止。
	const sanitized = sanitizeForDetection(command);
	// gh pr merge
	if (/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(sanitized)) return true;
	// gh pr review --approve
	if (/\bgh(?:\.exe)?\s+pr\s+review\b[^\n]*--approve\b/.test(sanitized)) return true;
	// gh api .../pulls/<N>/{merge,reviews} (REST 直叩き)。
	// #4027: 部分一致でなく **引数として渡された API パス** で判定する。method は問わない
	// (approve 相当を method 表記で回避されないよう検出幅は従来どおり維持する)。
	for (const { argv } of findGhInvocations(sanitized)) {
		const api = parseGhApiInvocation(argv);
		if (!api.isApi) continue;
		if (
			api.paths.some(
				(p) => isPullsSubresourcePath(p, 'merge') || isPullsSubresourcePath(p, 'reviews'),
			)
		) {
			return true;
		}
	}
	return false;
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
	// #4027: あわせて --body / heredoc の中身を除去し、body 内の PR 番号を拾わないようにする
	const normalized = sanitizeForDetection(command);
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

// CLI として直接実行されたときのみ main() を呼ぶ。import 経由 (unit test) では実行されない。
// 判定は scripts/lib/is-main.mjs (SSOT, #3969)。従来の `fileURLToPath(import.meta.url) === process.argv[1]`
// は junction / symlink 経由の起動で常に false になり、**approve を素通しする**側に倒れていた。
if (isMain(import.meta.url)) {
	main();
}
