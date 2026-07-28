/**
 * .claude/hooks/command-execution-tools.mjs (#4001)
 *
 * 「コマンドを実行しうる Claude Code ツール」の SSOT。
 *
 * # なぜ必要か
 * ADR-0056 の approve gate (`gate-approve.mjs`) と ADR-0022 L1 の PR 作成アカウント予防層
 * (`scripts/claude-hook-prevent-qa-account-pr.mjs`) は `.claude/settings.json` の
 * `PreToolUse` matcher に載った経路しか通らない。matcher が `"Bash"` だけだった間、
 * **PowerShell ツールで同じコマンドを叩けば gate がそもそも起動しなかった** (#4001)。
 * Windows のエージェントは Bash と PowerShell を両方持つため、これは悪意なく踏める分岐で、
 * 「agent の自覚に依存せず物理的に止める」という ADR-0056 の前提そのものを崩す。
 *
 * # 棚卸し (#4001 AC3、2026-07-28 時点)
 * このセッション設定 (`.claude/settings.json`) でコマンド文字列を実行しうるツール:
 *   - `Bash`       … POSIX shell (Git Bash)。`tool_input.command` に全文が入る
 *   - `PowerShell` … Windows PowerShell 5.1。同じく `tool_input.command`
 * 以下は**コマンド実行経路ではない**ため対象外:
 *   - `Read` / `Write` / `Edit` / `Glob` / `Grep` … ファイル操作のみ
 *   - `Agent` / `Skill` … 子セッションを起こすが、子側でも同じ hook 設定が適用される
 *   - MCP ツール群 (`mcp__*`) … 現行の登録サーバに汎用 shell 実行ツールは無い
 *     (chrome-devtools / playwright / discord / gmail / calendar / drive / aws 系 / youtube。
 *      `browser_run_code_unsafe` や `evaluate_script` はブラウザ内 JS であってシェルではない)
 *
 * # 将来ツールが増えたときに漏れない仕組み (#4001 AC3)
 * 手動の列挙メンテは形骸化するため、以下 2 段で守る:
 *   1. `tests/unit/hooks/command-execution-tools.test.ts` が
 *      **`.claude/settings.json` の matcher が本 SSOT の全ツールを覆っていること**を機械検証する。
 *      SSOT に 1 行足して settings.json を直し忘れれば CI が落ちる。
 *   2. `gate-approve.mjs` は **SSOT に無いツール名で呼ばれた場合でも allow に倒さない**
 *      (tool_input 内の全文字列を走査して approve 系を探す)。matcher だけ広げて SSOT 更新を
 *      忘れた場合でも、gate が無言で素通ししない。
 */

/**
 * コマンド文字列を実行しうるツール名。
 * @type {readonly string[]}
 */
export const COMMAND_EXECUTION_TOOLS = Object.freeze(['Bash', 'PowerShell']);

/**
 * `.claude/settings.json` の PreToolUse matcher に書くべき正規表現文字列 (SSOT)。
 * @type {string}
 */
export const COMMAND_EXECUTION_MATCHER = COMMAND_EXECUTION_TOOLS.join('|');

/**
 * matcher 文字列が特定のツール名を覆っているかを判定する。
 *
 * Claude Code の PreToolUse matcher はツール名に対する正規表現なので、
 * 完全一致 (anchored) で評価する。不正な正規表現は「覆っていない」扱い (fail-closed)。
 *
 * @param {string} matcher `.claude/settings.json` の `hooks.PreToolUse[].matcher`
 * @param {string} toolName 判定したいツール名
 * @returns {boolean}
 */
export function matcherCoversTool(matcher, toolName) {
	if (typeof matcher !== 'string' || typeof toolName !== 'string') return false;
	let re;
	try {
		re = new RegExp(`^(?:${matcher})$`);
	} catch {
		return false;
	}
	return re.test(toolName);
}
