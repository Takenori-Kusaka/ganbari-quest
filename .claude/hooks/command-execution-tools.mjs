/**
 * .claude/hooks/command-execution-tools.mjs (#4001 / #4082 R1)
 *
 * 「**任意の副作用を起こしうる** Claude Code ツール」の SSOT。
 *
 * # なぜ必要か
 * ADR-0056 の approve gate (`gate-approve.mjs`) と ADR-0022 L1 の PR 作成アカウント予防層
 * (`scripts/claude-hook-prevent-qa-account-pr.mjs`) は `.claude/settings.json` の
 * `PreToolUse` matcher に載った経路しか通らない。matcher が `"Bash"` だけだった間、
 * **PowerShell ツールで同じコマンドを叩けば gate がそもそも起動しなかった** (#4001)。
 * Windows のエージェントは Bash と PowerShell を両方持つため、これは悪意なく踏める分岐で、
 * 「agent の自覚に依存せず物理的に止める」という ADR-0056 の前提そのものを崩す。
 *
 * # 判定軸は「shell か」ではなく「任意の副作用を起こせるか」(#4082 R1)
 * #4001 の棚卸しは対象を **shell ツール**に限っていたため、`mcp__ide__executeCode`
 * (Jupyter kernel 上で任意コードを実行できる) が漏れていた。そこから subprocess を起こせば
 * `gh pr merge` 相当の副作用を出せるのに、shell ではないので matcher に載らず gate が
 * 起動しなかった。**shell か否かではなく、任意の副作用を起こせるか**で列挙する。
 *
 * # 2 つの区分 (payload の読み方が違う)
 *   - `SHELL_COMMAND_TOOLS`   … `tool_input.command` にコマンド全文が入る。非文字列は block
 *   - `CODE_EXECUTION_TOOLS`  … コード片を渡す。key 名は一定でないため tool_input 内の
 *                                **全文字列**を走査する (走査できる文字列が 0 件なら block)
 *
 * # 棚卸し (2026-07-30 時点)
 * 対象:
 *   - `Bash`                  … POSIX shell (Git Bash)
 *   - `PowerShell`            … Windows PowerShell 5.1
 *   - `mcp__ide__executeCode` … Jupyter kernel 上の任意コード実行 (subprocess 起動可)
 * 対象外 (副作用を起こせない / 起こしても本 gate の不変条件に触れない):
 *   - `Read` / `Write` / `Edit` / `Glob` / `Grep` … ファイル操作のみ
 *   - `Agent` / `Skill` … 子セッションを起こすが、子側でも同じ hook 設定が適用される
 *     (ただし `Agent` の `isolation: "remote"` での hook 継承は**このリポジトリからは検証
 *     できない** — ADR-0056 §残存 bypass R3。事後監査 `scripts/audit-approve-evidence.mjs`
 *     が経路非依存の検知層を担う)
 *   - ブラウザ内 JS 実行系 MCP (`browser_run_code_unsafe` / `evaluate_script` 等)
 *     … ページ内 JS であり `gh` を起動できない
 *
 * # 列挙漏れを silent にしない仕組み (#4001 AC3 / #4082 AC4)
 * 手動の列挙メンテは形骸化するため、以下 3 段で守る:
 *   1. `tests/unit/hooks/command-execution-tools.test.ts` が
 *      **`.claude/settings.json` の matcher が本 SSOT の全ツールを覆っていること**を機械検証する
 *   2. `gate-approve.mjs` は **SSOT に無いツール名で呼ばれても allow に倒さない**
 *      (tool_input 内の全文字列を走査し、走査対象が 0 件なら block)
 *   3. それでも「matcher に載らないツール」は gate 自体が起動しないため原理的に塞げない。
 *      この残余は ADR-0056 に accepted residual として明記し、事後監査で検知する
 */

/**
 * コマンド文字列を `tool_input.command` で受け取るツール。
 * @type {readonly string[]}
 */
export const SHELL_COMMAND_TOOLS = Object.freeze(['Bash', 'PowerShell']);

/**
 * 任意コードを実行できる (= 任意の副作用を起こせる) が shell ではないツール。
 * payload の key 名が一定でないため、検査は tool_input 内の全文字列走査で行う。
 * @type {readonly string[]}
 */
export const CODE_EXECUTION_TOOLS = Object.freeze(['mcp__ide__executeCode']);

/**
 * gate の適用対象ツール全体 (shell + code execution)。
 * @type {readonly string[]}
 */
export const COMMAND_EXECUTION_TOOLS = Object.freeze([
	...SHELL_COMMAND_TOOLS,
	...CODE_EXECUTION_TOOLS,
]);

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
