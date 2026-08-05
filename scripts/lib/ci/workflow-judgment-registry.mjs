/**
 * scripts/lib/ci/workflow-judgment-registry.mjs (#4158)
 *
 * 「**合否を決める判定を workflow YAML の中に書かない**」の宣言 SSOT。
 *
 * # 背景 (実測)
 *
 * `pre-ready --help` は Step 11b を「**CI screenshot-check と SSOT 共有**」と書いていたが、
 * `pr-quality-gate.yml` の `screenshot-check` は同じ .mjs から 2 関数しか import しておらず、
 * **SS embed の有無判定は inline 正規表現**だった。両者は等価ではない:
 *
 *   - script (`hasEmbeddedScreenshotImage`): URL を抽出し **http(s) かつ screenshot / attachment URL** を要求
 *   - inline (`/!\[.*?\]\(.*?\)|<img\s/i`): **`![](...)` が 1 個あれば pass**
 *
 * つまり `![](tmp/local.png)` のようなローカルパス画像だけの PR は **CI 緑・pre-ready 赤**になる。
 * #4153 では逆向き (`ss-render-impossible` を .mjs にだけ実装 → pre-ready 緑・CI 赤) が起きた。
 *
 * **「検査が多すぎて漏れた」のではない。同じ検査が 2 箇所にあり、片方だけ直せば必ずズレる。**
 * 本数を減らしても二重実装が残る限り同じ事故が起きる (#4158)。
 *
 * # 本 registry が固定すること
 *
 *   1. 合否を決める step は、判定を `scripts/*.mjs` の export に**委譲する** (`delegation: 'script'`)
 *   2. 委譲できない構造 (job の `if:` 式は node を呼べない) は `delegation: 'expression'` として
 *      **明示的に宣言し、対応する SSOT を書く** — 黙って inline のまま残さない
 *   3. まだ script 化されていないものは `delegation: 'not-required'` に**理由と追跡 Issue 付きで**置く。
 *      理由なしの逃げ道を作らない (#3956 教訓)
 *   4. 宣言と実物の乖離 (未宣言 / stale) は `workflow-judgment-delegation-guard.test.ts` が fail させる
 *
 * # 段階導入について
 *
 * 初期対象は **PR gate 系の workflow に限る**。`deploy*.yml` の secret 検証 / smoke は
 * script が存在せず、PR gate の等価性問題でもないため `not-required` で明示除外する。
 * 「対象を絞ったこと」自体が registry に残るので、後から範囲を広げるときに漏れが見える。
 */

/**
 * @typedef {object} JudgmentDeclaration
 * @property {string} workflow  `.github/workflows/` からの file 名
 * @property {string} job       job id
 * @property {'script' | 'expression' | 'not-required'} delegation
 * @property {string} [module]  delegation='script' のとき、委譲先 `scripts/*.mjs`
 * @property {string[]} [functions] delegation='script' のとき、呼ぶ export 名 (全て import されていること)
 * @property {string} [ssot]    delegation='expression' のとき、式が一致すべき SSOT
 * @property {string} reason    なぜこの区分なのか。**空文字禁止**
 * @property {string} [issue]   delegation='not-required' のとき必須。`#1234` 形式
 */

/** @type {JudgmentDeclaration[]} */
export const WORKFLOW_JUDGMENTS = [
	{
		workflow: 'pr-quality-gate.yml',
		job: 'screenshot-check',
		delegation: 'script',
		module: 'scripts/check-pr-screenshot.mjs',
		// #4158 で inline から移した 3 判定 + #4153 / #2946 で既に委譲済の 2 判定。
		functions: [
			'isUiPr',
			'hasInternalRefactorLabel',
			'hasEmbeddedScreenshotImage',
			'checkRenderImpossibleDeclaration',
			'hasIntegrationVrEvidence',
		],
		reason:
			'SS embed gate は pre-ready Step 11b と同じ判定でなければならない。inline 正規表現だと ' +
			'ローカルパス画像で CI 緑・pre-ready 赤になる (#4158 実測)',
	},
	{
		workflow: 'pr-quality-gate.yml',
		job: 'design-doc-check',
		delegation: 'script',
		module: 'scripts/check-design-doc-sync.mjs',
		functions: ['checkDesignDocSync'],
		reason: 'ADR-0001 設計書同期。既に委譲済 (本 registry は現状の固定)',
	},
	{
		workflow: 'pr-quality-gate.yml',
		job: 'screenshot-quality-check',
		delegation: 'script',
		module: 'scripts/check-pr-screenshot.mjs',
		functions: [],
		reason: 'CLI 実行 (node scripts/check-pr-screenshot.mjs) で判定を持たない',
	},
	{
		workflow: 'pr-quality-gate.yml',
		job: 'ss-blob-sha-uniqueness-check',
		delegation: 'script',
		module: 'scripts/check-ss-blob-sha-uniqueness.mjs',
		functions: [],
		reason: 'CLI 実行。判定は script 側 (#2063 / #4084)',
	},
	{
		workflow: 'pr-quality-gate.yml',
		job: 'ss-render-health-check',
		delegation: 'script',
		module: 'scripts/check-ss-render-health.mjs',
		functions: [],
		reason: 'CLI 実行。判定は script 側 (#3012)',
	},
];

/**
 * 本 registry の対象 workflow。ここに無い workflow は検査しない。
 *
 * **段階導入の境界を明示するために置く。** 「全 workflow を見ているつもりで実は 1 本だけ」を
 * 避けるため、guard test は本リストの workflow について**全 job が宣言済**であることを要求する。
 */
export const COVERED_WORKFLOWS = ['pr-quality-gate.yml'];

/** @param {string} workflow @param {string} job */
export function findJudgment(workflow, job) {
	return WORKFLOW_JUDGMENTS.find((d) => d.workflow === workflow && d.job === job);
}
