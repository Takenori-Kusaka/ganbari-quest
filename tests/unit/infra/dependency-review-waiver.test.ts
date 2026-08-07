/**
 * tests/unit/infra/dependency-review-waiver.test.ts (#4017)
 *
 * ## なぜこの test があるか
 *
 * `.github/workflows/dependency-review.yml` に `allow-ghsas: GHSA-mh99-v99m-4gvg`
 * (brace-expansion <= 5.0.7 の DoS) を入れている。理由は workflow 側のコメントに書いたが、
 * **`allow-ghsas` は GHSA ID 単位でしか指定できず、path / manifest / dependency scope で
 * 絞れない** (actions/dependency-review-action v5 の input / config-file いずれにも
 * 該当キーが無いことを確認済み)。
 *
 * つまり waiver を入れた瞬間から、**将来 brace-expansion が本番ランタイム依存として
 * 入ってきても同じ advisory なら gate は黙る**。waiver の正当化は「CDK synth の
 * build-time 1 経路のみ」という事実に依存しているので、その事実が崩れたら気づける
 * 必要がある。gate が黙る範囲を機械的に狭めるのが本 test の役目。
 *
 * ## 何を固定するか
 *
 * 1. root `package-lock.json` の brace-expansion が **development 依存のままである**こと (`[W1]`)。
 * 2. `infra/package-lock.json` の bundled brace-expansion が **5.0.8 未満である**こと (`[W5]`)。
 *    patched 版が入った瞬間に fail し、waiver 撤去を機械が要求する (ADR-0061 fitness function)。
 *
 * ## `[W5]` が赤くなったときに「waiver 撤去」で正しいのは 5.0.9 以上のときだけ
 *
 * 本 test を書いた時点では「5.0.8 = GHSA-mh99-v99m-4gvg の patched 版 = 安全」という前提だったが、
 * **その前提はもう成立しない**。2026-07-30 に GHSA-rgw5-rvv9-x895 (high、CVE-2026-14257 の緩和を
 * bypass する DoS) が公開され、その affected range は **`>= 4.0.0, < 5.0.9`**、つまり 5.0.8 も
 * **5.0.7 も**該当する (firstPatchedVersion = 5.0.9)。したがって `[W5]` が赤くなったら、
 * **到達した version を見て行動を分岐する**:
 *
 * - **5.0.9 以上が来た**: 両 advisory とも patched。waiver (`allow-ghsas`) と根拠コメント、
 *   および本 test file を削除する (= 下の fail message の指示どおり)。
 * - **5.0.8 が来た**: GHSA-rgw5-rvv9-x895 が未解決なので **waiver を撤去してはいけない**。
 *   `[W5]` の bound を緩めるのも不可 (ADR-0006)。aws-cdk-lib 側が 5.0.9 を bundle するのを待ち、
 *   それまで bundled 5.0.7 の版に留める。
 *
 * 実例 (PR #4422): aws-cdk-lib 2.263.0 が bundled brace-expansion を 5.0.7 → 5.0.8 に上げ、
 * `dependency-review` と `[W5]` が同時に赤くなった。brace-expansion は bundled dependency
 * (aws-cdk-lib が同梱する minimatch の依存) で **npm `overrides` では差し替えられない**ため
 * (overrides を書いても lock の `inBundle: true` entry は 5.0.8 のまま = 実測確認済)、
 * bundled 5.0.7 の最新である aws-cdk-lib 2.262.2 に留める形で解消した。
 *
 * ## なぜ「dev のままなら安全」ではないのか (根拠の訂正、PO 決裁 条件 2)
 *
 * 本リポジトリの `Dockerfile` は runtime stage に `COPY --from=build /app/node_modules ./node_modules`
 * で **devDeps ごと同梱**している (同行のコメントに「devDeps 込み COPY」と明記)。したがって
 * 「本番ビルドは `npm ci --omit=dev` なので dev のままなら載らない」という旧説明は**事実と異なる**。
 * 正しい根拠は以下の 2 点:
 *
 * - **waiver 対象 (infra 側)**: `infra/node_modules` は CDK synth 専用で本番イメージに一度も
 *   install されない。よって aws-cdk-lib bundled の brace-expansion は**顧客リクエスト経路に存在しない**
 * - **root 側**: brace-expansion は本番イメージのディスク上には存在するが、server bundle の実行経路から
 *   require されず、glob の入力は攻撃者非制御 (リポジトリ内の記述のみ)
 *
 * `[W1]` は「root 側が非 dev に昇格したら根拠を見直す」ための早期警報として引き続き有効
 * (dependency-review の `fail-on-scopes: runtime` が root 側 dev を対象外にしているため、
 * 非 dev 化した瞬間に本 waiver が gate を黙らせる範囲が広がる)。
 *
 * PO 決裁記録: https://github.com/Takenori-Kusaka/ganbari-quest/issues/4017#issuecomment-5113776277
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');

type LockPackage = { version?: string; dev?: boolean; inBundle?: boolean };
type Lockfile = { packages?: Record<string, LockPackage> };

function readLock(relPath: string): Lockfile {
	return JSON.parse(readFileSync(resolve(repoRoot, relPath), 'utf8'));
}

/** lock 内の `<package>` エントリを全て返す (ネストした node_modules/ 配下も含む)。 */
function entriesFor(lock: Lockfile, pkg: string): [string, LockPackage][] {
	return Object.entries(lock.packages ?? {}).filter(([path]) =>
		path.endsWith(`node_modules/${pkg}`),
	);
}

const WAIVED_GHSA = 'GHSA-mh99-v99m-4gvg';

/** advisory GHSA-mh99-v99m-4gvg の patched version。これ以上なら waiver は不要になる。 */
const PATCHED_BRACE_EXPANSION = [5, 0, 8] as const;

