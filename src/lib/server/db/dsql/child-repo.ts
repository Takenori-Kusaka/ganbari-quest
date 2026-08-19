// src/lib/server/db/dsql/child-repo.ts
// EPIC #3424 / PR-R1 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.1 / §3 / §P9
//
// IChildRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) と
//     TransactionRunner を呼び出し側 (将来の client factory / テスト) が渡す。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **compute-on-read (§11.1)**: age 列は持たない。birth_date から calculateAgeFromBirthDate で
//     導出し、ui_mode は ui_mode_manually_set=false のとき年齢から recalcUiMode で再導出する
//     (誕生日跨ぎの tier 自動遷移。stored 値は手動 override 時のみ正)。
//     #4718: 年齢だけで登録した子供は `$lib/domain/child-age.ts` の規約で推定誕生日
//     (今年−年齢 の 1/1) を birth_date に保存し birth_date_estimated=true で印を付ける。
//     年齢導出 (deriveChildAge) と公開 birthDate (publicBirthDate = 実誕生日のみ) は domain SSOT。
//   - **deleteChild = 集約全削除を単一 txn** (§3「deleteChild が 11+ 表を 1 txn 削除」、DSQL は
//     FK/CASCADE 非対応 §P4 のため repo が全表を明示 DELETE。work は inline + tx-bound await のみ
//     = fitness#7 準拠)。invites.child_id は auth 集約のため touch しない (招待は期限切れで自然消滅)。
//   - entity 境界: Child.uiModeManuallySet / isArchived は number (0/1) 契約 — boolean 列を
//     読み出し時に変換 (既存 sqlite backend と同一 shape)。total_point は entity 未公開
//     (残高は point facade 経由、§5)。

import { sql } from 'drizzle-orm';
import {
	deriveChildAge,
	publicBirthDate,
	resolveBirthDateForInsert,
	resolveBirthDateForUpdate,
} from '$lib/domain/child-age';
import { asChildId } from '$lib/domain/ids';
import {
	getDefaultUiMode,
	isExplicitUiModeOverride,
	isValidUiMode,
	recalcUiMode,
	type UiMode,
} from '$lib/domain/validation/age-tier';
import type { ChildProgressResetCounts, IChildRepo } from '../interfaces/child-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { Child, UpdateChildInput } from '../types';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

export interface ChildRow {
	child_id: string;
	nickname: string;
	birth_date: string | null;
	birth_date_estimated: boolean;
	theme: string;
	ui_mode: string;
	ui_mode_manually_set: boolean;
	avatar_url: string | null;
	display_config: string | null;
	user_id: string | null;
	birthday_bonus_multiplier: number;
	last_birthday_bonus_year: number | null;
	is_archived: boolean;
	archived_reason: string | null;
	created_at: string;
	updated_at: string;
}

/** children の SELECT 列 (point/status repo の findChildById も共有、二重管理禁止)。 */
export const CHILD_COLUMNS = sql.raw(
	`child_id, nickname, birth_date, birth_date_estimated, theme, ui_mode, ui_mode_manually_set, avatar_url,
	 display_config, user_id, birthday_bonus_multiplier, last_birthday_bonus_year,
	 is_archived, archived_reason, created_at, updated_at`,
);

/** row → Child entity (compute-on-read: age 導出 + ui_mode 再導出、§11.1)。
 * point/status repo の findChildById からも共有する (mapping 二重実装禁止)。 */
