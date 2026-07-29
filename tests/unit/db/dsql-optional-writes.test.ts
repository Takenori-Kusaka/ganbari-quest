// tests/unit/db/dsql-optional-writes.test.ts
// EPIC #3424 / 実装 #3541 (#N4-2 Phase C cycle 2) / 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#10,#11
//
// optional 書込の隔離 3 点セット (§8: optional は core commit 後の独立 mini-txn):
//   1. optional の point 付与も「point_ledger INSERT + total_point 加算」を 1 txn にする
//      (§5 P7 不変条件を core/optional 問わず維持 → fitness#14 が 0 drift)。
//      #4039: 検証対象を point 書込単一プリミティブ createPointEntryWriter に統一した
//      (旧 grantOptionalPoints は本 writer と同義の重複プリミティブで、live な optional 経路は
//       元から本 writer を通っていたため撤去。不変条件のカバレッジは本 test が引き継ぐ)
//   2. fitness#10 (TOCTOU 防止): mission bonus は count-then-insert だと double-tap/OCC 下で
//      二重付与 (fitness#14 は self-consistent で検出不能)。daily_missions の自然複合 PK 行への
//      conditional UPDATE (completed=false→true) を serialization point にし、
//      「最後の 1 件を flip した txn だけが daily bonus を付与」で exactly-once を構造化
//   3. fitness#11 (欠落の可観測化): optional 失敗は core を巻き込まず swallow するが、
//      行が書かれない欠落は fitness#14 drift=0 で検出不能 → 失敗時に観測カウンタを emit
//
// ── Canon TDD test list ──
//   [O1] optional 付与: ledger + total_point が 1 txn (drift 0)
//   [O2] 対象 child 不在 → throw + ledger も rollback (total_point 共更新不能な片肺書込を禁止)
//   [F10-1] 同一 mission への二連打: completed 遷移 1 回のみ、bonus 1 回のみ
//   [F10-2] 複数 mission: 最後の 1 件を flip した呼び出しだけが daily bonus を付与
//   [F10-3] 全完了後の再呼び出し: bonus 再付与なし (rowCount=0 経路)
//   [F10-4] remaining SELECT の FOR UPDATE (write skew ガード) が集約エラーなく allComplete を返す
//   [F11-1] optional 失敗: 例外 swallow + onFailure カウンタ emit + null 返却
//   [F11-2] optional 成功: onFailure 非発火、結果を返す

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';

const FAMILY = '00000000-0000-4000-8000-0000000000e1';
const NOW = '2026-07-02T10:00:00+00:00';
const TODAY = '2026-07-02';

