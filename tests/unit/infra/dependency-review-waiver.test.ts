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
 * root `package-lock.json` の brace-expansion が **development 依存のままである**こと。
 * 本番ビルドは `npm ci --omit=dev` なので、dev のままなら顧客ランタイムには載らない。
 * 非 dev で現れたら waiver の前提が崩れているので fail させる。
 *
 * `infra/package-lock.json` 側 (aws-cdk-lib の bundled dependency) は waiver の対象そのもの
 * なので、ここでは版数を固定しない (上げれば waiver ごと消せる、というのが撤去条件)。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');

type LockPackage = { version?: string; dev?: boolean };
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

describe('#4017 dependency-review waiver の適用範囲を狭める', () => {
	// **これが waiver の前提そのもの。** 非 dev で現れたら顧客ランタイムに載りうるので、
	// 「build-time only だから許容」という根拠が成立しなくなる。
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
});
