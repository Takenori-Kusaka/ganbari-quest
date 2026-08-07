import type { ChildId } from '$lib/domain/ids';
import {
	buildPlaceholderAvatarSvg,
	PLACEHOLDER_AVATAR_CONTENT_TYPE,
	PLACEHOLDER_AVATAR_EXTENSION,
} from '$lib/domain/placeholder-avatar';
import type { UiMode } from '$lib/domain/validation/age-tier';
import { getDefaultUiMode, recalcUiMode } from '$lib/domain/validation/age-tier';
import {
	deleteChild,
	findAllChildren,
	findArchivedChildren,
	findChildById,
	findChildByUserId,
	insertChild,
	updateChild,
} from '$lib/server/db/child-repo';
import { updateChildAvatarUrl } from '$lib/server/db/image-repo';
import { logger } from '$lib/server/logger';
import { deleteByPrefix, deleteFile, listFiles, saveFile } from '$lib/server/storage';
import {
	assertTenantScopedStorageKey,
	childPrefix,
	placeholderAvatarKey,
	storageKeyToPublicUrl,
} from '$lib/server/storage-keys';

export async function getAllChildren(tenantId: string) {
	return await findAllChildren(tenantId);
}

export async function getArchivedChildren(tenantId: string) {
	return await findArchivedChildren(tenantId);
}

export async function getChildById(id: ChildId, tenantId: string) {
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
	// #4419: UI モードは年齢から自動判定する (getDefaultUiMode が SSOT)。
	// route 側で判定すると片方だけ通らない (実際 `/admin/children` が uiMode を渡しておらず、
	// 本番 backend で年齢に関わらず幼児 UI になっていた) ため、両登録経路が通る本関数に
	// 1 箇所だけ置く — #4413 の仮アバターを addChild に置いたのと同じ理由。
	// 保護者が明示指定した uiMode は尊重する (手動フラグは editChild 側の責務)。
	const resolved = { ...input, uiMode: input.uiMode ?? getDefaultUiMode(input.age) };
	const child = await insertChild(resolved, tenantId);
	return await attachPlaceholderAvatar(child, tenantId);
}

/**
 * #4413: 登録した子供に仮アバター (ニックネームの頭文字 + テーマ色) を付ける。
 *
 * **子供の登録経路は `/setup/children` と `/admin/children` の 2 つある**。両方が `addChild` を
 * 通るため、ここに 1 箇所だけ置くことで「片方だけ付く」が構造的に起きない
 * (route 側に置くと 2 箇所の実装が食い違いうる)。
 *
 * 生成は外部通信ゼロ (`buildPlaceholderAvatarSvg` は import を持たない純粋関数)。
 * 保護者が写真をアップロードすれば `avatar_url` が上書きされ、仮アバターは差し替えられる。
 *
 * アバターは付加価値であって登録・編集の前提条件ではないので、**失敗しても呼び出し元の操作は
 * 成功させる** (storage 不調で子供を登録・編集できない方が顧客にとって悪い)。その場合は
 * 一覧で 👤 or 古い仮アバターのままになる。
 *
 * #4453: `editChild` からも呼ぶ。仮アバターは nickname + theme から導出されるので、
 * 導出元が変わったら追随させないと「名前を直したのに古い頭文字のまま」になる。
 * ただし**保護者がアップロードした写真は上書きしない** — 呼ぶ前に
 * `shouldRegeneratePlaceholderAvatar` で `avatar_url` が仮アバター自身か未設定かを確認すること。
 */
async function attachPlaceholderAvatar<T extends { id: ChildId; nickname: string; theme: string }>(
	child: T,
	tenantId: string,
): Promise<T> {
	try {
		const key = placeholderAvatarKey(tenantId, child.id, PLACEHOLDER_AVATAR_EXTENSION);
		assertTenantScopedStorageKey(key, tenantId);

		const svg = buildPlaceholderAvatarSvg(child.nickname, child.theme);
		await saveFile(key, Buffer.from(svg, 'utf-8'), PLACEHOLDER_AVATAR_CONTENT_TYPE);

		const publicUrl = storageKeyToPublicUrl(key);
		await updateChildAvatarUrl(child.id, publicUrl, tenantId);

		return { ...child, avatarUrl: publicUrl };
	} catch (err) {
		logger.warn('[child-service] 仮アバターの生成に失敗しました（登録・編集は継続します）', {
			context: { childId: child.id, tenantId },
			error: err instanceof Error ? err.message : String(err),
		});
		return child;
	}
}

