// tests/unit/services/ui-mode-change-notice-service.test.ts
// #4313: 年齢帯 UI 切替の「次回ログイン告知」用 pending notice の read/write/clear。
//
// 保存先は settings KV (grace-period-service と同じ前例)。children テーブルへの列追加は
// 不可逆スキーマ変更のため採らない (Issue #4313 §未確定事項)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	clearUiModeChangeNotice,
	getUiModeChangeNotice,
	recordUiModeChangeNotice,
	uiModeChangeNoticeKey,
} from '../../../src/lib/server/services/ui-mode-change-notice-service';

const CHILD = asChildId(1);
const TENANT = 'tenant-1';

beforeEach(() => {
	vi.clearAllMocks();
	mockGetSetting.mockResolvedValue(undefined);
	mockSetSetting.mockResolvedValue(undefined);
});

describe('uiModeChangeNoticeKey', () => {
	it('child ごとに独立したキーになる', () => {
		expect(uiModeChangeNoticeKey(asChildId(1))).not.toBe(uiModeChangeNoticeKey(asChildId(2)));
		expect(uiModeChangeNoticeKey(asChildId(1))).toContain('1');
	});
});

describe('recordUiModeChangeNotice', () => {
	it('境界を跨いだとき pending notice を書く', async () => {
		await recordUiModeChangeNotice(
			{ childId: CHILD, from: 'preschool', to: 'elementary', changedOn: '2026-08-06' },
			TENANT,
		);

		expect(mockSetSetting).toHaveBeenCalledTimes(1);
		const [key, value, tenantId] = mockSetSetting.mock.calls[0] as [string, string, string];
		expect(key).toBe(uiModeChangeNoticeKey(CHILD));
		expect(tenantId).toBe(TENANT);
		expect(JSON.parse(value)).toEqual({
			from: 'preschool',
			to: 'elementary',
			changedOn: '2026-08-06',
		});
	});

	it('同一モード内 (from === to) では何も書かない', async () => {
		await recordUiModeChangeNotice(
			{ childId: CHILD, from: 'elementary', to: 'elementary', changedOn: '2026-08-06' },
			TENANT,
		);

		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('書き込み失敗は呼び出し元に伝播せず握り潰す (告知失敗で本処理を落とさない)', async () => {
		mockSetSetting.mockRejectedValueOnce(new Error('boom'));

		await expect(
			recordUiModeChangeNotice(
				{ childId: CHILD, from: 'preschool', to: 'elementary', changedOn: '2026-08-06' },
				TENANT,
			),
		).resolves.toBeUndefined();
	});
});

describe('getUiModeChangeNotice', () => {
	it('保存済みの notice を返す', async () => {
		mockGetSetting.mockResolvedValue(
			JSON.stringify({ from: 'junior', to: 'senior', changedOn: '2026-08-06' }),
		);

		await expect(getUiModeChangeNotice(CHILD, TENANT)).resolves.toEqual({
			from: 'junior',
			to: 'senior',
			changedOn: '2026-08-06',
		});
	});

	it('未設定なら null', async () => {
		mockGetSetting.mockResolvedValue(undefined);
		await expect(getUiModeChangeNotice(CHILD, TENANT)).resolves.toBeNull();
	});

	it('既読 (空文字) なら null — 再表示しない', async () => {
		mockGetSetting.mockResolvedValue('');
		await expect(getUiModeChangeNotice(CHILD, TENANT)).resolves.toBeNull();
	});

	it('壊れた JSON なら null (ページを落とさない)', async () => {
		mockGetSetting.mockResolvedValue('{not json');
		await expect(getUiModeChangeNotice(CHILD, TENANT)).resolves.toBeNull();
	});

	it('未知の uiMode 値なら null', async () => {
		mockGetSetting.mockResolvedValue(
			JSON.stringify({ from: 'preschool', to: 'zzz', changedOn: '2026-08-06' }),
		);
		await expect(getUiModeChangeNotice(CHILD, TENANT)).resolves.toBeNull();
	});
});

describe('clearUiModeChangeNotice — idempotency', () => {
	it('clear 後は getUiModeChangeNotice が null を返す', async () => {
		const store = new Map<string, string>();
		mockSetSetting.mockImplementation(async (key: string, value: string) => {
			store.set(key, value);
		});
		mockGetSetting.mockImplementation(async (key: string) => store.get(key));

		await recordUiModeChangeNotice(
			{ childId: CHILD, from: 'preschool', to: 'elementary', changedOn: '2026-08-06' },
			TENANT,
		);
		expect(await getUiModeChangeNotice(CHILD, TENANT)).not.toBeNull();

		await clearUiModeChangeNotice(CHILD, TENANT);
		expect(await getUiModeChangeNotice(CHILD, TENANT)).toBeNull();

		// 別日の再ログイン相当 (再 read) でも復活しない
		expect(await getUiModeChangeNotice(CHILD, TENANT)).toBeNull();
	});
});
