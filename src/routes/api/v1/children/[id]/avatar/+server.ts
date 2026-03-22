import { findChildById } from '$lib/server/db/activity-repo';
import { updateChildAvatarUrl } from '$lib/server/db/image-repo';
import { logger } from '$lib/server/logger';
import { saveFile } from '$lib/server/storage';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// bodyサイズ制限を10MBに引き上げ（写真アップロード用）
export const config = {
	body: {
		maxSize: '10m',
	},
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const POST: RequestHandler = async ({ params, request }) => {
	const childId = Number(params.id);
	if (!childId || Number.isNaN(childId)) {
		throw error(400, { message: '不正なIDです' });
	}

	const child = await findChildById(childId);
	if (!child) {
		throw error(404, { message: '子供が見つかりません' });
	}

	const formData = await request.formData();
	const file = formData.get('avatar');

	if (!(file instanceof File) || file.size === 0) {
		throw error(400, { message: 'ファイルを選択してください' });
	}

	if (!ALLOWED_TYPES.includes(file.type)) {
		throw error(400, { message: 'JPEG、PNG、WebP形式のみアップロードできます' });
	}

	if (file.size > MAX_FILE_SIZE) {
		throw error(400, { message: 'ファイルサイズは5MB以下にしてください' });
	}

	// ファイル名: avatar-{childId}-{timestamp}.{ext}
	const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
	const fileName = `avatar-${childId}-${Date.now()}.${ext}`;
	const storageKey = `uploads/avatars/${fileName}`;
	const publicUrl = `/uploads/avatars/${fileName}`;

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		await saveFile(storageKey, buffer, file.type);

		// DB更新
		await updateChildAvatarUrl(childId, publicUrl);
	} catch (err) {
		logger.error('[avatar] アバター保存失敗', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
			context: { childId, fileName },
		});
		throw error(500, { message: 'アバターの保存に失敗しました' });
	}

	return json({ avatarUrl: publicUrl });
};
