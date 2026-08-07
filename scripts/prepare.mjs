// scripts/prepare.mjs — npm `prepare` lifecycle の cross-platform 実装 (#3611)
//
// 旧実装は package.json 内の POSIX sh 構文 (single quote + `||` echo フォールバック) で、
// Windows の npm script shell (cmd.exe) では quote 解釈が壊れて **npm ci / npm install が
// 毎回 exit 1** になっていた (日本語文言 + em-dash が cmd の構文エラーを誘発)。
// npm scripts の複雑な分岐は Node script に寄せるのが cross-platform の標準解のため、
// 本 script に移管する (shell 構文非依存)。
//
// 挙動契約 (#2476 の意図を保持):
//   - 3 step (svelte-kit sync / husky / cd infra && npm ci) を順次実行
//   - 各 step の失敗は warning を出して継続 (CI / Lambda build で husky 不在は正常)
//   - 全体は常に exit 0 (prepare 失敗で install 自体を止めない)
//   - warning 文言は旧実装と同一 (tests/CLAUDE.md の案内 / 既存 grep 互換)

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

/** step を実行し、失敗時は warning を出して false を返す (throw しない)。 */
function runStep(label, command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		stdio: 'inherit',
		// Windows で .cmd shim (npx.cmd / npm.cmd) を解決するため shell 経由で起動する。
		// 引数は本 script 内の固定値のみ (ユーザー入力を通さない)。
		shell: true,
		...options,
	});
	if (result.status !== 0) {
		console.warn(`[prepare] ${label}`);
		return false;
	}
	return true;
}

runStep(
	'svelte-kit sync failed — node_modules incomplete の可能性。npm install を再実行してください',
	'npx',
	['svelte-kit', 'sync'],
);

runStep('husky failed — CI / Lambda build 環境では正常 (husky 未インストール)', 'npx', ['husky']);

// #4442: `.gitattributes` の `graphify-out/graph.json merge=graphify` を実際に効かせる。
// driver 本体の登録先は **local git config** で commit できないため、clone ごとにここで登録する。
// 未登録のまま attribute だけあると git は黙って既定 merge にフォールバックし、
// 「設定されているように見えて効かない」状態になる (= #4442 の壊れ方が再発する)。
// hook install は冪等 (既存行を重複させない) で、graphify 未導入の環境では warning のみ。
runStep(
	'graphify hook install failed — graphify 未導入なら正常。導入済みなら graph.json の merge driver が' +
		'未登録のままなので、並行 PR の merge で graph.json が壊れます (手動実行: graphify hook install)',
	'graphify',
	['hook', 'install'],
);

runStep(
	'cd infra && npm ci FAILED — infra/marketplace 系テストが Cannot find module で fail します。手動実行: cd infra && npm ci',
	'npm',
	['ci', '--no-audit', '--no-fund'],
	{ cwd: join(repoRoot, 'infra') },
);

process.exit(0);
