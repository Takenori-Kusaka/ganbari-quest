import {
	deleteChild,
	findAllChildren,
	findChildById,
	insertChild,
	updateChild,
} from '$lib/server/db/child-repo';
import { logger } from '$lib/server/logger';
import { deleteFile, listFiles } from '$lib/server/storage';

export async function getAllChildren(tenantId: string) {
	return await findAllChildren(tenantId);
}

export async function getChildById(id: number, tenantId: string) {
	return await findChildById(id, tenantId);
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
	},
	tenantId: string,
) {
	return await updateChild(id, input, tenantId);
}

export async function removeChild(id: number, tenantId: string) {
	// 物理ファイル削除（アバター画像・AI生成画像）
	await deleteChildFiles(id);

	return await deleteChild(id, tenantId);
}

/** 子供に紐づく物理ファイルを削除 */
async function deleteChildFiles(childId: number): Promise<void> {
	try {
		// アバター画像: uploads/avatars/avatar-{childId}-*
		const avatarFiles = await listFiles(`uploads/avatars/avatar-${childId}-`);
		for (const file of avatarFiles) {
			await deleteFile(file);
		}

		// AI生成画像: generated/avatar-{childId}-*
		const generatedFiles = await listFiles(`generated/avatar-${childId}-`);
		for (const file of generatedFiles) {
			await deleteFile(file);
		}

		if (avatarFiles.length > 0 || generatedFiles.length > 0) {
			logger.info('[child-service] 子供の画像ファイルを削除しました', {
				context: {
					childId,
					avatarFiles: avatarFiles.length,
					generatedFiles: generatedFiles.length,
				},
			});
		}
	} catch (err) {
		logger.error('[child-service] 子供の画像ファイル削除に失敗', {
			error: err instanceof Error ? err.message : String(err),
			context: { childId },
		});
	}
}
