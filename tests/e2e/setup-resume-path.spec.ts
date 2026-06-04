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
// reward_templates / onboarding_child_screen_visited を書き換えると ambient な onboarding
// 状態が非決定になるため、各 test 前に worker DB を直接操作して **必ず「進行中 (未完了)」
// 状態に固定** する (rewards 設定 + child_screen フラグを削除)。完了状態の検証時のみ
// additive に設定を書き、最後に afterAll で除去して sibling spec への影響を残さない。
//
// act → outcome (#2544 / tests/CLAUDE.md): バナー表示だけでなく「CTA click → 別画面に着地
// (URL 変化) → そこに文脈バナーが出る」= dead-end ゼロを assert する。

import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { isAwsEnv } from './helpers';

const REWARD_KEY = 'reward_templates';
const CHILD_SCREEN_KEY = 'onboarding_child_screen_visited';

function openDb(path: string): InstanceType<typeof Database> {
	return new Database(path);
}

// onboarding を「進行中 (rewards 未設定 + 子供画面未確認)」に固定する。
function forceOnboardingIncomplete(dbPath: string): void {
	const db = openDb(dbPath);
	try {
		db.prepare(`DELETE FROM settings WHERE key IN ('${REWARD_KEY}', '${CHILD_SCREEN_KEY}')`).run();
	} finally {
		db.close();
	}
}

// onboarding を完了させる (不足していた required item を満たす)。
function forceOnboardingComplete(dbPath: string): void {
	const db = openDb(dbPath);
	try {
		// rewardTemplatesArraySchema (title / points / icon? / category) に一致させる
		// (category 必須。欠落すると getRewardTemplates が [] を返し rewards 未完了のまま)。
		db.prepare(
			`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('${REWARD_KEY}', ?, CURRENT_TIMESTAMP)`,
		).run(JSON.stringify([{ title: 'ごほうび', points: 100, icon: '🎁', category: 'other' }]));
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
		// sibling spec への影響を残さないため additive 設定を後始末する。
		test.afterAll(({ workerDbPath }) => {
			try {
				forceOnboardingIncomplete(workerDbPath);
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
