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
}));

vi.mock('$lib/server/storage-keys', () => ({
	childPrefix: vi.fn(
		(tenantId: string, childId: number, type: string) => `tenants/${tenantId}/${type}/${childId}/`,
	),
}));

// --- Imports (after mocks) ---

import {
	deleteChild,
	findAllChildren,
	findChildById,
	findChildByUserId,
	insertChild,
	updateChild,
} from '$lib/server/db/child-repo';
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
import { deleteByPrefix, deleteFile, listFiles } from '$lib/server/storage';

const TENANT = 'tenant-abc';

describe('child-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// --- Delegation tests ---

	describe('getAllChildren', () => {
		it('findAllChildren に tenantId を委譲する', async () => {
			const mockChildren = [{ id: 1, nickname: 'たろう' }];
			vi.mocked(findAllChildren).mockResolvedValue(mockChildren as never);

			const result = await getAllChildren(TENANT);

			expect(findAllChildren).toHaveBeenCalledWith(TENANT);
			expect(result).toEqual(mockChildren);
		});
	});

	describe('getChildById', () => {
		it('findChildById に id と tenantId を委譲する', async () => {
			const mockChild = { id: 5, nickname: 'はなこ' };
			vi.mocked(findChildById).mockResolvedValue(mockChild as never);

			const result = await getChildById(5, TENANT);

			expect(findChildById).toHaveBeenCalledWith(5, TENANT);
			expect(result).toEqual(mockChild);
		});
	});

	describe('getChildByUserId', () => {
		it('findChildByUserId に userId と tenantId を委譲する', async () => {
			const mockChild = { id: 3, nickname: 'ゆうた', userId: 'user-99' };
			vi.mocked(findChildByUserId).mockResolvedValue(mockChild as never);

			const result = await getChildByUserId('user-99', TENANT);

			expect(findChildByUserId).toHaveBeenCalledWith('user-99', TENANT);
			expect(result).toEqual(mockChild);
		});
	});

	describe('addChild', () => {
		it('insertChild に input と tenantId を渡す', async () => {
			const input = { nickname: 'まさと', age: 7, theme: 'blue' };
			const mockResult = { id: 10, ...input };
			vi.mocked(insertChild).mockResolvedValue(mockResult as never);

			const result = await addChild(input, TENANT);

			expect(insertChild).toHaveBeenCalledWith(input, TENANT);
			expect(result).toEqual(mockResult);
		});
	});

	describe('editChild', () => {
		it('updateChild に id, input, tenantId を渡す（age 指定時は uiMode を自動計算）', async () => {
			// #580: age が変更されたら uiMode も自動再計算される
			const input = { nickname: 'まさと改', age: 8 };
			const mockResult = { id: 10, ...input };
			vi.mocked(updateChild).mockResolvedValue(mockResult as never);

			const result = await editChild(10, input, TENANT);

			expect(updateChild).toHaveBeenCalledWith(
				10,
				{ nickname: 'まさと改', age: 8, uiMode: 'elementary' },
				TENANT,
			);
			expect(result).toEqual(mockResult);
		});

		it('#580: 呼び出し側が uiMode を明示していればその値を尊重する', async () => {
			const input = { age: 8, uiMode: 'baby' }; // 年齢 8 だが明示的に baby を指定
			const mockResult = { id: 10, ...input };
			vi.mocked(updateChild).mockResolvedValue(mockResult as never);

			await editChild(10, input, TENANT);

			expect(updateChild).toHaveBeenCalledWith(
				10,
				{ age: 8, uiMode: 'baby' }, // 明示された baby をそのまま使う
				TENANT,
			);
		});

		it('#580: age 未指定時は uiMode を付与しない', async () => {
			const input = { nickname: 'まさと改' };
			vi.mocked(updateChild).mockResolvedValue({ id: 10 } as never);

			await editChild(10, input, TENANT);

			expect(updateChild).toHaveBeenCalledWith(10, { nickname: 'まさと改' }, TENANT);
		});
	});

	// --- removeChild ---

	describe('removeChild', () => {
		it('deleteChildFiles を呼んでから deleteChild を呼ぶ', async () => {
			// deleteChildFiles 内部のモック設定
			vi.mocked(deleteByPrefix).mockResolvedValue(0);
			vi.mocked(listFiles).mockResolvedValue([]);
			vi.mocked(deleteChild).mockResolvedValue(undefined as never);

			await removeChild(7, TENANT);

			// deleteByPrefix が 3 回呼ばれる（avatars, generated, voices）
			expect(deleteByPrefix).toHaveBeenCalledTimes(3);
			// deleteChild が呼ばれる
			expect(deleteChild).toHaveBeenCalledWith(7, TENANT);
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

			await deleteChildFiles(1, TENANT);

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

			await deleteChildFiles(2, TENANT);

			expect(logger.info).toHaveBeenCalledWith(
				'[child-service] 子供の画像ファイルを削除しました',
				expect.objectContaining({
					context: { childId: 2, tenantId: TENANT, totalDeleted: 1 },
				}),
			);
		});

		it('totalDeleted が 0 のとき logger.info は呼ばれない', async () => {
			vi.mocked(deleteByPrefix).mockResolvedValue(0);
			vi.mocked(listFiles).mockResolvedValue([]);

			await deleteChildFiles(3, TENANT);

			expect(logger.info).not.toHaveBeenCalled();
		});

		it('エラーが発生しても例外を投げずに logger.error でログ出力する', async () => {
			vi.mocked(deleteByPrefix).mockRejectedValue(new Error('Storage failure'));

			// 例外を投げないことを確認
			await expect(deleteChildFiles(4, TENANT)).resolves.toBeUndefined();

			expect(logger.error).toHaveBeenCalledWith(
				'[child-service] 子供の画像ファイル削除に失敗',
				expect.objectContaining({
					error: 'Storage failure',
					context: { childId: 4, tenantId: TENANT },
				}),
			);
		});

		it('レガシーファイルが空配列のときも正常に完了する', async () => {
			vi.mocked(deleteByPrefix).mockResolvedValue(0);
			vi.mocked(listFiles).mockResolvedValue([]);

			await deleteChildFiles(5, TENANT);

			// deleteFile はレガシーファイルがないので呼ばれない
			expect(deleteFile).not.toHaveBeenCalled();
			// logger.info は totalDeleted=0 なので呼ばれない
			expect(logger.info).not.toHaveBeenCalled();
		});
	});
});