export function toChild(row: ChildRow): Child {
	const age = deriveChildAge({ birthDate: row.birth_date });
	const storedUiMode: UiMode = isValidUiMode(row.ui_mode) ? row.ui_mode : 'preschool';
	const uiMode = row.birth_date
		? recalcUiMode(
				{ uiMode: storedUiMode, uiModeManuallySet: row.ui_mode_manually_set ? 1 : 0 },
				age,
			)
		: storedUiMode;
	return {
		id: asChildId(row.child_id),
		nickname: row.nickname,
		age,
		birthDate: publicBirthDate({
			birthDate: row.birth_date,
			birthDateEstimated: row.birth_date_estimated,
		}),
		theme: row.theme,
		uiMode,
		uiModeManuallySet: row.ui_mode_manually_set ? 1 : 0,
		avatarUrl: row.avatar_url,
		displayConfig: row.display_config,
		userId: row.user_id,
		birthdayBonusMultiplier: row.birthday_bonus_multiplier,
		lastBirthdayBonusYear: row.last_birthday_bonus_year,
		isArchived: row.is_archived ? 1 : 0,
		archivedReason: row.archived_reason,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** deleteChild で消す child 配下の表 (child_id 列を持つ全テナント表、§3 集約境界)。
 * #3584 ①: schema との網羅性突合は tests/unit/architecture/dsql-child-scoped-tables-fitness.test.ts
 * が機械保証する (新表追加時の list 未更新 = orphan 行残存を CI で検出)。export は同 fitness 用。 */
export const CHILD_SCOPED_TABLES = [
	'child_activities',
	'activity_logs',
	'point_ledger',
	'statuses',
	'status_history',
	'activity_mastery',
	'child_activity_preferences',
	'daily_missions',
	'login_streaks',
	'stamp_cards',
	// checklist_logs.itemsJson は text 据置 (子表 checklist_log_items 廃止、M3 §4.2)。
	'checklist_logs',
	'checklist_overrides',
	'checklist_template_assignments',
	'certificates',
	// evaluations.scoresJson は text 据置 (子表 evaluation_scores 廃止、M3 §4.2)。
	'evaluations',
	'rest_days',
	'daily_battles',
	'enemy_collection',
	'special_rewards',
	'reward_redemption_requests',
	'parent_messages',
	'character_images',
	'child_custom_voices',
	'child_challenges',
	'usage_logs',
] as const;

/** DSQL 用 IChildRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlChildRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IChildRepo {
	const readBirth = async (
		id: string,
		tenantId: string,
	): Promise<{ birthDate: string | null; birthDateEstimated: boolean } | undefined> => {
		const result = await db.execute(sql`
			SELECT birth_date, birth_date_estimated FROM children
			WHERE family_id = ${tenantId} AND child_id = ${id}
		`);
		const row = result.rows[0] as
			| { birth_date: string | null; birth_date_estimated: boolean }
			| undefined;
		return row
			? { birthDate: row.birth_date, birthDateEstimated: row.birth_date_estimated }
			: undefined;
	};

	const findMany = async (tenantWhere: ReturnType<typeof sql>): Promise<Child[]> => {
		const result = await db.execute(
			sql`SELECT ${CHILD_COLUMNS} FROM children WHERE ${tenantWhere} ORDER BY created_at, child_id`,
		);
		return (result.rows as unknown as ChildRow[]).map(toChild);
	};

	return {
		async findAllChildren(tenantId) {
			return findMany(sql`family_id = ${tenantId} AND is_archived = false`);
		},

		async findChildById(id, tenantId) {
			// #3709: stale cookie 由来の非 uuid id (旧 SQLite 数値 id 等) は 22P02 throw ではなく
			// not-found (undefined) に正規化する — route 層の cookie clear + redirect を機能させる。
			// #3581 ②: guard trip を rate-limited に warn (systematic id バグの observability)。
			if (!isUuidFormat(id)) {
				warnInvalidUuidId('child-repo.findChildById');
				return undefined;
			}
			const rows = await findMany(sql`family_id = ${tenantId} AND child_id = ${id}`);
			return rows[0];
		},

		async findChildByUserId(userId, tenantId) {
			const rows = await findMany(
				sql`family_id = ${tenantId} AND user_id = ${userId} AND is_archived = false`,
			);
			return rows[0];
		},

		async insertChild(input, tenantId) {
			// age は列に持たない (§11.1)。#4718: 誕生日未入力なら年齢から推定誕生日を合成して保存する
			// (birth_date_estimated=true)。規約は domain SSOT (child-age.ts)。
			const birth = resolveBirthDateForInsert(input);
			// 年齢既定と異なる明示 uiMode は手動 override として保存する (compute-on-read で消さない)。
			const manual = isExplicitUiModeOverride(input.age, input.uiMode);
			const result = await db.execute(sql`
				INSERT INTO children (family_id, nickname, birth_date, birth_date_estimated, theme, ui_mode, ui_mode_manually_set)
				VALUES (${tenantId}, ${input.nickname}, ${birth.birthDate}, ${birth.birthDateEstimated},
					${input.theme ?? 'pink'}, ${input.uiMode ?? getDefaultUiMode(input.age)}, ${manual})
				RETURNING ${CHILD_COLUMNS}
			`);
			return toChild(result.rows[0] as unknown as ChildRow);
		},

		async updateChild(id, input, tenantId) {
			// #3581 ②: admin の子供編集 form は raw な id を渡す (child layout の getChildById gate を
			// 経由しない経路)。非 uuid は「該当行なし」= 22P02 throw ではなく undefined (既存の
			// not-found 契約と同 shape) を返す。DB へは到達させない。
			if (!isUuidFormat(id)) {
				warnInvalidUuidId('child-repo.updateChild');
				return undefined;
			}
			// #4718: age / birthDate の更新は現在行の推定フラグに依存する (実誕生日は年齢入力で
			// 上書きしない) ため、現在値を読んでから domain 規約で差分を決める。
			const current = await readBirth(id, tenantId);
			if (!current) return undefined;
			const sets = buildUpdateSets(input, resolveBirthDateForUpdate(input, current));
			if (sets.length === 0) return this.findChildById(id, tenantId);
			const result = await db.execute(sql`
				UPDATE children SET ${sql.join(sets, sql`, `)}, updated_at = now()
				WHERE family_id = ${tenantId} AND child_id = ${id}
				RETURNING ${CHILD_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async deleteChild(id, tenantId) {
			// #3581 ②: removeChild は raw な id を deleteChild に直達させる (findChildById gate なし)。
			// 非 uuid は該当行なし = no-op (void 契約と同 shape) で早期 return し、22P02 を避ける。
			if (!isUuidFormat(id)) {
				warnInvalidUuidId('child-repo.deleteChild');
				return;
			}
			// 集約全削除を単一 txn (§3 / §P4)。work は inline + tx-bound await のみ (fitness#7)。
			await runner.runInTransaction(async (tx) => {
				for (const table of CHILD_SCOPED_TABLES) {
					if (table === 'stamp_cards') {
						// stamp_entries は card_id 参照 (child_id 列なし) のため cards より先に subquery 削除。
						await tx.execute(sql`
							DELETE FROM stamp_entries WHERE family_id = ${tenantId} AND card_id IN (
								SELECT card_id FROM stamp_cards WHERE family_id = ${tenantId} AND child_id = ${id}
							)
						`);
					}
					await tx.execute(
						sql`DELETE FROM ${sql.raw(table)} WHERE family_id = ${tenantId} AND child_id = ${id}`,
					);
				}
				// sibling_cheers は from/to の 2 参照軸 (child_id 列でないため個別)。
				await tx.execute(sql`
					DELETE FROM sibling_cheers
					WHERE family_id = ${tenantId} AND (from_child_id = ${id} OR to_child_id = ${id})
				`);
				await tx.execute(
					sql`DELETE FROM children WHERE family_id = ${tenantId} AND child_id = ${id}`,
				);
			});
		},

		async resetChildProgressData(id, tenantId): Promise<ChildProgressResetCounts> {
			// 記録系のみ初期化 (interface 契約の allowlist。statuses/バトル/チャレンジ等は意図的 survive)。
			// child_achievements は #322 廃止で DSQL に表が無い → 常に 0。pointBalance 派生行も
			// DSQL は children.total_point 列のため行削除は無し (0)。total_point は §5 P7 の
			// 不変条件 (== SUM(point_ledger)) を保つため同一 txn で 0 リセットする。
			// fitness#7 (tx-bound await のみ許可) 準拠のため helper 閉包を挟まず inline に await する。
			return runner.runInTransaction(async (tx) => {
				// #3625: 削除件数は CTE で DB 側 count 集約し、削除全行を client に materialize しない
				// (progress reset は長期 child で大量明細を削除しうる)。fitness#7: tx.execute 直呼び。
				const logs = await tx.execute(sql`
					WITH deleted AS (
						DELETE FROM activity_logs WHERE family_id = ${tenantId} AND child_id = ${id} RETURNING 1
					)
					SELECT count(*)::int AS c FROM deleted
				`);
				const ledger = await tx.execute(sql`
					WITH deleted AS (
						DELETE FROM point_ledger WHERE family_id = ${tenantId} AND child_id = ${id} RETURNING 1
					)
					SELECT count(*)::int AS c FROM deleted
				`);
				const bonuses = await tx.execute(sql`
					WITH deleted AS (
						DELETE FROM login_streaks WHERE family_id = ${tenantId} AND child_id = ${id} RETURNING 1
					)
					SELECT count(*)::int AS c FROM deleted
				`);
				await tx.execute(sql`
					UPDATE children SET total_point = 0, updated_at = now()
					WHERE family_id = ${tenantId} AND child_id = ${id}
				`);
				return {
					activityLogs: Number((logs.rows[0] as { c: number }).c),
					pointLedger: Number((ledger.rows[0] as { c: number }).c),
					loginBonuses: Number((bonuses.rows[0] as { c: number }).c),
					childAchievements: 0,
					pointBalance: 0,
				};
			});
		},

		async archiveChildren(ids, reason, tenantId) {
			if (ids.length === 0) return;
			await db.execute(sql`
				UPDATE children SET is_archived = true, archived_reason = ${reason}, updated_at = now()
				WHERE family_id = ${tenantId} AND child_id IN (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})
			`);
		},

		async restoreArchivedChildren(reason, tenantId) {
			await db.execute(sql`
				UPDATE children SET is_archived = false, archived_reason = NULL, updated_at = now()
				WHERE family_id = ${tenantId} AND is_archived = true AND archived_reason = ${reason}
			`);
		},

		async findArchivedChildren(tenantId) {
			return findMany(sql`family_id = ${tenantId} AND is_archived = true`);
		},
	};
}

/** UpdateChildInput → SET 句 (age は列に無い = compute-on-read §11.1。birth_date / 推定フラグは
 * domain 規約 resolveBirthDateForUpdate の差分 `birth` で書く、#4718)。 */
function buildUpdateSets(
	input: UpdateChildInput,
	birth: { birthDate?: string; birthDateEstimated?: boolean },
) {
	const sets: ReturnType<typeof sql>[] = [];
	if (input.nickname !== undefined) sets.push(sql`nickname = ${input.nickname}`);
	if (input.theme !== undefined) sets.push(sql`theme = ${input.theme}`);
	if (input.uiMode !== undefined) sets.push(sql`ui_mode = ${input.uiMode}`);
	if (input.uiModeManuallySet !== undefined)
		sets.push(sql`ui_mode_manually_set = ${input.uiModeManuallySet !== 0}`);
	if (birth.birthDate !== undefined) sets.push(sql`birth_date = ${birth.birthDate}`);
	if (birth.birthDateEstimated !== undefined)
		sets.push(sql`birth_date_estimated = ${birth.birthDateEstimated}`);
	if (input.displayConfig !== undefined) sets.push(sql`display_config = ${input.displayConfig}`);
	if (input.userId !== undefined) sets.push(sql`user_id = ${input.userId}`);
	if (input.birthdayBonusMultiplier !== undefined)
		sets.push(sql`birthday_bonus_multiplier = ${input.birthdayBonusMultiplier}`);
	if (input.lastBirthdayBonusYear !== undefined)
		sets.push(sql`last_birthday_bonus_year = ${input.lastBirthdayBonusYear}`);
	return sets;
}
