/**
 * Activity import row shape — used by CSV / JSON ファイルインポート時のパース中間型。
 *
 * プリセット配布は `$lib/data/marketplace` の SSOT に一本化されたため、
 * かつての `ActivityPack` / `ActivityPackMeta` / `ActivityPackIndex` は削除した。
 * ユーザがアップロードする CSV・JSON の 1 行を表現する型のみ残す。
 */

import type { CategoryCode, GradeLevel } from './validation/activity.js';

export interface ActivityPackItem {
	name: string;
	nameKana?: string;
	nameKanji?: string;
	categoryCode: CategoryCode;
	icon: string;
	basePoints: number;
	ageMin: number | null;
	ageMax: number | null;
	gradeLevel: GradeLevel | null;
	triggerHint?: string;
	description?: string;
	/**
	 * #1758 (#1709-D): 「今日のおやくそく（must 推奨）」候補フラグ。
	 * `true` の活動は import 時に既定で `activities.priority='must'` として展開される。
	 * 親側 UI のチェックボックスで OFF を選んだ場合は無視され、全活動が `'optional'` になる。
	 */
	mustDefault?: boolean;
}