export async function editChild(
	id: ChildId,
	input: {
		nickname?: string;
		age?: number;
		theme?: string;
		uiMode?: string;
		uiModeManuallySet?: number;
		birthDate?: string | null;
		displayConfig?: string | null;
		birthdayBonusMultiplier?: number;
		lastBirthdayBonusYear?: number | null;
	},
	tenantId: string,
) {
	const patched: typeof input = { ...input };

	// #4453: 仮アバターは nickname + theme から導出されるので、どちらかが変わったら作り直す。
	// 判定には「変更前の値」が要る。uiMode 再計算 (#580/#1382) も同じ既存行を見るため、
	// ここで 1 回だけ引いて両方で使う (同じ行を 2 回引かない)。
	const needsExisting =
		input.nickname !== undefined ||
		input.theme !== undefined ||
		(patched.uiMode === undefined && patched.age !== undefined);
	const existing = needsExisting ? await findChildById(id, tenantId) : null;

	if (patched.uiMode !== undefined) {
		// #1382: 保護者が明示的に UIMode を指定 → 手動フラグを立てる
		patched.uiModeManuallySet = 1;
	} else if (patched.age !== undefined && existing) {
		// #580/#1382: age 変更時は既存フラグを参照して自動再計算するか判断する
		patched.uiMode = recalcUiMode(
			{ uiMode: existing.uiMode as UiMode, uiModeManuallySet: existing.uiModeManuallySet ?? 0 },
			patched.age,
		);
	}

	const updated = await updateChild(id, patched, tenantId);

	if (existing && shouldRegeneratePlaceholderAvatar(existing, input, id, tenantId)) {
		// 失敗しても編集は成功させる (attachPlaceholderAvatar が内部で握って warn する)。
		await attachPlaceholderAvatar(
			{
				id,
				nickname: input.nickname ?? existing.nickname,
				theme: input.theme ?? existing.theme,
			},
			tenantId,
		);
	}

	return updated;
}

/**
 * #4453: 編集後に仮アバターを作り直すべきか。
 *
 * **保護者がアップロードした写真を消さないことが本判定の主目的**。仮アバターは childId ごとの
 * 固定名キー (`placeholderAvatarKey`) なので、`avatar_url` がそのキーを指していれば「まだ仮アバター
 * のまま」= 上書きしてよい。写真をアップロードすると `avatar_url` は uuid キー (別 URL) に変わるため、
 * その子は対象外になる。`avatar_url` が未設定なら消せる写真自体が無いので生成してよい
 * (#4413 以前に登録された子供 / 仮アバター生成に失敗した子供がここに該当する)。
 */
function shouldRegeneratePlaceholderAvatar(
	existing: { nickname: string; theme: string; avatarUrl?: string | null },
	input: { nickname?: string; theme?: string },
	id: ChildId,
	tenantId: string,
): boolean {
	const nicknameChanged = input.nickname !== undefined && input.nickname !== existing.nickname;
	const themeChanged = input.theme !== undefined && input.theme !== existing.theme;
	if (!nicknameChanged && !themeChanged) return false;

	if (!existing.avatarUrl) return true;
	const placeholderUrl = storageKeyToPublicUrl(
		placeholderAvatarKey(tenantId, id, PLACEHOLDER_AVATAR_EXTENSION),
	);
	return existing.avatarUrl === placeholderUrl;
}

export async function removeChild(id: ChildId, tenantId: string) {
	// 物理ファイル削除（アバター画像・AI生成画像）
	await deleteChildFiles(id, tenantId);

	return await deleteChild(id, tenantId);
}

/** 子供に紐づく物理ファイルを削除 */
export async function deleteChildFiles(childId: ChildId, tenantId: string): Promise<void> {
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
