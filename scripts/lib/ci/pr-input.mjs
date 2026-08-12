/**
 * scripts/lib/ci/pr-input.mjs
 *
 * PR を入力に取る gate 群の **入力解決 SSOT** (#4348 対象 #7)。
 *
 * # なぜ共有するか
 *
 * SS 系 gate (`check-ss-blob-sha-uniqueness.mjs` / `check-pr-screenshot.mjs` /
 * `check-ss-render-health.mjs`) は PR body / files / labels を **環境変数からしか読まず、
 * argv を一切パースしていなかった**。兄弟 script (`check-pr-body.mjs` / `capture.mjs`) が
 * 揃って `--pr <N>` を取り、しかも各 gate 自身の案内文が `--pr <N>` 形式を提示するため、
 * 書き手が `--pr` を付けて呼ぶのは自然な誤用である。その結果:
 *
 *   $ node scripts/check-ss-blob-sha-uniqueness.mjs --pr 4513
 *   [ss-blob-sha-uniqueness] SKIP — PR body に ... 参照が見つかりません   ← exit 0
 *
 * **空文字列を検査して成功終了**していた (実測 2026-08-12、PR #4513: body の SS URL が
 * 404 していたのにローカルでは緑、CI で初めて hard error として露見)。
 *
 * # 本 module が固定する不変条件
 *
 * **「実行できて、何も検査せず、成功終了する」を不可能にする。**
 *
 *   - argv `--pr <N>` があれば gh で実 PR を引く (入力ゼロにならない)
 *   - argv が無くても env が実体を持っていればそれを使う (CI の既存経路は不変)
 *   - どちらも無い / `--pr` の値が PR 番号でない / gh 取得に失敗した →
 *     **`PrInputError` を投げて呼び出し側で非 0 終了させる**。skip / pass に倒さない
 *
 * 「届いた入力をどう判定するか」の層 (#4348 の対象一覧 6 箇所) には触れない。
 * 本 module は「**入力が届いているか**」の層だけを担う。
 *
 * # 関連
 *   - #4348 (PR body gate の同 class 群) / #4084 (検査できなかったのに pass の初出)
 *   - `scripts/lib/ci/reason-declaration.mjs` (例外宣言の理由判定 SSOT。宣言機構は増やさない)
 */

import { execSync } from 'node:child_process';

/** 入力解決に失敗したことを表す例外 (呼び出し側は非 0 で終了する)。 */
export class PrInputError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'PrInputError';
	}
}

/** `--pr` の別名 (兄弟 script `check-pr-body.mjs` と揃える)。 */
const PR_ARG_ALIASES = ['--pr', '-p'];

/**
 * argv から `--pr <N>` / `--pr=<N>` を読む。
 *
 * `present` は「書き手が `--pr` を渡した」事実で、`value` は「PR 番号として妥当だった値」。
 * この 2 つを分けるのが本 module の要点である。`present && !value` を env fallback に
 * 落とすと、**誤用が黙って空入力の検査になる**（本 Issue の現象そのもの）。
 *
 * @param {string[]} argv - `process.argv.slice(2)` 相当
 * @returns {{ present: boolean; value: string | null; raw: string }}
 */
export function parsePrNumberArg(argv) {
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] ?? '';
		if (PR_ARG_ALIASES.includes(a)) {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('-'))
				return { present: true, value: null, raw: '' };
			return { present: true, value: /^\d+$/.test(next) ? next : null, raw: next };
		}
		const m = /^(?:--pr|-p)=(.*)$/.exec(a);
		if (m) {
			const raw = m[1] ?? '';
			return { present: true, value: /^\d+$/.test(raw) ? raw : null, raw };
		}
	}
	return { present: false, value: null, raw: '' };
}

/**
 * 入力の渡し方を案内する文字列。
 *
 * @param {string} scriptName - 例: `scripts/check-ss-blob-sha-uniqueness.mjs`
 * @param {'body' | 'prNumber'} need
 * @returns {string}
 */
export function formatPrInputUsage(scriptName, need = 'body') {
	const envLine =
		need === 'body'
			? `  PR_BODY="$(gh pr view <N> --json body -q .body)" node ${scriptName}`
			: `  PR_NUMBER=<N> GITHUB_REPOSITORY=<owner>/<repo> node ${scriptName}`;
	return [`  node ${scriptName} --pr <N>`, envLine].join('\n');
}

