#!/usr/bin/env node

/**
 * .claude/hooks/gate-approve.mjs (ADR-0056)
 *
 * Claude Code `PreToolUse` hook で呼出される検査スクリプト。
 *
 * 機能:
 *   stdin から Claude Code が渡す tool_input JSON を読み取り、Bash command 文字列が
 *   `gh pr (merge|review --approve)` を含むとき、`tmp/adversarial-evidence/<pr-number>.json`
 *   の存在 + TTL (30 分) + schema 必須 field 充足を検証する。検証 fail なら exit 2 で
 *   approve action を物理 block する。
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
import { fileURLToPath } from 'node:url';

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
	// gh pr merge
	if (/\bgh\s+pr\s+merge\b/.test(command)) return true;
	// gh pr review --approve
	if (/\bgh\s+pr\s+review\b[^\n]*--approve\b/.test(command)) return true;
	// gh api .../pulls/<N>/merge (REST 直叩き)
	if (/\bgh\s+api\b[^\n]*\/pulls\/\d+\/merge\b/.test(command)) return true;
	// gh api .../pulls/<N>/reviews (review 系 REST)
	if (/\bgh\s+api\b[^\n]*\/pulls\/\d+\/reviews\b/.test(command)) return true;
	return false;
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
	// gh pr <merge|review> [args] <N>
	const m1 = command.match(/\bgh\s+pr\s+(?:merge|review)\b[^\n]*?\b(\d{1,6})\b/);
	if (m1) return Number(m1[1]);
	// gh api .../pulls/<N>/...
	const m2 = command.match(/\/pulls\/(\d{1,6})\b/);
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
		// JSON parse 失敗時は通過 (hook の異常で Claude を止めない、既存 hook と同方針)
		process.exit(0);
	}

	const command = payload?.tool_input?.command;
	if (!isApproveAction(command)) {
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
const isDirectInvocation =
	process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectInvocation) {
	main();
}
