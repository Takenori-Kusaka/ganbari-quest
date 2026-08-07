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
 * ## brace-expansion に関わる advisory は 2 件ある
 *
 * | advisory | affected | patched | 本リポジトリでの扱い |
 * |---|---|---|---|
 * | `GHSA-mh99-v99m-4gvg` | `<= 5.0.7` | 5.0.8 | **waiver** (`allow-ghsas`) |
 * | `GHSA-rgw5-rvv9-x895` | `>= 4.0.0, < 5.0.9` | 5.0.9 | **受容記録のみ** (waive しない) |
 *
 * 実測 (2026-08-07、GitHub Security Advisory API):
 * `securityAdvisory(ghsaId:"GHSA-rgw5-rvv9-x895")` の brace-expansion vulnerability は
 * `vulnerableVersionRange: ">= 4.0.0, < 5.0.9"` / `firstPatchedVersion: "5.0.9"`。
 * したがって **5.0.8 も 5.0.7 も rgw5 の affected**。「5.0.7 に留めれば非該当」ではない
 * (bundled 5.0.7 に留めたのは *この diff で新たに 5.0.8 を持ち込まない* ためであって、
 * 脆弱性が消えたからではない)。**両 advisory が同時に解消するのは 5.0.9 以上のときだけ**。
 *
 * ## 状態は version から機械的に決まる (「waiver を消してよい版か」の唯一の判定点)
 *
 * `assessWaiverState()` が bundled version を読み、以下の 2 状態のどちらかとして契約を判定する。
 * 人が切り替えるフラグは無い (ADR-0006: 前提が変わったときだけ assertion の *向き* が変わる)。
 *
 * - **affected (`< 5.0.9`)**: waiver・受容記録・dependabot ignore が **揃っていること**を要求する。
 *   どれかが黙って消えたら fail (受容の記録なしに緑になることを防ぐ)。
 * - **patched (`>= 5.0.9`)**: waiver・受容記録・ignore が **消えていること**を要求する。
 *   つまり「5.0.9 を取り込む PR で 3 点を撤去すれば緑」であり、**修正版の取り込みを止めない**
 *   (旧実装は bound を 5.0.8 未満に固定していたため、5.0.9 が来ると赤のまま = 向きが逆だった)。
 *
 * ## なぜ rgw5 は waive しないのか (受容記録に留める理由)
 *
 * `allow-ghsas` に足すと、rgw5 は **どの経路で入っても** gate が黙る。現に aws-cdk-lib
 * 2.263.0 は bundled を 5.0.8 に上げ、これは rgw5 の affected なので `dependency-review` が
 * 赤くなった = **gate は今も正しく効いている**。waive するとこの検知を自ら殺すことになる。
 * infra 側の実エクスポージャが無い (下記) ことは *赤を無視してよい理由* にはなるが、
 * *赤を出なくしてよい理由* にはならないので、受容は文章と本 test で記録するに留める。
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

function readText(relPath: string): string {
	return readFileSync(resolve(repoRoot, relPath), 'utf8');
}

/** lock 内の `<package>` エントリを全て返す (ネストした node_modules/ 配下も含む)。 */
function entriesFor(lock: Lockfile, pkg: string): [string, LockPackage][] {
	return Object.entries(lock.packages ?? {}).filter(([path]) =>
		path.endsWith(`node_modules/${pkg}`),
	);
}

/** `allow-ghsas` で gate を黙らせている advisory (affected `<= 5.0.7` / patched 5.0.8)。 */
const WAIVED_GHSA = 'GHSA-mh99-v99m-4gvg';

/**
 * waive せず受容記録だけを置く advisory (affected `>= 4.0.0, < 5.0.9` / patched 5.0.9)。
 * `allow-ghsas` に足してはいけない (足すと 5.0.8 の再取込を検知できなくなる)。
 */
const ACCEPTED_RISK_GHSA = 'GHSA-rgw5-rvv9-x895';