/**
 * 入力の取得元を決める **純関数** (IO なし、test で全分岐を固定する)。
 *
 * @param {{ argv?: string[]; env?: Record<string, string | undefined>; need?: 'body' | 'prNumber';
 *   scriptName?: string }} input
 * @returns {{ source: 'gh'; prNumber: string } | { source: 'env'; prNumber: string | null }
 *   | { source: 'error'; message: string }}
 */
export function planPrInput({ argv = [], env = {}, need = 'body', scriptName = 'this script' }) {
	const arg = parsePrNumberArg(argv);

	if (arg.present && arg.value) return { source: 'gh', prNumber: arg.value };

	if (arg.present) {
		return {
			source: 'error',
			message:
				`--pr の値が PR 番号ではありません (受領: ${JSON.stringify(arg.raw)})。\n` +
				`入力の渡し方:\n${formatPrInputUsage(scriptName, need)}`,
		};
	}

	const envBody = (env.PR_BODY ?? '').trim();
	const envNumber = (env.PR_NUMBER ?? '').trim();

	if (need === 'body' && envBody !== '') {
		return { source: 'env', prNumber: /^\d+$/.test(envNumber) ? envNumber : null };
	}
	if (need === 'prNumber' && /^\d+$/.test(envNumber)) {
		return { source: 'env', prNumber: envNumber };
	}

	return {
		source: 'error',
		message:
			`検査対象の PR 入力がありません (${need === 'body' ? 'PR_BODY' : 'PR_NUMBER'} 未設定 / 空、かつ --pr 未指定)。\n` +
			`入力ゼロのまま SKIP すると「何も検査していないのに緑」になるため、実行を失敗させます (#4348 / #4084)。\n` +
			`入力の渡し方:\n${formatPrInputUsage(scriptName, need)}`,
	};
}

/**
 * `gh pr view <N> --json body,labels,files,url` の生 JSON を解釈する **純関数**。
 *
 * `--jq` は使わない (#3962: Windows の cmd.exe が単一引用符を引用符として扱わず jq が落ち、
 * その失敗を握り潰すと gate が黙って縮退する)。JSON を素で受けて JS 側で取り出す。
 *
 * 単一フィールドの `--json` は存在しない PR でも値を返すことがあるため、
 * `url` から owner/repo を取り出せることを**実在確認**として使う。
 *
 * @param {string} raw
 * @returns {{ body: string; labels: string[]; files: string[]; owner: string; repo: string }}
 */
export function parseGhPrView(raw) {
	/** @type {unknown} */
	let json;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new PrInputError(`gh pr view の出力が JSON として解釈できません: ${raw.slice(0, 200)}`);
	}
	if (typeof json !== 'object' || json === null) {
		throw new PrInputError('gh pr view の出力が object ではありません');
	}
	const obj = /** @type {Record<string, unknown>} */ (json);

	const url = typeof obj.url === 'string' ? obj.url : '';
	const m = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
	if (!m) {
		throw new PrInputError(
			`gh pr view の出力に妥当な PR url がありません (実在しない PR 番号の可能性): url=${JSON.stringify(url)}`,
		);
	}

	const body = typeof obj.body === 'string' ? obj.body : '';
	const labels = Array.isArray(obj.labels)
		? obj.labels
				.map((l) =>
					typeof l === 'object' && l !== null && typeof (/** @type {any} */ (l).name) === 'string'
						? /** @type {any} */ (l).name
						: '',
				)
				.filter(Boolean)
		: [];
	const files = Array.isArray(obj.files)
		? obj.files
				.map((f) =>
					typeof f === 'object' && f !== null && typeof (/** @type {any} */ (f).path) === 'string'
						? /** @type {any} */ (f).path
						: '',
				)
				.filter(Boolean)
		: [];

	return { body, labels, files, owner: m[1] ?? '', repo: m[2] ?? '' };
}

