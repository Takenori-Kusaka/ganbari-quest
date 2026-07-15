// tests/unit/architecture/ledger-grant-atomicity-fitness.test.ts
// #3284 / #3342 / #3356 (ADR-0061 same-class→guard): 「条件付き状態 flip とポイント台帳書込が
// 別 txn に分かれる」class を機械強制で lock する Architecture Fitness Function。
//
// root class: 「ledger insert と状態更新 (claim flip / redemption approve) が非アトミック +
// 冪等キー欠如」。#3245 (child_challenges atomic getOrCreate) / #3333 (claim-first) /
// #3347 (spendPointsAtomic) / #3541 (recordActivityCore) と同系の再発を、service 層の
// ledger 書込 callsite allowlist で構造的に検出する。
//
// 強制内容:
//   1. service 層の insertPointLedger / insertPointEntry callsite は「無条件付与」経路の
//      allowlist に限定する。新規 callsite が「条件付き状態 flip の成否でポイントを付与する」
//      経路 (claim / redeem / approve 系) なら、flip + ledger を repo 層の単一原子 primitive
//      (例: claimRewardAndGrantPoints / spendPointsAtomic) に実装してから allowlist を更新する。
//   2. 撤去済みの half-primitive (bare claimReward / findPendingByChildAndReward) が
//      interface / service に再導入されないこと (check-then-act TOCTOU class の再発防止)。
//
// allowlist の拡大は「原子性判断を意識的に通過した」証跡になる (route-db-boundary と同型の
// baseline 運用。縮小は歓迎、無断拡大は CI fail)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVICES_DIR = resolve(REPO_ROOT, 'src/lib/server/services');

/**
 * service 層で ledger 直接書込 (insertPointLedger / insertPointEntry) が許容される file。
 * いずれも「条件付き flip の成否に依存しない無条件付与 / 取消」経路であることが登録条件。
 * 条件付き flip とペアになる付与は repo 層の原子 primitive に実装すること (#3284/#3342)。
 */
const LEDGER_WRITE_ALLOWLIST = new Set([
	'activity-log-service.ts', // 記録 / キャンセル (log 行と 1:1、冪等キー = log id)
	'activity-service.ts', // must 完遂ボーナス (日次冪等は countPointLedgerEntriesByTypeAndDate)
	'birthday-bonus-service.ts', // 誕生日ボーナス (年次冪等 check 済)
	'checklist-service.ts', // チェックリスト完遂ボーナス
	'cheer-service.ts', // 応援スタンプ付与
	'combo-service.ts', // コンボボーナス (無条件加算)
	'daily-mission-service.ts', // ミッションボーナス (既存行 check + 差分加算)
	'evaluation-service.ts', // 評価ボーナス
	'import-service.ts', // backup restore の台帳復元 (referenceId 無し)
	'login-bonus-service.ts', // ログインボーナス (login_bonuses UNIQUE で冪等)
	'point-service.ts', // 初期設定付与 / 換算
	'recommendation-service.ts', // おすすめ完遂ボーナス
	'special-reward-service.ts', // とくべつごほうび付与 (reward 行作成と 1:1)
	'stamp-card-service.ts', // スタンプカード特典
]);

/** flip + ledger を単一原子 primitive 化済みのため、ledger 直接書込が「禁止」される file。 */
const ATOMIC_PRIMITIVE_SERVICES = new Set([
	'child-challenge-service.ts', // claimRewardAndGrantPoints (#3284/#3342)
	'reward-redemption-service.ts', // spendPointsAtomic (#3347) + insertRedemptionRequest dedup (#3356)
]);

function serviceFiles(): string[] {
	return readdirSync(SERVICES_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
}

function read(file: string): string {
	return readFileSync(resolve(SERVICES_DIR, file), 'utf-8');
}

describe('ledger grant atomicity fitness (#3284/#3342/#3356、ADR-0061 same-class guard)', () => {
	it('service 層の ledger 直接書込 callsite は allowlist (無条件付与経路) に限定される', () => {
		const violations: string[] = [];
		for (const file of serviceFiles()) {
			const src = read(file);
			const writesLedger = /\binsertPointLedger\s*\(|\binsertPointEntry\s*\(/.test(src);
			if (writesLedger && !LEDGER_WRITE_ALLOWLIST.has(file)) {
				violations.push(file);
			}
		}
		expect(
			violations,
			'新規の service 層 ledger 書込を検出。条件付き状態 flip (claim / redeem / approve) の成否で' +
				'付与する経路なら repo 層の単一原子 primitive (claimRewardAndGrantPoints / spendPointsAtomic 型) に' +
				'実装し、無条件付与経路なら本 fitness の LEDGER_WRITE_ALLOWLIST に理由コメント付きで追記すること (#3284/#3342)',
		).toEqual([]);
	});

	it('原子 primitive 化済み service (claim / redemption) は ledger 直接書込に後退しない', () => {
		for (const file of ATOMIC_PRIMITIVE_SERVICES) {
			const src = read(file);
			expect(
				/\binsertPointLedger\s*\(|\binsertPointEntry\s*\(/.test(src),
				`${file} が ledger 直接書込に後退している。flip + 付与は repo 原子 primitive 経由にすること (#3342 lost-award 再発)`,
			).toBe(false);
		}
	});

	it('allowlist が stale でない (登録 file が実在し、実際に ledger を書く)', () => {
		const files = new Set(serviceFiles());
		for (const file of LEDGER_WRITE_ALLOWLIST) {
			expect(
				files.has(file),
				`allowlist の ${file} が存在しない (rename/削除時は allowlist も更新)`,
			).toBe(true);
			expect(
				/\binsertPointLedger\s*\(|\binsertPointEntry\s*\(/.test(read(file)),
				`allowlist の ${file} は ledger を書いていない (stale entry、削除すること)`,
			).toBe(true);
		}
	});

	it('half-primitive (bare claimReward / findPendingByChildAndReward) が再導入されない', () => {
		// interface: flip のみの claimReward / check-then-act 用 findPendingByChildAndReward を宣言しない
		const challengeIface = readFileSync(
			resolve(REPO_ROOT, 'src/lib/server/db/interfaces/child-challenge-repo.interface.ts'),
			'utf-8',
		);
		expect(
			/^\s*claimReward\s*\(/m.test(challengeIface),
			'IChildChallengeRepo に bare claimReward (flip のみ) を再導入しない。ledger 同時書込の claimRewardAndGrantPoints を使う (#3342 (1))',
		).toBe(false);

		const redemptionIface = readFileSync(
			resolve(REPO_ROOT, 'src/lib/server/db/interfaces/reward-redemption-repo.interface.ts'),
			'utf-8',
		);
		expect(
			/^\s*findPendingByChildAndReward\s*\(/m.test(redemptionIface),
			'IRewardRedemptionRepo に findPendingByChildAndReward (check-then-act) を再導入しない。dedup は insertRedemptionRequest の原子境界に内蔵する (#3356 (1))',
		).toBe(false);

		// service: check-then-act の呼び出し残存なし
		for (const file of serviceFiles()) {
			expect(
				/\bfindPendingByChildAndReward\s*\(/.test(read(file)),
				`${file} が findPendingByChildAndReward (check-then-act TOCTOU) を呼んでいる`,
			).toBe(false);
		}
	});
});
