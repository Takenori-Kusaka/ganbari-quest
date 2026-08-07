// tests/unit/services/child-service.test.ts
// child-service のユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Top-level mocks ---

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: vi.fn(),
	findChildById: vi.fn(),
	findChildByUserId: vi.fn(),
	insertChild: vi.fn(),
	updateChild: vi.fn(),
	deleteChild: vi.fn(),
}));

// #4313: 保護者の手動変更では告知しないことを固定するためのスパイ
const mockRecordUiModeChangeNotice = vi.fn();
vi.mock('$lib/server/services/ui-mode-change-notice-service', () => ({
	recordUiModeChangeNotice: (...args: unknown[]) => mockRecordUiModeChangeNotice(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('$lib/server/storage', () => ({
	deleteByPrefix: vi.fn(),
	deleteFile: vi.fn(),
	listFiles: vi.fn(),
	saveFile: vi.fn(),
}));

// #4413: 仮アバターの avatar_url 反映先
vi.mock('$lib/server/db/image-repo', () => ({
	updateChildAvatarUrl: vi.fn(),
}));

vi.mock('$lib/server/storage-keys', () => ({
	childPrefix: vi.fn(
		(tenantId: string, childId: number, type: string) => `tenants/${tenantId}/${type}/${childId}/`,
	),
	placeholderAvatarKey: vi.fn(
		(tenantId: string, childId: string, ext: string) =>
			`tenants/${tenantId}/avatars/${childId}/placeholder.${ext}`,
	),
	storageKeyToPublicUrl: vi.fn((key: string) => `/${key}`),
	assertTenantScopedStorageKey: vi.fn(),
}));

// --- Imports (after mocks) ---

import { asChildId } from '$lib/domain/ids';
import {
	deleteChild,
	findAllChildren,
	findChildById,
	findChildByUserId,
	insertChild,
	updateChild,
} from '$lib/server/db/child-repo';
import { updateChildAvatarUrl } from '$lib/server/db/image-repo';
import { logger } from '$lib/server/logger';
import {
	addChild,
	deleteChildFiles,
	editChild,
	getAllChildren,
	getChildById,
	getChildByUserId,
	removeChild,
} from '$lib/server/services/child-service';
import { deleteByPrefix, deleteFile, listFiles, saveFile } from '$lib/server/storage';

const TENANT = 'tenant-abc';

describe('child-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// --- Delegation tests ---

	describe('getAllChildren', () => {
		it('findAllChildren に tenantId を委譲する', async () => {
			const mockChildren = [{ id: '1', nickname: 'たろう' }];
			vi.mocked(findAllChildren).mockResolvedValue(mockChildren as never);

			const result = await getAllChildren(TENANT);

			expect(findAllChildren).toHaveBeenCalledWith(TENANT);
			expect(result).toEqual(mockChildren);
		});
	});

	describe('getChildById', () => {
		it('findChildById に id と tenantId を委譲する', async () => {
			const mockChild = { id: '5', nickname: 'はなこ' };
			vi.mocked(findChildById).mockResolvedValue(mockChild as never);

			const result = await getChildById(asChildId(5), TENANT);

			expect(findChildById).toHaveBeenCalledWith('5', TENANT);
			expect(result).toEqual(mockChild);
		});
	});

	describe('getChildByUserId', () => {
		it('findChildByUserId に userId と tenantId を委譲する', async () => {
			const mockChild = { id: '3', nickname: 'ゆうた', userId: 'user-99' };
			vi.mocked(findChildByUserId).mockResolvedValue(mockChild as never);

			const result = await getChildByUserId('user-99', TENANT);

			expect(findChildByUserId).toHaveBeenCalledWith('user-99', TENANT);
			expect(result).toEqual(mockChild);
		});
	});

	describe('addChild', () => {
		const input = { nickname: 'まさと', age: 7, theme: 'blue' };
		const inserted = { id: '10', ...input };

		// #4419: addChild は uiMode を年齢から解決してから repo に渡す (登録経路 2 本の
		// 二重実装を作らないため service 層が単一の解決点)。境界の網羅は
		// tests/unit/services/child-service-default-ui-mode.test.ts が持つ。
		it('insertChild に input + 年齢から解決した uiMode と tenantId を渡す', async () => {
			vi.mocked(insertChild).mockResolvedValue(inserted as never);

			await addChild(input, TENANT);

			expect(insertChild).toHaveBeenCalledWith({ ...input, uiMode: 'elementary' }, TENANT);
		});

		// #4413: 登録した子供には仮アバター (頭文字 + テーマ色) が自動で付く。
		it('仮アバターの SVG を storage に保存し avatar_url に反映する', async () => {
			vi.mocked(insertChild).mockResolvedValue(inserted as never);

			const result = await addChild(input, TENANT);

			const expectedKey = `tenants/${TENANT}/avatars/10/placeholder.svg`;
			expect(saveFile).toHaveBeenCalledTimes(1);
			const [key, data, contentType] = vi.mocked(saveFile).mock.calls[0] as [
				string,
				Buffer,
				string,
			];
			expect(key).toBe(expectedKey);
			expect(contentType).toBe('image/svg+xml');
			expect(data.toString('utf-8')).toContain('>ま<');

			expect(updateChildAvatarUrl).toHaveBeenCalledWith('10', `/${expectedKey}`, TENANT);
			expect(result).toEqual({ ...inserted, avatarUrl: `/${expectedKey}` });
		});

		// #4413 AC5: アバターは付加価値。storage が不調でも子供の登録は成功させる。
		it('仮アバターの保存に失敗しても登録は成功し、avatar_url は更新しない', async () => {
			vi.mocked(insertChild).mockResolvedValue(inserted as never);
			vi.mocked(saveFile).mockRejectedValueOnce(new Error('storage down'));

			const result = await addChild(input, TENANT);

			expect(result).toEqual(inserted);
			expect(updateChildAvatarUrl).not.toHaveBeenCalled();
			expect(logger.warn).toHaveBeenCalled();
		});
	});

	describe('editChild', () => {
		it('#580/#1382: age 変更時、uiModeManuallySet=0 なら uiMode を自動再計算する', async () => {
			const existing = { id: '10', uiMode: 'preschool', uiModeManuallySet: 0 };
			vi.mocked(findChildById).mockResolvedValue(existing as never);
			const mockResult = { id: '10' };
			vi.mocked(updateChild).mockResolvedValue(mockResult as never);

			await editChild(asChildId(10), { nickname: 'まさと改', age: 8 }, TENANT);

			expect(findChildById).toHaveBeenCalledWith('10', TENANT);
			expect(updateChild).toHaveBeenCalledWith(
				asChildId(10),
				{ nickname: 'まさと改', age: 8, uiMode: 'elementary' },
				TENANT,
			);
		});

		it('#1382: age 変更時、uiModeManuallySet=1 なら uiMode を保持する', async () => {
			const existing = { id: '10', uiMode: 'baby', uiModeManuallySet: 1 };
			vi.mocked(findChildById).mockResolvedValue(existing as never);
			vi.mocked(updateChild).mockResolvedValue({ id: '10' } as never);

			await editChild(asChildId(10), { age: 8 }, TENANT);

			// uiMode は変更されず、baby のまま（uiModeManuallySet=1 なので自動再計算しない）
			expect(updateChild).toHaveBeenCalledWith('10', { age: 8, uiMode: 'baby' }, TENANT);
		});

		it('#1382: uiMode を明示指定すると uiModeManuallySet=1 が付与される', async () => {
			vi.mocked(updateChild).mockResolvedValue({ id: '10' } as never);

			await editChild(asChildId(10), { age: 8, uiMode: 'baby' }, TENANT);

			// findChildById は呼ばれない（uiMode 明示なのでフラグだけ立てる）
			expect(findChildById).not.toHaveBeenCalled();
			expect(updateChild).toHaveBeenCalledWith(
				asChildId(10),
				{ age: 8, uiMode: 'baby', uiModeManuallySet: 1 },
				TENANT,
			);
		});

		it('#580: age 未指定時は uiMode を付与しない', async () => {
			vi.mocked(updateChild).mockResolvedValue({ id: '10' } as never);

			await editChild(asChildId(10), { nickname: 'まさと改' }, TENANT);

			expect(findChildById).not.toHaveBeenCalled();
			expect(updateChild).toHaveBeenCalledWith('10', { nickname: 'まさと改' }, TENANT);
		});
	});

	// --- removeChild ---

	describe('removeChild', () => {
		it('deleteChildFiles を呼んでから deleteChild を呼ぶ', async () => {
			// deleteChildFiles 内部のモック設定
			vi.mocked(deleteByPrefix).mockResolvedValue(0);
			vi.mocked(listFiles).mockResolvedValue([]);
			vi.mocked(deleteChild).mockResolvedValue(undefined as never);

			await removeChild(asChildId(7), TENANT);

			// deleteByPrefix が 3 回呼ばれる（avatars, generated, voices）
			expect(deleteByPrefix).toHaveBeenCalledTimes(3);
			// deleteChild が呼ばれる
			expect(deleteChild).toHaveBeenCalledWith('7', TENANT);
		});
	});

	// --- deleteChildFiles ---

	describe('deleteChildFiles', () => {
		it('新パス（avatars/generated/voices）のプレフィックス削除 + レガシーファイル削除を行う', async () => {
			// 新パスのプレフィックス削除: 各2ファイルずつ削除
			vi.mocked(deleteByPrefix)
				.mockResolvedValueOnce(2) // avatars
				.mockResolvedValueOnce(1) // generated
				.mockResolvedValueOnce(0); // voices

			// レガシーファイル
			vi.mocked(listFiles)
				.mockResolvedValueOnce(['uploads/avatars/avatar-1-old.png'])
				.mockResolvedValueOnce(['generated/avatar-1-gen1.png', 'generated/avatar-1-gen2.png']);
			vi.mocked(deleteFile).mockResolvedValue(undefined);

			await deleteChildFiles(asChildId(1), TENANT);

			// 新パスの deleteByPrefix が正しいプレフィックスで呼ばれる
			expect(deleteByPrefix).toHaveBeenCalledWith(`tenants/${TENANT}/avatars/1/`);
			expect(deleteByPrefix).toHaveBeenCalledWith(`tenants/${TENANT}/generated/1/`);
			expect(deleteByPrefix).toHaveBeenCalledWith(`tenants/${TENANT}/voices/1/`);

			// レガシーファイルの listFiles が呼ばれる
			expect(listFiles).toHaveBeenCalledWith('uploads/avatars/avatar-1-');
			expect(listFiles).toHaveBeenCalledWith('generated/avatar-1-');

			// レガシーファイル3件分の deleteFile
			expect(deleteFile).toHaveBeenCalledTimes(3);
			expect(deleteFile).toHaveBeenCalledWith('uploads/avatars/avatar-1-old.png');
			expect(deleteFile).toHaveBeenCalledWith('generated/avatar-1-gen1.png');
			expect(deleteFile).toHaveBeenCalledWith('generated/avatar-1-gen2.png');
		});

		it('totalDeleted > 0 のとき logger.info でログ出力する', async () => {
			vi.mocked(deleteByPrefix)
				.mockResolvedValueOnce(1)
				.mockResolvedValueOnce(0)
				.mockResolvedValueOnce(0);
			vi.mocked(listFiles).mockResolvedValue([]);

			await deleteChildFiles(asChildId(2), TENANT);

			expect(logger.info).toHaveBeenCalledWith(
				'[child-service] 子供の画像ファイルを削除しました',
				expect.objectContaining({
					context: { childId: asChildId(2), tenantId: TENANT, totalDeleted: 1 },
				}),
			);
		});

		it('totalDeleted が 0 のとき logger.info は呼ばれない', async () => {
			vi.mocked(deleteByPrefix).mockResolvedValue(0);
			vi.mocked(listFiles).mockResolvedValue([]);

			await deleteChildFiles(asChildId(3), TENANT);

			expect(logger.info).not.toHaveBeenCalled();
		});

		it('エラーが発生しても例外を投げずに logger.error でログ出力する', async () => {
			vi.mocked(deleteByPrefix).mockRejectedValue(new Error('Storage failure'));

			// 例外を投げないことを確認
			await expect(deleteChildFiles(asChildId(4), TENANT)).resolves.toBeUndefined();

			expect(logger.error).toHaveBeenCalledWith(
				'[child-service] 子供の画像ファイル削除に失敗',
				expect.objectContaining({
					error: 'Storage failure',
					context: { childId: asChildId(4), tenantId: TENANT },
				}),
			);
		});

		it('レガシーファイルが空配列のときも正常に完了する', async () => {
			vi.mocked(deleteByPrefix).mockResolvedValue(0);
			vi.mocked(listFiles).mockResolvedValue([]);

			await deleteChildFiles(asChildId(5), TENANT);

			// deleteFile はレガシーファイルがないので呼ばれない
			expect(deleteFile).not.toHaveBeenCalled();
			// logger.info は totalDeleted=0 なので呼ばれない
			expect(logger.info).not.toHaveBeenCalled();
		});
	});

	// --- #4313: 保護者の手動変更は告知しない ---

	describe('editChild — uiMode 変更の告知 (#4313)', () => {
		it('保護者が uiMode を明示指定した場合は notice を記録しない (自分の操作なので告知不要)', async () => {
			vi.mocked(updateChild).mockResolvedValue(undefined as never);

			await editChild(asChildId(1), { uiMode: 'junior' }, TENANT);

			expect(mockRecordUiModeChangeNotice).not.toHaveBeenCalled();
		});

		it('保護者が age を変更して uiMode が再計算された場合も notice を記録しない', async () => {
			vi.mocked(findChildById).mockResolvedValue({
				id: asChildId(1),
				uiMode: 'preschool',
				uiModeManuallySet: 0,
			} as never);
			vi.mocked(updateChild).mockResolvedValue(undefined as never);

			await editChild(asChildId(1), { age: 6 }, TENANT);

			expect(mockRecordUiModeChangeNotice).not.toHaveBeenCalled();
		});
	});
});