/** `1.2.3` / `1.2.3-rc.1` を `[1,2,3]` に落とす (prerelease 差は本 gate では無視)。 */
function parseVersion(version: string): [number, number, number] {
	const core = version.split(/[-+]/)[0] ?? '';
	const parts = core.split('.').map((n) => Number.parseInt(n, 10));
	const [major, minor, patch] = parts;
	if (
		parts.length !== 3 ||
		major === undefined ||
		minor === undefined ||
		patch === undefined ||
		!Number.isInteger(major) ||
		!Number.isInteger(minor) ||
		!Number.isInteger(patch)
	) {
		throw new Error(`brace-expansion の version を解釈できません: ${version}`);
	}
	return [major, minor, patch];
}

function isBelow(version: string, bound: readonly [number, number, number]): boolean {
	const v = parseVersion(version);
	for (let i = 0; i < 3; i++) {
		const actual = v[i] as number;
		const expected = bound[i] as number;
		if (actual !== expected) return actual < expected;
	}
	return false;
}

describe('#4017 dependency-review waiver の適用範囲を狭める', () => {
	// 非 dev に昇格すると dependency-review (fail-on-scopes: runtime) の検査対象に入り、
	// 本 waiver が gate を黙らせる範囲が広がる。根拠 (実行経路から require されない / glob 入力が
	// 攻撃者非制御) を再点検する必要があるので、その時点で fail させる。
	it('[W1] root package-lock.json の brace-expansion は development 依存のままである', () => {
		const entries = entriesFor(readLock('package-lock.json'), 'brace-expansion');
		expect(
			entries.length,
			'brace-expansion が root lock から消えたら waiver を見直す',
		).toBeGreaterThan(0);
		const runtimeEntries = entries.filter(([, meta]) => meta.dev !== true);
		expect(runtimeEntries.map(([path]) => path)).toEqual([]);
	});

	it('[W2] waiver は workflow に GHSA ID と撤去条件つきで書かれている', () => {
		const wf = readFileSync(resolve(repoRoot, '.github/workflows/dependency-review.yml'), 'utf8');
		expect(wf).toContain(`allow-ghsas: ${WAIVED_GHSA}`);
		// 根拠なしの waiver を後から足せないようにする (#4030 class B と同じ「理由の機械強制」)
		expect(wf).toContain('#4017');
		expect(wf).toContain('撤去条件');
	});

	// waiver の根拠は「development scope は元々検査対象外」に依存している。
	// fail-on-scopes の既定が変わる / 誰かが development を足すと根拠が黙って崩れる。
	it('[W3] fail-on-scopes が runtime に固定されている', () => {
		const wf = readFileSync(resolve(repoRoot, '.github/workflows/dependency-review.yml'), 'utf8');
		expect(wf).toMatch(/^\s*fail-on-scopes:\s*runtime\s*$/m);
	});

	it('[W4] waiver は 1 件だけ (GHSA の追加は個別に根拠を要する)', () => {
		const wf = readFileSync(resolve(repoRoot, '.github/workflows/dependency-review.yml'), 'utf8');
		const line = wf.split('\n').find((l) => l.trimStart().startsWith('allow-ghsas:'));
		expect(line).toBeDefined();
		const ids = (line ?? '')
			.split(':')
			.slice(1)
			.join(':')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		expect(ids).toEqual([WAIVED_GHSA]);
	});

	// **撤去を機械が要求するための検査 (PO 決裁 条件 1、ADR-0061 fitness function)。**
	// `[W2]` は「撤去条件が workflow に書かれている」ことしか見ないため、誰も aws-cdk-lib の
	// リリースを追わなければ waiver は恒久化する。patched 版が lock に入った瞬間に本 test が
	// 赤くなり、「waiver を消せ」という指示に変わる。
	it('[W5] infra/package-lock.json の bundled brace-expansion は 5.0.8 未満である', () => {
		const lock = readLock('infra/package-lock.json');
		// root lock の entry と取り違えないよう、infra lock の **bundled** entry のみを対象にする
		// (aws-cdk-lib が同梱する実体 = `node_modules/aws-cdk-lib/node_modules/brace-expansion`)。
		const bundled = entriesFor(lock, 'brace-expansion').filter(
			([, meta]) => meta.inBundle === true,
		);
		expect(
			bundled.map(([path]) => path),
			'aws-cdk-lib の bundled brace-expansion が infra lock から消えたら waiver を見直す',
		).toEqual(['node_modules/aws-cdk-lib/node_modules/brace-expansion']);

		const bundledEntry = bundled[0];
		expect(bundledEntry, 'bundled entry が取得できない').toBeDefined();
		const version = bundledEntry?.[1].version ?? '';
		expect(version, 'bundled entry に version がない').not.toBe('');
		expect(
			isBelow(version, PATCHED_BRACE_EXPANSION),
			[
				`bundled brace-expansion が ${version} になりました (${WAIVED_GHSA} の patched = ${PATCHED_BRACE_EXPANSION.join('.')} 以上)。`,
				'次の行動は到達した version で分岐します (file 冒頭の §「[W5] が赤くなったとき」を読んでください):',
				`- 5.0.9 以上なら: .github/workflows/dependency-review.yml の waiver (allow-ghsas: ${WAIVED_GHSA}) と`,
				'  その根拠コメント、および本 test file を削除してください。撤去条件を満たしたので waiver は不要です。',
				'- 5.0.8 なら: GHSA-rgw5-rvv9-x895 (affected >= 4.0.0 < 5.0.9) が未解決です。waiver を撤去せず、',
				'  bound も緩めず (ADR-0006)、bundled 5.0.7 の aws-cdk-lib に留めて 5.0.9 の bundle を待ってください。',
			].join('\n'),
		).toBe(true);
	});
});
