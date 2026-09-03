import type { ChildId } from '$lib/domain/ids';
import {
	buildPlaceholderAvatarSvg,
	PLACEHOLDER_AVATAR_CONTENT_TYPE,
	PLACEHOLDER_AVATAR_EXTENSION,
	placeholderAvatarVersion,
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
import { updateChildAvatarUrlIfMatches } from '$lib/server/db/image-repo';
import { logger } from '$lib/server/logger';
import { deleteByPrefix, deleteFile, listFiles, saveFile } from '$lib/server/storage';
import {
	assertTenantScopedStorageKey,
	childPrefix,
	placeholderAvatarKey,
	publicUrlToStorageKey,
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
	return (await attachPlaceholderAvatar(child, tenantId)).child;
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
 *
 * #4466: その事前確認は「読んだ時点」の判断でしかない。ここに来るまでに DB write + SVG 生成 +
 * storage write の await が挟まるので、その窓で保護者の写真アップロードが完了しうる。
 * **書き込みは `child.avatarUrl` (読んだ時点の値) を期待値にした条件付き更新**で行い、
 * レースに負けたら 0 行更新で写真を残す (`updateChildAvatarUrlIfMatches`)。
 * 呼び出し元は `child.avatarUrl` に**判定に使った値そのもの**を渡すこと。
 *
 * #4546 ③: レースに負けて見送ったことを `skipped` で返す。warn だけだと保護者には
 * 「名前を直したのにアバターが古いまま」が黙って起きる (ADR-0062 §1「一時的・回復可能」= Toast)。
 * 生成失敗 (catch 側) は `skipped` にしない — 保護者に打てる手が無く、通知しても不安を煽るだけで、
 * 見送り (= 写真が優先された、正常な結果) とは意味が違う。
 */
async function attachPlaceholderAvatar<
	T extends { id: ChildId; nickname: string; theme: string; avatarUrl?: string | null },
>(child: T, tenantId: string): Promise<{ child: T; skipped: boolean }> {
	try {
		const key = placeholderAvatarKey(tenantId, child.id, PLACEHOLDER_AVATAR_EXTENSION);
		assertTenantScopedStorageKey(key, tenantId);

		const svg = buildPlaceholderAvatarSvg(child.nickname, child.theme);
		await saveFile(key, Buffer.from(svg, 'utf-8'), PLACEHOLDER_AVATAR_CONTENT_TYPE);

		// #4453: 保存先は固定名なので、中身から導いた版を URL に付けて「作り直したのに
		// ブラウザが古い画像を出し続ける」(max-age=300) を防ぐ。配信側は path でルーティング
		// するため query は無視される。
		const publicUrl = `${storageKeyToPublicUrl(key)}?v=${placeholderAvatarVersion(child.nickname, child.theme)}`;
		const written = await updateChildAvatarUrlIfMatches(
			child.id,
			child.avatarUrl ?? null,
			publicUrl,
			tenantId,
		);
		if (!written) {
			// レースで負けた = この間に avatar_url が別の値になった (写真アップロードが典型)。
			// 仮アバターは付加価値なので操作自体は成功させるが、黙って諦めると運営が気づけない。
			// 書いた SVG (固定名キー) は誰からも参照されないだけで、写真の実体には触れていない。
			logger.warn(
				'[child-service] 仮アバターの反映を見送りました（この間に avatar_url が変わったため。写真は保持されます）',
				{ context: { childId: child.id, tenantId } },
			);
			return { child, skipped: true };
		}

		return { child: { ...child, avatarUrl: publicUrl }, skipped: false };
	} catch (err) {
		logger.warn('[child-service] 仮アバターの生成に失敗しました（登録・編集は継続します）', {
			context: { childId: child.id, tenantId },
			error: err instanceof Error ? err.message : String(err),
		});
		return { child, skipped: false };
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
	// #4729: 誕生日クリア (`birthDate: null`) は保存値を「推定扱い」に降格するだけで、月日は DB に残る
	// (`resolveBirthDateForUpdate`)。降格が起きたか (= 実誕生日があったか) は変更前の行でしか分からない。
	const needsExisting =
		input.nickname !== undefined ||
		input.theme !== undefined ||
		input.birthDate === null ||
		(patched.uiMode === undefined && patched.age !== undefined);
	const existing = needsExisting ? await findChildById(id, tenantId) : null;

	// #4729 PO 回答 (2026-09-03): 誕生日を消したら誕生日ボーナスの対象外になる (降格は維持) が、
	// **黙って降格してはならない**。公開 entity の `birthDate` は実誕生日のときだけ非 null
	// (`publicBirthDate`) なので、「実誕生日があった行に null を書いた」= 降格が起きた、と判定できる。
	const birthdayCleared = input.birthDate === null && !!existing?.birthDate;

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

	// #4546 ③: 仮アバターの反映を見送ったかを呼び出し元 (form action → 画面の Toast) に返す。
	let placeholderAvatarSkipped = false;

	if (existing && shouldRegeneratePlaceholderAvatar(existing, input, id, tenantId)) {
		// 失敗しても編集は成功させる (attachPlaceholderAvatar が内部で握って warn する)。
		const attached = await attachPlaceholderAvatar(
			{
				id,
				nickname: input.nickname ?? existing.nickname,
				theme: input.theme ?? existing.theme,
				// #4466: 判定に使った値をそのまま期待値として渡す。書き込みまでの間に
				// 写真がアップロードされていたら 0 行更新になり、写真を踏み潰さない。
				avatarUrl: existing.avatarUrl ?? null,
			},
			tenantId,
		);
		placeholderAvatarSkipped = attached.skipped;
	}

	return { child: updated, placeholderAvatarSkipped, birthdayCleared };
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
	// `?v=<版>` が付いている (#4453) ので、key に戻して (query を落として) 比べる。
	return (
		publicUrlToStorageKey(existing.avatarUrl) ===
		placeholderAvatarKey(tenantId, id, PLACEHOLDER_AVATAR_EXTENSION)
	);
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
