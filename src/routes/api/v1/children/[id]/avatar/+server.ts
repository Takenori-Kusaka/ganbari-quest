import { requireTenantId } from '$lib/server/auth/factory';
import { findChildById } from '$lib/server/db/activity-repo';
import { updateChildAvatarUrl } from '$lib/server/db/image-repo';
import { logger } from '$lib/server/logger';
import { sanitizeImage } from '$lib/server/security/file-sanitizer';
import { validateImageMagicBytes } from '$lib/server/security/magic-bytes';
import { deleteFile, saveFile } from '$lib/server/storage';
import { avatarKey, storageKeyToPublicUrl } from '$lib/server/storage-keys';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.id);
	if (!childId || Number.isNaN(childId)) {
		throw error(400, { message: '不正なIDです' });
	}

	const child = await findChildById(childId, tenantId);
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

	// マジックバイト検証（Content-Type偽装対策）
	const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	const magicCheck = validateImageMagicBytes(headerBytes, file.type);
	if (!magicCheck.valid) {
		throw error(400, { message: 'ファイルの内容が宣言された形式と一致しません' });
	}

	const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
	const storageKey = avatarKey(tenantId, childId, ext);
	const publicUrl = storageKeyToPublicUrl(storageKey);

	try {
		const rawBuffer = Buffer.from(await file.arrayBuffer());
		// 画像 re-encode: メタデータ・Polyglotペイロードを完全除去
		const { buffer } = await sanitizeImage(rawBuffer, file.type);
		await saveFile(storageKey, buffer, file.type);

		// 旧アバターファイルを削除（パスがあり、新パスと異なる場合）
		if (child.avatarUrl && child.avatarUrl !== publicUrl) {
			const oldKey = child.avatarUrl.startsWith('/') ? child.avatarUrl.slice(1) : child.avatarUrl;
			try {
				await deleteFile(oldKey);
			} catch {
				// 旧ファイル削除失敗は無視（孤立ファイルは定期クリーンアップで対応）
			}
		}

		// DB更新
		await updateChildAvatarUrl(childId, publicUrl, tenantId);
	} catch (err) {
		logger.error('[avatar] アバター保存失敗', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
			context: { childId, storageKey },
		});
		throw error(500, { message: 'アバターの保存に失敗しました' });
	}

	return json({ avatarUrl: publicUrl });
};
