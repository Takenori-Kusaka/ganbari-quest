/**
 * きょうだいの表示名解決。
 *
 * #4509 ⑤: 祝福オーバーレイは名前が引けなかったとき `#${childId}` を描画しており、
 * 内部 ID が子供の画面に露出しうる (DESIGN.md §6「内部コード露出禁止」、過去事例 #498 / #573)。
 * 名前が無い場合は汎用語にフォールバックする。ID は決して画面に出さない。
 */
import { CHILD_HOME_LABELS } from '$lib/domain/labels';

interface SiblingLike {
	id: string | number;
	nickname?: string | null;
}

/**
 * `childId` に対応するニックネームを返す。引けない / 空の場合は汎用語を返す。
 */
export function resolveSiblingDisplayName(
	children: readonly SiblingLike[] | null | undefined,
	childId: string | number,
): string {
	const nickname = children?.find((c) => c.id === childId)?.nickname;
	if (typeof nickname === 'string' && nickname.trim() !== '') return nickname;
	return CHILD_HOME_LABELS.siblingUnknownName;
}
