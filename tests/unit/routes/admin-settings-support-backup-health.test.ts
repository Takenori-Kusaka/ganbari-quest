// tests/unit/routes/admin-settings-support-backup-health.test.ts
// #4087 (E3 / EPIC #4119) — 設定 > サポート画面にバックアップ状態が配布されることを検証する。
//
// 本 Issue の実害は「バックアップが 18 日止まっていたのに、気づく手段が `curl /api/health | jq`
// しかなかった」。判定ロジック自体は tests/unit/domain/backup-health.test.ts が固定するので、
// 本テストが固定するのは **判定結果が家族 (非エンジニア) の見る画面まで届く配線**:
//
//   [SB1] NUC (DATA_SOURCE=pglite) では backupHealth が load から返る
//   [SB2] **クラウド (dsql) では返さない** — AWS Backup が担う領域で、載せると
//         「自分で見るべきもの」を誤らせる
//   [SB3] 状態ファイルが読めなくても load は落ちない (相談フォームが道連れにならない)
//   [SB4] 通知経路が無いことが画面まで届く (#4087 AC1「通知できないので黙る」を無くす)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPgliteBackupStatus = vi.fn();
vi.mock('$lib/server/services/pglite-backup-service', () => ({
	getPgliteBackupStatus: (...args: unknown[]) => mockGetPgliteBackupStatus(...args),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 'tenant-1',
}));
vi.mock('$lib/server/db/inquiry-repo', () => ({
	generateInquiryId: vi.fn(),
	saveInquiry: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/server/services/discord-notify-service', () => ({ notifyInquiry: vi.fn() }));
vi.mock('$lib/server/services/email-service', () => ({
	sendInquiryConfirmationEmail: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

/** 直近成功 + 通知経路あり = ok と判定される状態。 */
function healthyStatus() {
	return {
		lastSuccessAt: new Date(Date.now() - 3_600_000).toISOString(),
		lastSuccessFilename: 'pglite-20260730T225306Z.tgz',
		lastSuccessBytes: 5_876_551,
		lastSuccessDurationMs: 5057,
		lastFailureAt: null,
		lastFailureMessage: null,
		consecutiveFailures: 0,
	};
}

async function loadSupportPage() {
	const mod = await import('../../../src/routes/(parent)/admin/settings/support/+page.server');
	return mod.load({ locals: { identity: null } } as never);
}

beforeEach(() => {
	vi.resetModules();
	mockGetPgliteBackupStatus.mockReset();
	process.env.DISCORD_ALERT_WEBHOOK_URL = 'https://discord.example/webhook';
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

describe('#4087 設定 > サポート画面へのバックアップ状態の配布', () => {
	it('[SB1] NUC (pglite) では判定結果が load から返る', async () => {
		process.env.DATA_SOURCE = 'pglite';
		mockGetPgliteBackupStatus.mockResolvedValue(healthyStatus());

		const data = (await loadSupportPage()) as { backupHealth: { level: string } | null };

		expect(data.backupHealth).not.toBeNull();
		expect(data.backupHealth?.level).toBe('ok');
	});

	it('[SB2] クラウド (dsql) では返さない — AWS Backup の領域と混同させない', async () => {
		process.env.DATA_SOURCE = 'dsql';
		mockGetPgliteBackupStatus.mockResolvedValue(healthyStatus());

		const data = (await loadSupportPage()) as { backupHealth: unknown };

		expect(data.backupHealth).toBeNull();
		// 状態ファイルを読みに行くこと自体をしない (NUC 専用の口を叩かない)。
		expect(mockGetPgliteBackupStatus).not.toHaveBeenCalled();
	});

	it('[SB3] 状態ファイルが読めなくても load は落ちない', async () => {
		// バックアップ状態が読めないことと、相談フォームが使えることは無関係。
		// ここで throw すると「バックアップ状態が読めないせいで相談できない」逆転が起きる。
		process.env.DATA_SOURCE = 'pglite';
		mockGetPgliteBackupStatus.mockRejectedValue(new Error('ENOENT'));

		const data = (await loadSupportPage()) as { backupHealth: unknown; accountEmail: unknown };

		expect(data.backupHealth).toBeNull();
		expect(data).toHaveProperty('accountEmail');
	});

	it('[SB4] 通知経路が無いことが画面まで届く (#4087 AC1)', async () => {
		// 直近は成功していても、次に失敗したとき誰にも届かない状態は warn として出す。
		// 2026-07-31 の実害では、この状態が 18 日間可視化されていなかった。
		process.env.DATA_SOURCE = 'pglite';
		process.env.DISCORD_ALERT_WEBHOOK_URL = '';
		process.env.DISCORD_WEBHOOK_INCIDENT = '';
		mockGetPgliteBackupStatus.mockResolvedValue(healthyStatus());

		const data = (await loadSupportPage()) as {
			backupHealth: { level: string; reason: string; notificationMissing: boolean } | null;
		};

		expect(data.backupHealth?.level).toBe('warn');
		expect(data.backupHealth?.reason).toBe('no-notification-channel');
		expect(data.backupHealth?.notificationMissing).toBe(true);
	});
});
