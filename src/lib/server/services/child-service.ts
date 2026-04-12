import { getDefaultUiMode } from '$lib/domain/validation/age-tier';
import {
	deleteChild,
	findAllChildren,
	findArchivedChildren,
	findChildById,
	findChildByUserId,
	insertChild,
	updateChild,
} from '$lib/server/db/child-repo';
import { logger } from '$lib/server/logger';
import { deleteByPrefix, deleteFile, listFiles } from '$lib/server/storage';
import { childPrefix } from '$lib/server/storage-keys';

export async function getAllChildren(tenantId: string) {
	return await findAllChildren(tenantId);
}

export async function getArchivedChildren(tenantId: string) {
	return await findArchivedChildren(tenantId);
}

export async function getChildById(id: number, tenantId: string) {
	return await findChildById(id, tenantId);
}

export async function getChildByUserId(userId: string, tenantId: string) {
	return await findChildByUserId(userId, tenantId);
}

export async function addChild(
	input: {
		nickname: string;
		age: number;
		theme?: string;
		uiMode?: string;
		birthDate?: string;
	},
	tenantId: string,
) {
	return await insertChild(input, tenantId);
}

export async function editChild(
	id: number,
	input: {
		nickname?: string;
		age?: number;
		theme?: string;
		uiMode?: string;
		birthDate?: string | null;
		displayConfig?: string | null;
		birthdayBonusMultiplier?: number;
		lastBirthdayBonusYear?: number | null;
	},
	tenantId: string,
) {
	// #580: age が変更された場合は uiMode も自動再計算（年齢境界越え対応）。
	// 呼び出し側が uiMode を明示的に指定している場合はその値を尊重する（手動上書きを許容）。
	const patched: typeof input = { ...input };
	if (patched.age !== undefined && patched.uiMode === undefined) {
		patched.uiMode = getDefaultUiMode(patched.age);
	}
	return await updateChild(id, patched, tenantId);
}

export async function removeChild(id: number, tenantId: string) {
	// 物理ファイル削除（アバター画像・AI生成画像）
	await deleteChildFiles(id, tenantId);

	return await deleteChild(id, tenantId);
}

/** 子供に紐づく物理ファイルを削除 */
export async function deleteChildFiles(childId: number, tenantId: string): Promise<void> {
	try {
		let totalDeleted = 0;

		// 新パス: tenants/{tenantId}/avatars/{childId}/ 配下を一括削除
		totalDeleted += await deleteByPrefix(childPrefix(tenantId, childId, 'avatars'));
		totalDeleted += await deleteByPrefix(childPrefix(tenantId, childId, 'generated'));
		totalDeleted += await deleteByPrefix(childPrefix(tenantId, childId, 'voices'));

		// レガシーパス: 旧形式のファイルも削除（移行前データ対応）
		const legacyAvatars = await listFiles(`uploads/avatars/avatar-${childId}-`);
		for (const file of legacyAvatars) {
			await deleteFile(file);
		}
		const legacyGenerated = await listFiles(`generated/avatar-${childId}-`);
		for (const file of legacyGenerated) {
			await deleteFile(file);
		}
		totalDeleted += legacyAvatars.length + legacyGenerated.length;

		if (totalDeleted > 0) {
			logger.info('[child-service] 子供の画像ファイルを削除しました', {
				context: { childId, tenantId, totalDeleted },
			});
		}
	} catch (err) {
		logger.error('[child-service] 子供の画像ファイル削除に失敗', {
			error: err instanceof Error ? err.message : String(err),
			context: { childId, tenantId },
		});
	}
}