describe('#N4-2 cycle2: optional 書込の隔離 (§8 / fitness#10,#11)', () => {
	let client: PGlite;
	let db: ReturnType<typeof drizzle>;
	let seq = 0;

	beforeAll(async () => {
		client = new PGlite();
		db = drizzle(client);
		const ddl = [
			`CREATE TABLE children (
				family_id uuid NOT NULL, child_id uuid NOT NULL,
				total_point integer NOT NULL DEFAULT 0,
				updated_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (family_id, child_id))`,
			`CREATE TABLE point_ledger (
				family_id uuid NOT NULL, child_id uuid NOT NULL,
				ledger_id uuid NOT NULL DEFAULT gen_random_uuid(),
				amount integer NOT NULL, type text NOT NULL, description text,
				reference_id text, recorded_date text NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (family_id, child_id, ledger_id))`,
			`CREATE TABLE daily_missions (
				family_id uuid NOT NULL, child_id uuid NOT NULL,
				mission_date text NOT NULL, activity_id uuid NOT NULL,
				completed boolean NOT NULL DEFAULT false,
				completed_at timestamptz,
				PRIMARY KEY (family_id, child_id, mission_date, activity_id))`,
		];
		for (const stmt of ddl) await db.execute(sql.raw(stmt));
	});
	afterAll(async () => {
		await client.close();
	});

	const newIds = async () => {
		seq++;
		const childId = `d0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
		await db.execute(
			sql`INSERT INTO children (family_id, child_id) VALUES (${FAMILY}, ${childId})`,
		);
		const act = (n: number) => `b000000${n}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
		return { childId, act };
	};

	const makeRunner = async () => {
		const { createDsqlTransactionRunner } = await import(
			'../../../src/lib/server/db/dsql/run-in-transaction'
		);
		return createDsqlTransactionRunner(db, { maxAttempts: 3, baseDelayMs: 1 });
	};

	const totalPoint = async (childId: string) =>
		(
			(
				await db.execute(
					sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
				)
			).rows[0] as { total_point: number }
		).total_point;

	const ledgerRows = async (childId: string, type: string) =>
		(
			await db.execute(
				sql`SELECT amount FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId} AND type = ${type}`,
			)
		).rows as { amount: number }[];

	const optionalPointWriter = async () => {
		const { createPointEntryWriter } = await import('../../../src/lib/server/db/dsql/point-write');
		return createPointEntryWriter(await makeRunner());
	};

	it('[O1] optional 付与: ledger INSERT + total_point 加算が 1 txn (§5 P7)', async () => {
		const { findTotalPointDrift } = await import('../../../src/lib/server/db/dsql/derived-drift');
		const { childId } = await newIds();
		const grant = await optionalPointWriter();
		await grant(
			{ childId: asChildId(childId), amount: 7, type: 'combo_bonus', description: 'コンボ' },
			FAMILY,
		);
		expect(await totalPoint(childId)).toBe(7);
		expect(await ledgerRows(childId, 'combo_bonus')).toHaveLength(1);
		expect(await findTotalPointDrift(db)).toEqual([]);
	});

	it('[O2] 対象 child 不在 → throw + ledger も rollback (片肺書込禁止)', async () => {
		const ghost = 'd9999999-0000-4000-8000-000000000999';
		const grant = await optionalPointWriter();
		await expect(
			grant(
				{ childId: asChildId(ghost), amount: 5, type: 'combo_bonus', description: 'x' },
				FAMILY,
			),
		).rejects.toThrow();
		expect(await ledgerRows(ghost, 'combo_bonus')).toHaveLength(0);
	});

	it('[F10-1] 同一 mission 二連打: completed 遷移 1 回・bonus 1 回 (conditional UPDATE が serialization point)', async () => {
		const { completeMissionAndMaybeGrantBonus } = await import(
			'../../../src/lib/server/db/dsql/daily-mission-complete'
		);
		const { childId, act } = await newIds();
		await db.execute(sql`
			INSERT INTO daily_missions (family_id, child_id, mission_date, activity_id)
			VALUES (${FAMILY}, ${childId}, ${TODAY}, ${act(1)})
		`);
		const runner = await makeRunner();
		const input = {
			familyId: FAMILY,
			childId,
			missionDate: TODAY,
			activityId: act(1),
			bonusPoints: 20,
			bonusDescription: 'ミッション達成',
			now: NOW,
		};
		const first = await completeMissionAndMaybeGrantBonus(runner, input);
		const second = await completeMissionAndMaybeGrantBonus(runner, input);
		expect(first).toEqual({ completedNow: true, allComplete: true, bonusGranted: true });
		expect(second).toEqual({ completedNow: false, allComplete: true, bonusGranted: false });
		// fitness#10 の核: 二連打でも bonus ledger は 1 行のみ (fitness#14 では検出不能な二重付与)
		expect(await ledgerRows(childId, 'mission_bonus')).toHaveLength(1);
		expect(await totalPoint(childId)).toBe(20);
	});

	it('[F10-2][F10-3] 複数 mission: 最後の 1 件を flip した呼び出しだけが daily bonus を付与', async () => {
		const { completeMissionAndMaybeGrantBonus } = await import(
			'../../../src/lib/server/db/dsql/daily-mission-complete'
		);
		const { childId, act } = await newIds();
		for (const n of [1, 2, 3]) {
			await db.execute(sql`
				INSERT INTO daily_missions (family_id, child_id, mission_date, activity_id)
				VALUES (${FAMILY}, ${childId}, ${TODAY}, ${act(n)})
			`);
		}
		const runner = await makeRunner();
		const base = {
			familyId: FAMILY,
			childId,
			missionDate: TODAY,
			bonusPoints: 30,
			bonusDescription: '全ミッション達成',
			now: NOW,
		};
		const r1 = await completeMissionAndMaybeGrantBonus(runner, { ...base, activityId: act(1) });
		const r2 = await completeMissionAndMaybeGrantBonus(runner, { ...base, activityId: act(2) });
		const r3 = await completeMissionAndMaybeGrantBonus(runner, { ...base, activityId: act(3) });
		expect(r1).toMatchObject({ completedNow: true, allComplete: false, bonusGranted: false });
		expect(r2).toMatchObject({ completedNow: true, allComplete: false, bonusGranted: false });
		expect(r3).toMatchObject({ completedNow: true, allComplete: true, bonusGranted: true });
		// 全完了後の再呼び出し (別 activity で二連打相当) も bonus 再付与なし
		const again = await completeMissionAndMaybeGrantBonus(runner, { ...base, activityId: act(2) });
		expect(again).toMatchObject({ completedNow: false, bonusGranted: false });
		expect(await ledgerRows(childId, 'mission_bonus')).toHaveLength(1);
		expect(await totalPoint(childId)).toBe(30);
	});

	it('[F10-4] remaining SELECT が FOR UPDATE を伴っても構文/集約エラーなく allComplete を返す (write skew ガード)', async () => {
		// QM #3546 BLOCK: remaining カウント SELECT に FOR UPDATE を付与し他 mission 行を
		// write-intent 化して write skew (異なる 2 行の並行完了で daily bonus 永久欠落) を
		// OCC 40001 で防ぐ。ただし `count(*) ... FOR UPDATE` は PostgreSQL/PGlite が
		// "FOR UPDATE is not allowed with aggregate functions" で拒否するため、実装は
		// 内側サブクエリで行を FOR UPDATE 確定 → 外側で count する形を採る。
		// 本テストはその SQL が構文/集約エラーを出さず、かつ allComplete 判定が正しいことを保証する。
		//
		// 既知制約 (#3545 と同種): PGlite は単一接続のため TxnA/TxnB の真の並行実行
		// (2 別 txn がミリ秒で重なり互いの completed=false 行を snapshot 上で見る状況) を
		// 再現できない。よって「FOR UPDATE 有無で 40001 が発生する/しない」の直接検証は不可。
		// ここでは (a) FOR UPDATE 付き SQL が実行可能であること (集約エラー回帰の恒久ガード) と
		// (b) 未完了残ありでは allComplete=false / 全完了で true になる意味論の 2 点を検証する。
		const { completeMissionAndMaybeGrantBonus } = await import(
			'../../../src/lib/server/db/dsql/daily-mission-complete'
		);
		const { childId, act } = await newIds();
		for (const n of [1, 2]) {
			await db.execute(sql`
				INSERT INTO daily_missions (family_id, child_id, mission_date, activity_id)
				VALUES (${FAMILY}, ${childId}, ${TODAY}, ${act(n)})
			`);
		}
		const runner = await makeRunner();
		const base = {
			familyId: FAMILY,
			childId,
			missionDate: TODAY,
			bonusPoints: 15,
			bonusDescription: '全ミッション達成',
			now: NOW,
		};
		// 1 件目 flip: 残 1 → FOR UPDATE 付き remaining SELECT が集約エラーなく allComplete=false を返す
		const r1 = await completeMissionAndMaybeGrantBonus(runner, { ...base, activityId: act(1) });
		expect(r1).toMatchObject({ completedNow: true, allComplete: false, bonusGranted: false });
		// 2 件目 (最後) flip: 残 0 → allComplete=true, bonus 付与
		const r2 = await completeMissionAndMaybeGrantBonus(runner, { ...base, activityId: act(2) });
		expect(r2).toMatchObject({ completedNow: true, allComplete: true, bonusGranted: true });
		expect(await ledgerRows(childId, 'mission_bonus')).toHaveLength(1);
		expect(await totalPoint(childId)).toBe(15);
	});

	it('[F11-1] optional 失敗: swallow + onFailure カウンタ emit + null (fitness#11 可観測化)', async () => {
		const { runOptionalWrite } = await import(
			'../../../src/lib/server/db/dsql/optional-write-guard'
		);
		const failures: { name: string; message: string }[] = [];
		const result = await runOptionalWrite(
			'combo_bonus',
			async () => {
				throw new Error('DSQL down');
			},
			(name, err) => failures.push({ name, message: (err as Error).message }),
		);
		expect(result).toBeNull();
		expect(failures).toEqual([{ name: 'combo_bonus', message: 'DSQL down' }]);
	});

	it('[F11-2] optional 成功: onFailure 非発火、結果を返す', async () => {
		const { runOptionalWrite } = await import(
			'../../../src/lib/server/db/dsql/optional-write-guard'
		);
		let failed = 0;
		const result = await runOptionalWrite(
			'mission_bonus',
			async () => 42,
			() => failed++,
		);
		expect(result).toBe(42);
		expect(failed).toBe(0);
	});
});
