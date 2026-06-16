// tests/unit/services/pin-operator-reset.test.ts — #2994 (EPIC #2990)
//
// operator-level PIN reset の安全性検証:
//   - env 無し = 完全 no-op (攻撃面を増やさない)
//   - 同 token は二度と適用しない (冪等、env unset 忘れでも再 reset されない)
//   - 適用 = pin_hash 空文字 (未設定化 → #2992 初回作成フロー誘導) + ロック解除
//   - AUTH_MODE=local 以外は警告のみで reset しない (cognito SaaS はマルチテナント)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockGetAuthMode = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: mockGetSetting,
	setSetting: mockSetSetting,
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: mockGetAuthMode,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: mockLoggerInfo, warn: mockLoggerWarn },
}));

const envState: { PARENT_PIN_RESET?: string } = {};
vi.mock('$lib/runtime/env', () => ({
	get env() {
		return envState;
	},
}));

const { applyOperatorPinResetIfRequested, resetOperatorPinResetForTesting } = await import(
	'../../../src/lib/server/services/pin-operator-reset'
);

describe('applyOperatorPinResetIfRequested (#2994)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetOperatorPinResetForTesting();
		envState.PARENT_PIN_RESET = undefined;
		mockGetAuthMode.mockReturnValue('local');
		mockGetSetting.mockResolvedValue(undefined);
		mockSetSetting.mockResolvedValue(undefined);
	});

	it('env 無し: 完全 no-op (settings に一切アクセスしない)', async () => {
		await applyOperatorPinResetIfRequested();

		expect(mockGetSetting).not.toHaveBeenCalled();
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('未適用 token: pin_hash 空文字化 (未設定化) + 失敗カウンタ/ロック解除 + 冪等フラグ書込', async () => {
		envState.PARENT_PIN_RESET = 'reset-2026-06-11';
		await applyOperatorPinResetIfRequested();

		// env に平文 PIN を置かない設計: 新 PIN を書くのでなく未設定状態に戻す (#2992 作成フロー誘導)
		expect(mockSetSetting).toHaveBeenCalledWith('pin_hash', '', 'local');
		expect(mockSetSetting).toHaveBeenCalledWith('pin_failed_attempts', '0', 'local');
		expect(mockSetSetting).toHaveBeenCalledWith('pin_locked_until', '', 'local');
		expect(mockSetSetting).toHaveBeenCalledWith('pin_reset_applied', 'reset-2026-06-11', 'local');
		// audit log (適用事実)
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			expect.stringContaining('[AUDIT]'),
			expect.anything(),
		);
	});

	it('適用済み token: 二度と適用しない (env unset 忘れでも再 reset されない、冪等)', async () => {
		envState.PARENT_PIN_RESET = 'reset-2026-06-11';
		mockGetSetting.mockResolvedValue('reset-2026-06-11'); // pin_reset_applied が同 token
		await applyOperatorPinResetIfRequested();

		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('異なる新 token は再適用できる (運用者が 2 回目の救済を行うケース)', async () => {
		envState.PARENT_PIN_RESET = 'reset-2026-07-01';
		mockGetSetting.mockResolvedValue('reset-2026-06-11'); // 過去の別 token
		await applyOperatorPinResetIfRequested();

		expect(mockSetSetting).toHaveBeenCalledWith('pin_hash', '', 'local');
		expect(mockSetSetting).toHaveBeenCalledWith('pin_reset_applied', 'reset-2026-07-01', 'local');
	});

	it('AUTH_MODE=cognito: 警告のみで reset しない (マルチテナントのため env 対象外)', async () => {
		envState.PARENT_PIN_RESET = 'reset-2026-06-11';
		mockGetAuthMode.mockReturnValue('cognito');
		await applyOperatorPinResetIfRequested();

		expect(mockSetSetting).not.toHaveBeenCalled();
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			expect.stringContaining('AUTH_MODE=local でのみ有効'),
			expect.anything(),
		);
	});

	it('プロセス内 2 回目の呼出は評価自体を skip する (毎 request 呼ばれても zero cost)', async () => {
		envState.PARENT_PIN_RESET = 'reset-2026-06-11';
		await applyOperatorPinResetIfRequested();
		mockGetSetting.mockClear();
		mockSetSetting.mockClear();

		await applyOperatorPinResetIfRequested();
		expect(mockGetSetting).not.toHaveBeenCalled();
		expect(mockSetSetting).not.toHaveBeenCalled();
	});
});
