// tests/e2e/setup-resume-path.spec.ts
// #2821: セットアップ離脱後の再開導線 (SetupResumeBanner) brand-new user journey 回帰。
//
// 顧客レビュー (2026-06-03) で「こども追加後ホームに戻ると次 step が分からない /
// テンプレ追加で活動管理に着地して迷子」= 初回 setup 完走前に dead-end になる動線断絶が
// 指摘された。本 spec は「setup 離脱後のホーム (/switch) → 再開 CTA → admin 文脈バナー →
// onboarding 完了でバナー消滅」を貫通し、再開導線が不可視に戻る回帰を捕捉する。
//
// 決定性 (E2E isolation): onboarding 完了状態は子供 / 活動 / ごほうび / チェックリスト /
// 子供画面確認の実データから導出される。同一 worker DB を共有する sibling spec が
// special_rewards / onboarding_child_screen_visited を書き換えると ambient な onboarding
// 状態が非決定になるため、各 test 前に worker DB を直接操作して **必ず「進行中 (未完了)」
// 状態に固定** する (per-child reward 全行 + child_screen フラグを削除)。完了状態の検証時のみ
// additive にデータを書く。
//
// #4910: onboarding の rewards 完了判定は family scope の `reward_templates` 設定ではなく
// **per-child reward (`special_rewards` テーブル)** を見るよう是正された (setup 4/9 の
// 実取込先と判定元を一致させるため)。global-setup はショップ E2E 用に「たろうくん」へ常時
// `special_rewards` (category='shop_e2e') を 3 件 seed するため、そのままでは rewards item は
// 常に completed 判定になり「進行中」状態を再現できない。beforeAll で worker DB の
// `special_rewards` 全行を snapshot → 各 test 前に空にして「進行中」を作り、afterAll で
// 元の行 (id を含む全列) をそのまま書き戻して sibling spec (child-shop-exchange 等) への
// 影響を残さない。
//
// #2851: 本 spec は global-setup が seed した設定/データを削除する。afterAll で
// 「削除した値」を消すだけでは seed 値が復元されず、同 worker 後続 spec が決定的に
// fail していた。beforeAll で削除前の seed 値を snapshot し、afterAll で元の seed 状態へ
// 完全復元する。
//
// act → outcome (#2544 / tests/CLAUDE.md): バナー表示だけでなく「CTA click → 別画面に着地
// (URL 変化) → そこに文脈バナーが出る」= dead-end ゼロを assert する。

import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { isAwsEnv } from './helpers';

const CHILD_SCREEN_KEY = 'onboarding_child_screen_visited';

function openDb(path: string): InstanceType<typeof Database> {
	return new Database(path);
}

// onboarding を「進行中 (rewards 未設定 + 子供画面未確認)」に固定する。
// #4910: rewards は per-child `special_rewards` が判定元。全行削除で「誰も reward を
// 持っていない」状態を作る (beforeAll で snapshot 済のため afterAll で元通り復元される)。
function forceOnboardingIncomplete(dbPath: string): void {
	const db = openDb(dbPath);
	try {
		db.prepare('DELETE FROM special_rewards').run();
		db.prepare(`DELETE FROM settings WHERE key = '${CHILD_SCREEN_KEY}'`).run();
	} finally {
		db.close();
	}
}

type SpecialRewardRow = Record<string, unknown>;

// #2851 / #4910: 削除前の seed 状態スナップショット。
// `childScreen` は `null` = その key が settings に存在しなかった。
// `specialRewards` は global-setup がショップ E2E 用に seed した行 (たろうくん向け 3 件等) を
// 列そのまま保持し、afterAll で id を含めて完全復元する。
type OnboardingSeedSnapshot = { childScreen: string | null; specialRewards: SpecialRewardRow[] };

// 削除/書換の前に、worker DB の現在値 (global-setup が seed した special_rewards 等) を退避する。
function snapshotOnboardingSeed(dbPath: string): OnboardingSeedSnapshot {
	const db = openDb(dbPath);
	try {
		const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CHILD_SCREEN_KEY) as
			| { value: string }
			| undefined;
		const specialRewards = db.prepare('SELECT * FROM special_rewards').all() as SpecialRewardRow[];
		return { childScreen: row ? row.value : null, specialRewards };
	} finally {
		db.close();
	}
}

