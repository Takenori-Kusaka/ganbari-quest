// tests/unit/architecture/dsql-loop-sequential-write-fitness.test.ts
// Issue #3682 AC1 / ADR-0065 原則 2 (N+1 禁止・write は束ねる) の機械強制
//
// **ADR-0065 原則 2**: DSQL は write txn ごとに Transaction minimum 0.05 WriteDPU が課金される
// (#3425 staging 実測)。ループ内で `await repo.insertX(...)` を逐次実行すると、内容に関わらず
// 0.05 × N WriteDPU が課金されるため、同一操作の複数 write は単一 txn / bulk repo call に束ねる
// (模範 = recordActivityCore #3541 / bulk-import 3,000 行チャンク §6.4)。
//
// **検出器 (fitness#7 dsql-txn-work-allowlist.test.ts と同型の TS AST 走査)**:
//   ループ (for / for-of / for-in / for-await-of / while / do) の body 内にある
//   AwaitExpression のうち、callee 末尾 method 名が write 系 prefix (WRITE_METHOD_RE) に
//   一致するものを「ループ内逐次 write」として計数する。
//   - `runInTransaction(async (tx) => { for (...) await tx.insert(...) })` は単一 txn に
//     束ねられた正当形のため、work param binding への call は除外する
//   - `// dpu2-allow: <理由>` を await 行 or 直上行に置けば明示除外 (fitness#7 gap 3 と同機構。
//     cross-tenant cron の per-tenant txn 分離が正しいケース / 非 DB write 等に使う)
//
// **ratchet 方式 (base-token-routes-ratchet.test.ts と同型)**:
//   既存違反は LOOP_WRITE_BASELINE に file × method × count で pin し、実測との完全一致を要求する。
//   - 増加 → 新規のループ内逐次 write。bulk repo call / 単一 txn へ束ねるか、正当な例外なら
//     dpu2-allow コメント (理由必須) を付ける
//   - 減少 → 違反を解消したら baseline も下げる (ratchet down を記録する)
//   baseline 残存分の解消は ADR-0065 原則 2 のレビュー基準 + 実測 (#3682 AC2) で個別判断する。
//
// **検出範囲の限界 (静的解析の制約、ADR-0065 §機械強制の適用状況)**:
//   - helper 関数経由の transitive write (`for (...) await processChild(...)`) は method 名が
//     write 系でない限り検出不能 (fitness#7 と同じ理由で静的追跡不能)。レビュー基準で担保
//   - `await Promise.all(items.map((x) => repo.insert(x)))` の並行 N txn は await 直下が
//     `Promise.all` のため検出対象外 (並行でも txn minimum × N は同じだが、別形状のため scope 外)

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVICES_DIR = resolve(REPO_ROOT, 'src/lib/server/services');

/** write 系 repo method の prefix。camelCase 継続 ([A-Z_0-9]) を要求し、Map#set / Set#add 等の
 * 単語単体 method は対象外にする。read 系 (find/get/list/count) と送信系 (send*) は含めない。 */
const WRITE_METHOD_RE =
	/^(insert|create|upsert|update|delete|remove|record|save|persist|issue|archive|restore|copy|mark|import|set|add|increment|decrement)[A-Z_0-9]/;