/**
 * **両 advisory が解消する最初の version**。`GHSA-rgw5-rvv9-x895` の `firstPatchedVersion`
 * (実測: GitHub Security Advisory API) であり、`GHSA-mh99-v99m-4gvg` の patched (5.0.8) より上。
 * これ未満は「どちらかの affected」= 受容記録が要る状態。
 */
const FIRST_PATCHED_BOTH = [5, 0, 9] as const;

const BUNDLED_PATH = 'node_modules/aws-cdk-lib/node_modules/brace-expansion';

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

/** 2 advisory のどちらかの affected 範囲に居るか (= 受容記録が要る状態か)。 */
function isAffected(version: string): boolean {
	return isBelow(version, FIRST_PATCHED_BOTH);
}

/** `allow-ghsas:` 行から GHSA ID を取り出す (行が無ければ `null`)。 */
function parseAllowGhsas(workflow: string): string[] | null {
	const line = workflow.split('\n').find((l) => l.trimStart().startsWith('allow-ghsas:'));
	if (line === undefined) return null;
	return line
		.split(':')
		.slice(1)
		.join(':')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

type Sources = { version: string; workflow: string; dependabot: string };

/**
 * bundled version から決まる「あるべき状態」と実ファイルの差分を返す (空配列 = 契約充足)。
 *
 * 純関数にしてあるのは、**実ファイルの現状 (affected) だけでなく、まだ来ていない
 * patched 状態 (5.0.9 以上) の挙動も test で固定するため**。「5.0.9 が来たら 3 点を撤去して緑」
 * が仕様であることを、5.0.9 が実在する前に pin できる。
 */
function assessWaiverState(sources: Sources): string[] {
	return isAffected(sources.version) ? affectedProblems(sources) : patchedProblems(sources);
}

/** affected (`< 5.0.9`): waiver / 受容記録 / dependabot pin が揃っていない状態を列挙する。 */
function affectedProblems({ version, workflow, dependabot }: Sources): string[] {
	const problems: string[] = [];
	const ids = parseAllowGhsas(workflow);
	if (!ids?.includes(WAIVED_GHSA)) {
		problems.push(
			`bundled brace-expansion が ${version} (両 advisory の patched = ${FIRST_PATCHED_BOTH.join('.')} 未満) なので` +
				` allow-ghsas: ${WAIVED_GHSA} を撤去できません`,
		);
	}
	// rgw5 を waive すると 5.0.8 の再取込を検知できなくなる。他の未文書化 GHSA も同様に拒否する。
	const undocumented = (ids ?? []).filter((id) => id !== WAIVED_GHSA);
	if (undocumented.length > 0) {
		problems.push(
			`allow-ghsas に個別の根拠が無い GHSA があります: ${undocumented.join(', ')}` +
				` (${ACCEPTED_RISK_GHSA} は waive せず受容記録に留めます)`,
		);
	}
	if (!workflow.includes(ACCEPTED_RISK_GHSA)) {
		problems.push(
			`${ACCEPTED_RISK_GHSA} の受容記録が dependency-review.yml にありません` +
				' (受容理由と解消条件を書いてください)',
		);
	}
	if (!dependabot.includes(ACCEPTED_RISK_GHSA)) {
		problems.push(
			`.github/dependabot.yml に aws-cdk-lib を留める理由 (${ACCEPTED_RISK_GHSA}) がありません` +
				' — 留めていることが記録されないと、次の Dependabot PR で同じ調査を繰り返します',
		);
	}
	return problems;
}

/** patched (`>= 5.0.9`): 3 点を撤去した状態だけが緑 (撤去を機械が要求する)。 */
function patchedProblems({ version, workflow, dependabot }: Sources): string[] {
	const problems: string[] = [];
	if (parseAllowGhsas(workflow) !== null) {
		problems.push(
			`bundled brace-expansion が ${version} になりました。両 advisory とも patched なので` +
				' dependency-review.yml の allow-ghsas と根拠コメント、および本 test file を削除してください',
		);
	}
	if (workflow.includes(ACCEPTED_RISK_GHSA)) {
		problems.push(
			`${ACCEPTED_RISK_GHSA} は解消済みです。dependency-review.yml の受容記録を削除してください`,
		);
	}
	if (dependabot.includes(ACCEPTED_RISK_GHSA)) {
		problems.push(
			'aws-cdk-lib を留める理由が解消しました。.github/dependabot.yml の ignore と' +
				' infra-npm-minor-patch の exclude-patterns を削除して最新 CDK を取り込んでください',
		);
	}
	return problems;
}

function realSources(): Sources {
	const bundled = entriesFor(readLock('infra/package-lock.json'), 'brace-expansion').filter(
		([, meta]) => meta.inBundle === true,
	);
	return {
		version: bundled[0]?.[1].version ?? '',
		workflow: readText('.github/workflows/dependency-review.yml'),
		dependabot: readText('.github/dependabot.yml'),
	};
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
		const wf = readText('.github/workflows/dependency-review.yml');
		expect(wf).toContain(`allow-ghsas: ${WAIVED_GHSA}`);
		// 根拠なしの waiver を後から足せないようにする (#4030 class B と同じ「理由の機械強制」)
		expect(wf).toContain('#4017');
		expect(wf).toContain('撤去条件');
		// 撤去条件は「両 advisory が解消する version」で書かれていること。
		// 5.0.8 を撤去条件に据えた旧記述は GHSA-rgw5-rvv9-x895 の affected を patched と
		// 取り違えており、その通りに撤去すると脆弱な版のまま waiver だけ消えることになる。
		expect(wf).toContain(FIRST_PATCHED_BOTH.join('.'));
	});

	// waiver の根拠は「development scope は元々検査対象外」に依存している。
	// fail-on-scopes の既定が変わる / 誰かが development を足すと根拠が黙って崩れる。
	it('[W3] fail-on-scopes が runtime に固定されている', () => {
		const wf = readText('.github/workflows/dependency-review.yml');
		expect(wf).toMatch(/^\s*fail-on-scopes:\s*runtime\s*$/m);
	});

	it('[W4] waiver は 1 件だけ (GHSA の追加は個別に根拠を要する)', () => {
		const ids = parseAllowGhsas(readText('.github/workflows/dependency-review.yml'));
		expect(ids, 'allow-ghsas 行が見つからない').not.toBeNull();
		// ACCEPTED_RISK_GHSA を足すと 5.0.8 の再取込を検知できなくなる (assessWaiverState と同契約)
		expect(ids).toEqual([WAIVED_GHSA]);
	});

	// **撤去を機械が要求するための検査 (PO 決裁 条件 1、ADR-0061 fitness function)。**
	// `[W2]` は「撤去条件が workflow に書かれている」ことしか見ないため、誰も aws-cdk-lib の
	// リリースを追わなければ waiver は恒久化する。bundled version が両 advisory の patched
	// (5.0.9 以上) に到達した瞬間、本 test は「waiver を消せ」という指示に変わる。
	it('[W5] bundled brace-expansion の version と waiver / 受容記録の状態が整合している', () => {
		const lock = readLock('infra/package-lock.json');
		// root lock の entry と取り違えないよう、infra lock の **bundled** entry のみを対象にする
		// (aws-cdk-lib が同梱する実体 = `node_modules/aws-cdk-lib/node_modules/brace-expansion`)。
		const bundled = entriesFor(lock, 'brace-expansion').filter(
			([, meta]) => meta.inBundle === true,
		);
		expect(
			bundled.map(([path]) => path),
			'aws-cdk-lib の bundled brace-expansion が infra lock から消えたら waiver を見直す',
		).toEqual([BUNDLED_PATH]);

		const version = bundled[0]?.[1].version ?? '';
		expect(version, 'bundled entry に version がない').not.toBe('');

		expect(
			assessWaiverState(realSources()),
			[
				`bundled brace-expansion は ${version} です。file 冒頭の §「状態は version から機械的に決まる」を読んでください。`,
				`- ${FIRST_PATCHED_BOTH.join('.')} 未満 (= どちらかの advisory の affected): waiver / 受容記録 / dependabot ignore を揃えたままにする。`,
				`  bound を緩めて受容記録ごと消すのは不可 (ADR-0006)。`,
				`- ${FIRST_PATCHED_BOTH.join('.')} 以上: 両 advisory とも patched。同じ PR で waiver・受容記録・ignore・本 test file を削除すれば緑になる。`,
			].join('\n'),
		).toEqual([]);
	});

	it('[W6] GHSA-rgw5-rvv9-x895 は waive せず、受容理由と解消条件が記録されている', () => {
		const wf = readText('.github/workflows/dependency-review.yml');
		expect(wf).toContain(ACCEPTED_RISK_GHSA);
		// 「なぜ受容してよいか」= 本番 runtime に載らない経路であること
		expect(wf).toContain('受容');
		expect(wf).toContain('解消条件');
		// 「いつ解消するか」= 5.0.9 を bundle した aws-cdk-lib の登場
		expect(wf).toContain(FIRST_PATCHED_BOTH.join('.'));
		// 出口の手立て: Dependabot が毎週 2.263.x を再提案して同じ調査を繰り返させないための pin
		const db = readText('.github/dependabot.yml');
		expect(db).toContain(ACCEPTED_RISK_GHSA);
		expect(db).toContain('aws-cdk-lib');
	});

	// 「5.0.9 以上になったら通る」ことの固定。実ファイルがまだ affected のうちに、
	// **patched 到達時の契約 (3 点撤去で緑)** を pin しておく。旧実装はここが逆向きで、
	// 5.0.9 を bundle した aws-cdk-lib が出た瞬間に本 gate が修正の取り込みを止める形だった。
	it('[W7] version ごとの契約 (5.0.9 で waiver / 受容記録 / ignore を撤去すれば緑)', () => {
		const withWaiver = [
			`          allow-ghsas: ${WAIVED_GHSA}`,
			`          # 受容: ${ACCEPTED_RISK_GHSA} / 解消条件: 5.0.9 を bundle した aws-cdk-lib`,
		].join('\n');
		const dependabotWithPin = `      # ${ACCEPTED_RISK_GHSA} のため aws-cdk-lib を留める\n      - dependency-name: "aws-cdk-lib"`;

		// affected 側: 3 点が揃っていれば緑 / 欠けたら赤
		for (const version of ['5.0.7', '5.0.8']) {
			expect(
				assessWaiverState({ version, workflow: withWaiver, dependabot: dependabotWithPin }),
				`${version} は affected なので受容記録つきで緑になるべき`,
			).toEqual([]);
			expect(
				assessWaiverState({ version, workflow: withWaiver, dependabot: '' }),
				`${version} で ignore の理由が消えたら赤になるべき`,
			).not.toEqual([]);
			expect(
				assessWaiverState({
					version,
					workflow: `          allow-ghsas: ${WAIVED_GHSA}`,
					dependabot: dependabotWithPin,
				}),
				`${version} で受容記録が消えたら赤になるべき`,
			).not.toEqual([]);
		}

		// patched 側: 3 点を撤去した状態だけが緑 (= 修正版の取り込みを止めない)
		for (const version of ['5.0.9', '5.0.10', '5.1.0', '6.0.0']) {
			expect(
				assessWaiverState({
					version,
					workflow: '          fail-on-scopes: runtime',
					dependabot: '',
				}),
				`${version} は両 advisory とも patched なので撤去済みなら緑になるべき`,
			).toEqual([]);
			expect(
				assessWaiverState({ version, workflow: withWaiver, dependabot: dependabotWithPin }),
				`${version} で waiver が残っていたら撤去を要求すべき`,
			).not.toEqual([]);
		}

		// rgw5 を allow-ghsas に足す (= 5.0.8 の再取込を検知できなくする) のは affected でも不可
		expect(
			assessWaiverState({
				version: '5.0.7',
				workflow: `          allow-ghsas: ${WAIVED_GHSA}, ${ACCEPTED_RISK_GHSA}\n          # 受容 / 解消条件`,
				dependabot: dependabotWithPin,
			}),
		).not.toEqual([]);
	});
});