// スナップショットした seed 値を worker DB に書き戻す。sibling spec
// (child-shop-exchange 等がショップ E2E 用 special_rewards 行を要求) への影響を残さないため、
// afterAll で元の seed 状態へ完全復元する (special_rewards は id を含む全列を復元)。
function restoreOnboardingSeed(dbPath: string, snapshot: OnboardingSeedSnapshot): void {
	const db = openDb(dbPath);
	try {
		if (snapshot.childScreen === null) {
			db.prepare('DELETE FROM settings WHERE key = ?').run(CHILD_SCREEN_KEY);
		} else {
			db.prepare(
				'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
			).run(CHILD_SCREEN_KEY, snapshot.childScreen);
		}

		db.prepare('DELETE FROM special_rewards').run();
		const [firstReward] = snapshot.specialRewards;
		if (firstReward) {
			const columns = Object.keys(firstReward);
			const insert = db.prepare(
				`INSERT INTO special_rewards (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
			);
			for (const rewardRow of snapshot.specialRewards) {
				insert.run(...columns.map((c) => rewardRow[c]));
			}
		}
	} finally {
		db.close();
	}
}

// onboarding を完了させる (不足していた required item を満たす)。
// #4910: rewards は per-child `special_rewards` に 1 件挿入する (setup 4/9 の実取込先と
// 同じ表)。既存の子供 (global-setup 常時 seed) の 1 人に付与すれば足りる。
function forceOnboardingComplete(dbPath: string): void {
	const db = openDb(dbPath);
	try {
		const child = db.prepare('SELECT id FROM children LIMIT 1').get() as { id: number } | undefined;
		if (child) {
			db.prepare(
				"INSERT INTO special_rewards (child_id, title, points, icon, category, shown_at) VALUES (?, 'E2Eテスト用ごほうび (#4910 setup-resume)', 100, '🎁', 'other', CURRENT_TIMESTAMP)",
			).run(child.id);
		}
		db.prepare(
			`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('${CHILD_SCREEN_KEY}', 'true', CURRENT_TIMESTAMP)`,
		).run();
	} finally {
		db.close();
	}
}

// AWS / cognito 環境では local テナント seed / settings 直接操作が成立しないため未登録。
if (!isAwsEnv()) {
	test.describe('#2821 セットアップ再開導線 (SetupResumeBanner)', () => {
		// #2851 / #4910: 最初の削除前に worker DB の seed 値 (special_rewards 等) を退避し、
		// afterAll で元の seed 状態へ完全復元する。これがないと本 spec が seed 済データを
		// 削除したまま終了し、同 worker 後続 spec (child-shop-exchange 等がショップ E2E 用
		// special_rewards 行を要求) が決定的に fail する。
		let seedSnapshot: OnboardingSeedSnapshot | null = null;

		test.beforeAll(({ workerDbPath }) => {
			try {
				seedSnapshot = snapshotOnboardingSeed(workerDbPath);
			} catch {
				// DB 未生成 (全 skip 等) は無視。
				seedSnapshot = null;
			}
		});

		// sibling spec への影響を残さないため、本 spec が削除/書換した seed データを元へ復元する。
		test.afterAll(({ workerDbPath }) => {
			try {
				if (seedSnapshot) {
					restoreOnboardingSeed(workerDbPath, seedSnapshot);
				}
			} catch {
				// DB 未生成 (全 skip 等) は無視。
			}
		});

		test('setup 離脱後の /switch に再開導線が first view で出る (AC1)', async ({
			page,
			workerDbPath,
		}) => {
			forceOnboardingIncomplete(workerDbPath);

			await page.goto('/switch');
			const banner = page.getByTestId('setup-resume-banner');
			await expect(banner, '進行中の onboarding では再開バナーが描画される').toBeVisible();
			await expect(banner).toHaveAttribute('data-variant', 'resume');
			// 続きの CTA が見えている (NN/G #1 visibility)。
			await expect(page.getByTestId('setup-resume-cta')).toBeVisible();
		});

		test('再開 CTA → admin に着地し setup 文脈バナーが出る (AC2/AC3 文脈引き継ぎ)', async ({
			page,
			workerDbPath,
		}) => {
			forceOnboardingIncomplete(workerDbPath);

			await page.goto('/switch');
			const cta = page.getByTestId('setup-resume-cta');
			await expect(cta).toBeVisible();
			// act: 続きをする → 次のおすすめ step に from=setup 付きで遷移する。
			await cta.click();
			// outcome 1: URL が admin の該当 step に変わり from=setup を引き継ぐ (dead-end でない)。
			await page.waitForURL(/\/admin\/.*from=setup/);
			// outcome 2: 着地した admin 画面に文脈バナー (context variant) が出て戻り導線がある。
			const contextBanner = page.getByTestId('setup-resume-banner');
			await expect(contextBanner, 'setup 由来着地で迷子にならない文脈バナー').toBeVisible();
			await expect(contextBanner).toHaveAttribute('data-variant', 'context');
			// 戻る CTA が機能する導線として描画される。
			await expect(page.getByTestId('setup-resume-cta')).toBeVisible();
		});

		test('onboarding 完了で再開導線が消える (AC4 終端 / ADR-0012 進行中のみ表示)', async ({
			page,
			workerDbPath,
		}) => {
			forceOnboardingComplete(workerDbPath);

			await page.goto('/switch');
			// 完了済み (allCompleted) ではバナーは描画されない (Anti-engagement)。
			await expect(page.getByTestId('setup-resume-banner')).toHaveCount(0);
		});
	});
}