// ── baseline (既存違反の pin、2026-07-19 採取。減らしたら本表も下げる) ──
// 値 = file 内の「ループ body 中の awaited write call」の method 名別出現数。
// S3 / Cognito 等の非 DSQL write (saveFile / deleteFile / deleteCognitoUser 等) も
// 検出上は含まれる (静的には区別不能)。新規追加が非 DB write なら dpu2-allow を付けること。
const LOOP_WRITE_BASELINE: Record<string, Record<string, number>> = {
	'account-deletion-service.ts': {
		deleteCognitoUser: 1,
		deleteInvite: 1,
		deleteMembership: 1,
		deleteUser: 1,
		updateInviteStatus: 1,
	},
	'activity-import-service.ts': {
		insertActivitiesBulk: 1,
	},
	'certificate-service.ts': {
		issueCertificate: 2,
	},
	'challenge-set-import-service.ts': {
		createChildChallengesBulk: 1,
	},
	'checklist-template-import-service.ts': {
		addTemplateItem: 2,
	},
	'child-activity-copy-service.ts': {
		copyActivitiesAcrossChildren: 1,
	},
	'child-challenge-service.ts': {
		markCompleted: 1,
		// #4686: とりけしの巻き戻し (revertChildChallengeProgress) が、記録側
		// updateChildChallengeProgress と対称な形で同 method を 1 箇所使う (1 → 2)。
		// どちらも「当該 child の期間内 challenge」= 実測 1〜3 行のループで、bulk repo API が
		// 無いため既存の記録側と同じ形状で pin する (解消時は両方まとめて bulk 化する)。
		updateProgress: 2,
	},
	'child-reward-copy-service.ts': {
		insertSpecialReward: 1,
	},
	'child-service.ts': {
		deleteFile: 2,
	},
	'cloud-export-service.ts': {
		saveFile: 1,
		updateStatus: 3,
	},
	'consent-service.ts': {
		recordConsent: 1,
	},
	'daily-mission-service.ts': {
		insertDailyMission: 1,
	},
	'evaluation-service.ts': {
		updateStatus: 2,
	},
	'grace-period-service.ts': {
		deleteOwnerFullDelete: 1,
		deleteOwnerOnlyAccount: 1,
	},
	'import-service.ts': {
		importOneChecklistTemplate: 1,
		importOneSpecialReward: 1,
		insertActivity: 1,
		insertChild: 1,
		insertEvaluation: 1,
		insertForRestore: 6,
		insertOverrideForRestore: 1,
		insertPointLedger: 1,
		insertRedemptionForRestore: 1,
		insertRestDayForRestore: 1,
		insertTemplateItem: 1,
		saveFile: 1,
		setSetting: 1,
		upsertLog: 1,
		upsertStatus: 1,
		upsertStreak: 1,
	},
	'notification-service.ts': {
		deleteByEndpoint: 2,
	},
	'pmf-survey-service.ts': {
		incrementMarketingEmailCount: 1,
		setSetting: 1,
	},
	'questionnaire-service.ts': {
		addTemplateItem: 1,
		createTemplate: 1,
	},
	'resource-archive-service.ts': {
		archiveChecklistTemplates: 1,
	},
	'retention-cleanup-service.ts': {
		deleteActivityLogsBeforeDate: 1,
		deletePointLedgerBeforeDate: 1,
		deleteStatusHistoryBeforeDate: 1,
	},
	'reward-set-import-service.ts': {
		importRewardSet: 1,
		insertSpecialReward: 1,
	},
	'tenant-cleanup-service.ts': {
		deleteActivity: 1,
		deleteByChild: 1,
		deleteByEndpoint: 1,
		deleteById: 2,
		deleteByPrefix: 1,
		deleteChild: 1,
		deleteChildFiles: 1,
	},
	'voice-service.ts': {
		setActive: 1,
	},
};

// ── 検出器 ──

const isLoop = (n: ts.Node): boolean =>
	ts.isForOfStatement(n) ||
	ts.isForInStatement(n) ||
	ts.isForStatement(n) ||
	ts.isWhileStatement(n) ||
	ts.isDoStatement(n);

function calleeMethodName(expr: ts.CallExpression): string | null {
	const c = expr.expression;
	if (ts.isPropertyAccessExpression(c)) return c.name.text;
	if (ts.isIdentifier(c)) return c.text;
	return null;
}

/** callee チェーンを根の識別子まで unwrap する (fitness#7 の isTxBoundCall と同手法)。 */
function rootIdentifier(expr: ts.CallExpression): string | null {
	let c: ts.Expression = expr.expression;
	for (;;) {
		if (ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c)) c = c.expression;
		else if (ts.isCallExpression(c)) c = c.expression;
		else break;
	}
	return ts.isIdentifier(c) ? c.text : null;
}

