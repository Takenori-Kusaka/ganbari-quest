// tests/unit/architecture/churn-status-predicate-ssot.test.ts
// #3987: チャーン (契約終了) 判定を `isChurnedContract` の単一 SSOT に閉じ込める fitness function。
//
// 背景: `terminated` は退会 (アカウント削除) を意味し、物理削除で families 行ごと消えるため
// 通常運用では観測されない。それを直接 churn 判定に使っていた service が 3 本あり、いずれも
// **恒常的に 0** を返していた。同 class の 4 本目が生まれないよう、service 層での
// `terminated` / `suspended` の直接比較を禁止する (ADR-0061 same-class-N→guard)。
//
// ── 検出方法: 反転方式 (allowlist) ──────────────────────────────────────────────
// 「churn を数える service を列挙して見に行く」方式は、5 本目の新規 service を素通りさせる
// (列挙側が増えない限り検査が広がらない)。よって **`src/lib/server/services/` 配下を全走査**し、
// `terminated` / `suspended` を直接判定している file を violation とし、
// churn 集計ではない正当な用途だけを ALLOWED_DIRECT_STATUS_USE に理由付きで載せる。
//
// ── 本 gate が検出するもの / しないもの (実際の能力、誇張しない) ─────────────────
// 検出する:
//   (1) service 層での `SUBSCRIPTION_STATUS.TERMINATED` / `.SUSPENDED` の参照 (allowlist 外)
//   (2) 同じく **値リテラル直書き** の比較 (`t.status === 'suspended'` / `'terminated' === s` 等)。
//       定数名 grep だけでは原理的に漏れるため、#3987 AC4 の失敗パターンを塞ぐ
//   (3) `isSubscriptionTerminated()` / `isSubscriptionSuspended()` を churn 判定に流用する経路
//   (4) allowlist の腐敗 (rename で死に票化 / churn service が allowlist に紛れ込む)
//   (5) churn を数える service が `isChurnedContract` の import と呼び出しの両方を持つこと
//       ([C4]。実装から呼び出しを消してコメントだけ残す偽装を通さないよう comment 除去後に判定する)
// 検出しない:
//   - `src/lib/server/services/` の外 (routes / repo 層 / cron) で status を直接判定する経路。
//     churn KPI は service 層に閉じている前提。層を跨いだら本 gate の SCAN_DIR を広げること
//   - status 以外の列 (plan / planExpiresAt) から churn を再定義する意味的な迂回

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// 走査 test (scope: 'bounded'、scripts/lib/ci/repo-scan-test-registry.mjs で宣言済、#4085)。
// 走査は service 層の単一サブツリーに閉じているが 110+ file を実読するため、既定 timeout
// (5s、vite.config.ts) だと並列実行の負荷次第で偽陽性 fail になりうる。予防的に明示 timeout を置く。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIR = 'src/lib/server/services';

/**
 * churn / 解約数 / retention を集計する KPI service 群。
 * `isChurnedContract` 経由であることを [C4] が検証する。
 * **新規 service の追加漏れは [C1]-[C3] の反転走査が検出する** (直接比較すれば allowlist 外で落ちる)。
 */
const KPI_SERVICES = [
	'src/lib/server/services/cohort-analysis-service.ts',
	'src/lib/server/services/ops-analytics-service.ts',
	'src/lib/server/services/pricing-trigger-service.ts',
	'src/lib/server/services/stripe-metrics-service.ts',
] as const;

/**
 * `terminated` / `suspended` を直接扱ってよい service と、その理由。
 * churn 集計に使う file をここに足してはならない ([C5] が KPI service の混入を禁止する)。
 */
const ALLOWED_DIRECT_STATUS_USE: Record<string, string> = {
	'src/lib/server/services/stripe-service.ts':
		'契約状態の書き手 (TERMINAL_CONTRACT_STATE / handleSubscriptionUpdated)。読み取り集計ではない',
	'src/lib/server/services/ops-service.ts':
		'/ops の status 内訳表示 (active / grace_period / suspended / terminated の件数)。churn 集計ではない',
};