/**
 * gh を実行して PR の body / labels / files を取る (既定の IO 実装、test では DI で差し替える)。
 *
 * `expectedRepo` (`owner/repo`) が分かっているときは `gh pr view` に `--repo` を明示する。
 * `gh` は `--repo` 未指定だと **cwd から推測したリポジトリ**に対して PR 番号を解決するため、
 * CI の checkout 構成やローカルの cwd がずれると「意図と違うリポジトリの同番号 PR」を
 * 静かに引いてしまう余地が残る (#4519 と同じ「検査対象の真正性」の軸)。`--repo` を渡せば
 * gh 自身がその時点で pin する。事後の owner/repo 突合は `resolvePrInput` 側が担う。
 *
 * @param {string} prNumber - 数字のみであることを呼び出し前に検証済み
 * @param {string} [expectedRepo] - `owner/repo`。空なら従来通り cwd 推測に委ねる
 * @returns {string} 生 JSON
 */
function defaultGhView(prNumber, expectedRepo = '') {
	const repoArg = expectedRepo ? ` --repo ${expectedRepo}` : '';
	return execSync(`gh pr view ${prNumber}${repoArg} --json body,labels,files,url`, {
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 30_000,
		maxBuffer: 20 * 1024 * 1024,
	});
}

/**
 * gate の入力 (body / labels / files / prNumber / repo) を解決する。
 *
 * 解決できない場合は **必ず `PrInputError`**。空入力で先に進めない (skip / pass に倒さない)。
 *
 * @param {{ argv?: string[]; env?: Record<string, string | undefined>; need?: 'body' | 'prNumber';
 *   scriptName?: string; ghView?: (prNumber: string, expectedRepo?: string) => string }} input
 * @returns {{ source: 'gh' | 'env'; prNumber: string | null; body: string; labels: string[];
 *   files: string[]; repo: string }}
 */
export function resolvePrInput({
	argv = process.argv.slice(2),
	env = process.env,
	need = 'body',
	scriptName = 'this script',
	ghView = defaultGhView,
}) {
	const plan = planPrInput({ argv, env, need, scriptName });
	if (plan.source === 'error') throw new PrInputError(plan.message);

	if (plan.source === 'gh') {
		// CI では常に定義される (GitHub Actions 既定 env)。ローカル実行で未設定なら突合を skip する。
		const expectedRepo = (env.GITHUB_REPOSITORY ?? '').trim();
		let raw;
		try {
			raw = ghView(plan.prNumber, expectedRepo);
		} catch (err) {
			throw new PrInputError(
				`gh pr view ${plan.prNumber} に失敗しました: ${err instanceof Error ? err.message : String(err)}\n` +
					`gh 未認証 / オフライン / PR 番号違いの可能性があります。取得できない入力を「検査対象なし」に倒しません (#4348)。`,
			);
		}
		const parsed = parseGhPrView(raw);
		if (need === 'body' && parsed.body.trim() === '') {
			throw new PrInputError(
				`PR #${plan.prNumber} の body が空です。検査対象が無い状態で成功終了させません (#4348 / #4084)。`,
			);
		}
		const actualRepo = `${parsed.owner}/${parsed.repo}`;
		if (expectedRepo && actualRepo !== expectedRepo) {
			throw new PrInputError(
				`PR #${plan.prNumber} は ${expectedRepo} ではなく ${actualRepo} の PR でした。` +
					`意図しないリポジトリの PR を検査対象にしません (実在確認だけでは足りず、検査対象の真正性を突合する必要がある)。`,
			);
		}
		return {
			source: 'gh',
			prNumber: plan.prNumber,
			body: parsed.body,
			labels: parsed.labels,
			files: parsed.files,
			repo: actualRepo,
		};
	}

	return {
		source: 'env',
		prNumber: plan.prNumber,
		body: env.PR_BODY ?? '',
		labels: (env.PR_LABELS ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
		files: (env.PR_FILES ?? '')
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean),
		repo: env.GITHUB_REPOSITORY ?? '',
	};
}

/**
 * `--help` 指定かどうか。
 *
 * help は「検査結果」ではなく使い方の要求なので exit 0 で返してよい。ただし
 * OK / PASS の語を出さないこと (help を検査 pass と読み違えさせない)。
 *
 * @param {string[]} argv
 * @returns {boolean}
 */
export function isHelpRequested(argv) {
	return argv.includes('--help') || argv.includes('-h');
}