interface LoopWriteHit {
	file: string;
	line: number;
	method: string;
}

/** node が `runInTransaction(inline work)` の callsite なら work param 名を返す (それ以外 null)。 */
function txWorkParamName(node: ts.Node): string | null {
	if (!ts.isCallExpression(node)) return null;
	const callee = node.expression;
	const isRunInTx =
		(ts.isPropertyAccessExpression(callee) && callee.name.text === 'runInTransaction') ||
		(ts.isIdentifier(callee) && callee.text === 'runInTransaction');
	const work = node.arguments[0];
	if (!isRunInTx || !work || !(ts.isArrowFunction(work) || ts.isFunctionExpression(work))) {
		return null;
	}
	const p = work.parameters[0]?.name;
	return p && ts.isIdentifier(p) ? p.text : null;
}

/** ループ内 awaited call が「逐次 write 違反」か判定する (tx-bound は単一 txn のため除外)。 */
function isLoopWriteViolation(call: ts.CallExpression, txRoots: ReadonlySet<string>): boolean {
	const method = calleeMethodName(call);
	if (!method || !WRITE_METHOD_RE.test(method)) return false;
	const root = rootIdentifier(call);
	return !(root !== null && txRoots.has(root));
}

function findLoopSequentialWrites(sourceText: string, fileName: string): LoopWriteHit[] {
	const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
	const lines = sourceText.split('\n');
	const hits: LoopWriteHit[] = [];

	const isExempted = (node: ts.Node): boolean => {
		const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
		const current = lines[line] ?? '';
		const prev = line > 0 ? (lines[line - 1] ?? '') : '';
		return /dpu2-allow:/.test(current) || /dpu2-allow:/.test(prev);
	};

	const visit = (node: ts.Node, loopDepth: number, txRoots: ReadonlySet<string>) => {
		const workParam = txWorkParamName(node);
		const nextTx = workParam ? new Set([...txRoots, workParam]) : txRoots;
		if (loopDepth > 0 && ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
			const call = node.expression;
			if (isLoopWriteViolation(call, nextTx) && !isExempted(node)) {
				const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
				hits.push({ file: fileName, line: line + 1, method: calleeMethodName(call) ?? '' });
			}
		}
		const nd = isLoop(node) ? loopDepth + 1 : loopDepth;
		ts.forEachChild(node, (ch) => visit(ch, nd, nextTx));
	};
	visit(sf, 0, new Set());
	return hits;
}

function walkTsFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) walkTsFiles(full, acc);
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(full);
	}
	return acc;
}

function measureServices(): Record<string, Record<string, number>> {
	const measured: Record<string, Record<string, number>> = {};
	for (const file of walkTsFiles(SERVICES_DIR, [])) {
		const rel = relative(SERVICES_DIR, file).replace(/\\/g, '/');
		const hits = findLoopSequentialWrites(readFileSync(file, 'utf-8'), rel);
		for (const hit of hits) {
			measured[rel] ??= {};
			measured[rel][hit.method] = (measured[rel][hit.method] ?? 0) + 1;
		}
	}
	return measured;
}