function read(relPath: string): string {
	return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/** 行コメント / ブロックコメントを落とす (コメント内の言及を violation にしない)。 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function walkTsFiles(dirRelPath: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(path.join(REPO_ROOT, dirRelPath), { withFileTypes: true })) {
		const rel = `${dirRelPath}/${entry.name}`;
		if (entry.isDirectory()) walkTsFiles(rel, acc);
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) acc.push(rel);
	}
	return acc;
}

/** 検出パターン (comment 除去後の 1 行に対して適用する)。 */
const DETECTORS: { id: string; pattern: RegExp }[] = [
	// 定数参照
	{ id: 'SUBSCRIPTION_STATUS.TERMINATED', pattern: /SUBSCRIPTION_STATUS\.TERMINATED/ },
	{ id: 'SUBSCRIPTION_STATUS.SUSPENDED', pattern: /SUBSCRIPTION_STATUS\.SUSPENDED/ },
	// 値リテラル直書き比較 (#3987 AC4 が漏らした形。両辺どちら側でも検出する)
	{ id: "=== 'terminated' / 'suspended'", pattern: /[=!]==\s*['"](?:terminated|suspended)['"]/ },
	{ id: "'terminated' / 'suspended' ===", pattern: /['"](?:terminated|suspended)['"]\s*[=!]==/ },
	// 単一 status 述語の churn 流用
	{ id: 'isSubscriptionTerminated()', pattern: /\bisSubscriptionTerminated\s*\(/ },
	{ id: 'isSubscriptionSuspended()', pattern: /\bisSubscriptionSuspended\s*\(/ },
];

function findViolations(relPath: string): string[] {
	const code = stripComments(read(relPath));
	const violations: string[] = [];
	for (const [index, line] of code.split('\n').entries()) {
		for (const detector of DETECTORS) {
			if (detector.pattern.test(line)) {
				violations.push(`${relPath}:${index + 1} [${detector.id}] ${line.trim()}`);
			}
		}
	}
	return violations;
}

const FAILURE_GUIDE = [
	'service 層で terminated / suspended を直接判定しています。',
	'terminated は退会済みを意味し物理削除で行ごと消えるため、この判定は恒常的に 0 を返す。',
	'suspended は S4 (契約が残り復帰しうる停止) と S5 (契約終了) を兼ねるため、',
	'丸ごと数えると復帰しうるテナントを解約に混ぜる。',
	'→ churn を数えるなら `isChurnedContract(tenant)` を使う (#3987)。',
	'→ churn 集計でない正当な用途なら ALLOWED_DIRECT_STATUS_USE に理由付きで登録する。',
];

describe('#3987: churn 判定 SSOT (isChurnedContract)', () => {
	const scanned = walkTsFiles(SCAN_DIR);

	it('[C0] service 層を走査できている (0 件走査の空振りを防ぐ)', () => {
		expect(scanned.length).toBeGreaterThan(50);
		for (const relPath of KPI_SERVICES) {
			expect(scanned, `${relPath} が走査対象に入っていない`).toContain(relPath);
		}
	});

	it('[C1] allowlist 外の service は terminated / suspended を直接判定しない (定数・値リテラル両方)', () => {
		const violations = scanned
			.filter((relPath) => !(relPath in ALLOWED_DIRECT_STATUS_USE))
			.flatMap(findViolations);
		expect(violations, [...FAILURE_GUIDE, '', ...violations].join('\n')).toEqual([]);
	});

	it('[C2] 検出器が実際に効いている (値リテラル形も含め自己検証)', () => {
		// gate 自身が「何も検出できない正規表現」に劣化していないことを固定する。
		const samples = [
			'if (t.status === SUBSCRIPTION_STATUS.TERMINATED) c += 1;',
			"if (t.status === 'suspended') c += 1;",
			'if (t.status !== "terminated") return;',
			"if ('suspended' === s) return;",
			'if (isSubscriptionTerminated(t.status)) c += 1;',
		];
		for (const sample of samples) {
			expect(
				DETECTORS.some((d) => d.pattern.test(sample)),
				`検出漏れ: ${sample}`,
			).toBe(true);
		}
		// 誤検出しないこと (SSOT 述語の呼び出し / 他 status)
		for (const ok of [
			'if (isChurnedContract(t)) c += 1;',
			'if (t.status === SUBSCRIPTION_STATUS.ACTIVE) c += 1;',
		]) {
			expect(
				DETECTORS.some((d) => d.pattern.test(ok)),
				`誤検出: ${ok}`,
			).toBe(false);
		}
	});

	it('[C3] allowlist の file が全て実在し、実際に直接判定を持つ (死に票 allowlist を許さない)', () => {
		for (const [relPath, reason] of Object.entries(ALLOWED_DIRECT_STATUS_USE)) {
			expect(scanned, `${relPath} が走査対象に存在しない (rename?)`).toContain(relPath);
			expect(reason.length, `${relPath} の除外理由が空`).toBeGreaterThan(10);
			expect(
				findViolations(relPath).length,
				`${relPath} は直接判定を持たないので allowlist から外せる`,
			).toBeGreaterThan(0);
		}
	});

	it('[C4] churn を数える KPI service は isChurnedContract を import して実際に呼んでいる', () => {
		for (const relPath of KPI_SERVICES) {
			const code = stripComments(read(relPath));
			expect(code, `${relPath} が isChurnedContract を import していない`).toMatch(
				/import\s*\{[^}]*isChurnedContract[^}]*\}\s*from/,
			);
			// import 行を除いた実装本体での参照 (コメントだけ残す偽装を通さない)
			const body = code
				.split('\n')
				.filter((line) => !/^\s*import\s/.test(line))
				.join('\n');
			expect(body, `${relPath} が isChurnedContract を呼んでいない`).toMatch(
				/isChurnedContract\s*[(),]/,
			);
		}
	});

	it('[C5] KPI service が allowlist に紛れ込んでいない (除外で黙らせる抜け道を塞ぐ)', () => {
		for (const relPath of KPI_SERVICES) {
			expect(
				relPath in ALLOWED_DIRECT_STATUS_USE,
				`${relPath} は churn 集計 service なので allowlist に載せてはならない`,
			).toBe(false);
		}
	});
});