describe('ADR-0065 原則 2 fitness: ループ内逐次 write の ratchet (#3682 AC1)', () => {
	it('[armed] services が実在し検出対象が空でない (armed-before-use)', () => {
		const files = walkTsFiles(SERVICES_DIR, []);
		expect(files.length).toBeGreaterThan(30);
	});

	it('[main] services のループ内 awaited write が baseline と完全一致する (増減とも本表を更新)', () => {
		const measured = measureServices();
		expect(
			measured,
			[
				'ループ内逐次 write の実測が LOOP_WRITE_BASELINE と一致しません (ADR-0065 原則 2)。',
				'- 増加した場合: 逐次 `await repo.write()` は txn minimum 0.05 WriteDPU × N を課金する。',
				'  bulk repo call / runInTransaction 単一 txn へ束ねるか、正当な例外 (cross-tenant cron の',
				'  per-tenant txn 分離 / 非 DB write) なら `// dpu2-allow: <理由>` を await 行に付ける。',
				'- 減少した場合: 解消を記録するため baseline の該当 count を下げる (ratchet down)。',
			].join('\n'),
		).toEqual(LOOP_WRITE_BASELINE);
	});

	// ── 非トートロジー証明 (検出器が本当に検出することの fixture 検証) ──

	it('ループ内の awaited repo write を検出する (for-of / while / for-await-of)', () => {
		const cases: string[] = [
			'async function f() { for (const r of rows) { await repo.insertActivity(r); } }',
			'async function f() { while (queue.length) { await repo.deleteById(queue.pop()); } }',
			'async function f() { for await (const r of stream) { await repo.upsertStatus(r); } }',
		];
		for (const src of cases) {
			expect(findLoopSequentialWrites(src, 'fixture.ts').length, src).toBeGreaterThan(0);
		}
	});

	it('read 系 / 送信系 / 単語単体 method / ループ外 write は検出しない', () => {
		const ok: string[] = [
			'async function f() { for (const r of rows) { await repo.findActivitiesByChild(r); } }',
			'async function f() { for (const r of rows) { await sendTrialEndingEmail(r); } }',
			'async function f() { for (const r of rows) { seen.add(r); map.set(r.id, r); } }',
			'async function f() { await repo.insertActivitiesBulk(rows); }',
		];
		for (const src of ok) {
			expect(findLoopSequentialWrites(src, 'fixture.ts'), src).toEqual([]);
		}
	});

	it('runInTransaction work 内の tx-bound write ループは単一 txn のため検出しない', () => {
		const ok = `async function f() {
			await runner.runInTransaction(async (tx) => {
				for (const r of rows) { await tx.insert(children).values(r); }
			});
		}`;
		expect(findLoopSequentialWrites(ok, 'fixture.ts')).toEqual([]);
		// tx binding 以外の write は runInTransaction 内のループでも検出する (別 txn / 別 db)
		const ng = `async function f() {
			await runner.runInTransaction(async (tx) => {
				for (const r of rows) { await otherRepo.insertActivity(r); }
			});
		}`;
		expect(findLoopSequentialWrites(ng, 'fixture.ts').length).toBeGreaterThan(0);
	});

	it('`// dpu2-allow:` コメント (直上行 / 同一行末尾) で明示除外できる', () => {
		const above = `async function f() {
			for (const t of tenants) {
				// dpu2-allow: cross-tenant cron は per-tenant txn 分離が正しい (OCC 競合回避)
				await repo.deleteActivityLogsBeforeDate(t.id, cutoff);
			}
		}`;
		expect(findLoopSequentialWrites(above, 'fixture.ts')).toEqual([]);
		const inline = `async function f() {
			for (const t of tenants) {
				await repo.deleteActivityLogsBeforeDate(t.id, cutoff); // dpu2-allow: per-tenant txn 分離
			}
		}`;
		expect(findLoopSequentialWrites(inline, 'fixture.ts')).toEqual([]);
		// dpu2-allow の無い 2 件目は依然検出する (除外は明示行のみ)
		const partial = `async function f() {
			for (const t of tenants) {
				// dpu2-allow: 1 件目のみ除外
				await repo.deleteActivityLogsBeforeDate(t.id, cutoff);
				await repo.deletePointLedgerBeforeDate(t.id, cutoff);
			}
		}`;
		expect(findLoopSequentialWrites(partial, 'fixture.ts').length).toBe(1);
	});

	it('[baseline-live] baseline の全 file が実在する (dead entry 検出)', () => {
		const dead = Object.keys(LOOP_WRITE_BASELINE).filter((rel) => {
			try {
				readFileSync(resolve(SERVICES_DIR, rel), 'utf-8');
				return false;
			} catch {
				return true;
			}
		});
		expect(
			dead,
			`baseline に実在しない file があります (rename / 削除時は baseline も更新):\n${dead.join('\n')}`,
		).toEqual([]);
	});
});
