import { eq, isNull, or } from 'drizzle-orm';
import type { ArchivedReason } from '$lib/domain/archive-types';
import {
	deriveChildAge,
	publicBirthDate,
	resolveBirthDateForInsert,
	resolveBirthDateForUpdate,
} from '$lib/domain/child-age';
import { asChildId, type ChildId } from '$lib/domain/ids';
import {
	getDefaultUiMode,
	isExplicitUiModeOverride,
	normalizeUiMode,
} from '$lib/domain/validation/age-tier';
import { db } from '../client';
import type { ChildProgressResetCounts } from '../interfaces/child-repo.interface';
import { hydrate } from '../migration';
import { ENTITY_VERSIONS } from '../migration/registry';
import { SCHEMA_VERSION_FIELD } from '../migration/types';
import {
	activityLogs,
	characterImages,
	checklistLogs,
	checklistOverrides,
	childAchievements,
	children,
	evaluations,
	loginStreaks,
	pointLedger,
	specialRewards,
	statuses,
	statusHistory,
} from '../schema';

type ChildRow = typeof children.$inferSelect;
type Child = import('../types').Child;

/**
 * row → Child entity。#4718: 年齢は birth_date から導出 (pg-core backend と同じ domain 規約)、
 * birth_date が無い旧行だけ age 列にフォールバック。公開 birthDate は実誕生日のみ
 * (推定値は null)。birthDateEstimated 列は entity に出さない (storage 内部の印)。
 */
const toChild = (r: ChildRow): Child => {
	const { birthDateEstimated, ...rest } = r;
	return {
		...rest,
		id: asChildId(r.id),
		age: deriveChildAge({ birthDate: r.birthDate, age: r.age }),
		birthDate: publicBirthDate({
			birthDate: r.birthDate,
			birthDateEstimated: birthDateEstimated === 1,
		}),
	};
};

/**
 * SQLite child row を最新スキーマに hydrate し、必要なら DB に書き戻す。
 *
 * #571: 旧 ui_mode コード (kinder/lower/upper/teen) が DB に残っていると
 * `/${uiMode}/home` リダイレクトが 404 を返す。defensive に
 * `normalizeUiMode()` を毎回適用し、変化があれば書き戻す。
 *
 * 過去バージョン (#NA) の `writeBackChildSv()` は _sv フィールドのみを
 * 更新し transformer を適用していなかったため、`ui_mode='kinder'` の行が
 * `_sv=3` でロックされて永久に直らない状態だった。本関数は hydrate を
 * 走らせた上で、_sv によらず ui_mode を必ず正規化することでこの汚染を
 * 解消する。
 */
function hydrateChildRow(row: ChildRow): ChildRow {
	// 1. transformer chain を走らせる（_sv が古い場合のみ実効）
	const { data: migrated, didMigrate } = hydrate(
		'child',
		row as unknown as Record<string, unknown>,
	);

	// 2. defensive: _sv が既に最新でも、過去の broken writeback で
	//    汚染された ui_mode を必ず正規化する
	const rawUiMode = (migrated.uiMode as string | null) ?? null;
	const normalizedUiMode = rawUiMode ? normalizeUiMode(rawUiMode) : rawUiMode;
	const uiModeChanged = normalizedUiMode !== rawUiMode;

	// 3. 変化があれば書き戻す
	if (didMigrate || uiModeChanged) {
		try {
			db.update(children)
				.set({
					uiMode: normalizedUiMode ?? undefined,
					[SCHEMA_VERSION_FIELD]: ENTITY_VERSIONS.child.latest,
				})
				.where(eq(children.id, row.id))
				.run();
		} catch {
			// Write-back failure is non-fatal — caller still gets normalized data
		}
	}

	return {
		...(migrated as unknown as ChildRow),
		uiMode: normalizedUiMode,
		[SCHEMA_VERSION_FIELD]: ENTITY_VERSIONS.child.latest,
	} as ChildRow;
}

export async function findAllChildren(_tenantId: string) {
	// #783 互換: is_archived カラムが NULL の既存行も active として扱う。
	// drizzle-kit push 後の SQLite ALTER TABLE では DEFAULT 0 が即座に反映されるが、
	// マイグレーション未実行環境や中間状態に備えて defensive に対応。
	const rows = db
		.select()
		.from(children)
		.where(or(eq(children.isArchived, 0), isNull(children.isArchived)))
		.all();
	return rows.map((r) => toChild(hydrateChildRow(r)));
}

export async function findChildById(id: ChildId, _tenantId: string) {
	const row = db
		.select()
		.from(children)
		.where(eq(children.id, Number(id)))
		.get();
	if (!row) return undefined;
	return toChild(hydrateChildRow(row));
}

export async function findChildByUserId(userId: string, _tenantId: string) {
	const row = db.select().from(children).where(eq(children.userId, userId)).get();
	if (!row) return undefined;
	return toChild(hydrateChildRow(row));
}

export async function insertChild(
	input: {
		nickname: string;
		age: number;
		theme?: string;
		uiMode?: string;
		birthDate?: string;
	},
	_tenantId: string,
) {
	// #4718: 誕生日未入力なら年齢から推定誕生日を合成して保存する (domain 規約 SSOT)。
	const birth = resolveBirthDateForInsert(input);
	const row = db
		.insert(children)
		.values({
			nickname: input.nickname,
			age: input.age,
			theme: input.theme ?? 'pink',
			uiMode: input.uiMode ?? getDefaultUiMode(input.age),
			uiModeManuallySet: isExplicitUiModeOverride(input.age, input.uiMode) ? 1 : 0,
			birthDate: birth.birthDate,
			birthDateEstimated: birth.birthDateEstimated ? 1 : 0,
			[SCHEMA_VERSION_FIELD]: ENTITY_VERSIONS.child.latest,
		})
		.returning()
		.get();
	return toChild(row);
}

export async function updateChild(
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
	_tenantId: string,
) {
	// #4718: birth_date / 推定フラグの差分は現在行の推定状態に依存する (実誕生日は年齢入力で
	// 上書きしない) ため、現在値を読んでから domain 規約で決める。age 列は互換のため併記する。
	const current = db
		.select({ birthDate: children.birthDate, birthDateEstimated: children.birthDateEstimated })
		.from(children)
		.where(eq(children.id, Number(id)))
		.get();
	if (!current) return undefined;
	const birth = resolveBirthDateForUpdate(input, {
		birthDate: current.birthDate,
		birthDateEstimated: current.birthDateEstimated === 1,
	});
	const { birthDate: _ignoredBirthDate, ...rest } = input;
	const row = db
		.update(children)
		.set({
			...rest,
			...(birth.birthDate !== undefined ? { birthDate: birth.birthDate } : {}),
			...(birth.birthDateEstimated !== undefined
				? { birthDateEstimated: birth.birthDateEstimated ? 1 : 0 }
				: {}),
			updatedAt: new Date().toISOString(),
		})
		.where(eq(children.id, Number(id)))
		.returning()
		.get();
	return row ? toChild(row) : undefined;
}

export async function deleteChild(childIdArg: ChildId, _tenantId: string) {
	const id = Number(childIdArg);
	// トランザクションで関連データをすべて削除
	return db.transaction((tx) => {
		tx.delete(checklistOverrides).where(eq(checklistOverrides.childId, id)).run();
		tx.delete(checklistLogs).where(eq(checklistLogs.childId, id)).run();
		tx.delete(specialRewards).where(eq(specialRewards.childId, id)).run();
		tx.delete(childAchievements).where(eq(childAchievements.childId, id)).run();
		tx.delete(loginStreaks).where(eq(loginStreaks.childId, id)).run();
		tx.delete(characterImages).where(eq(characterImages.childId, id)).run();
		tx.delete(evaluations).where(eq(evaluations.childId, id)).run();
		tx.delete(statusHistory).where(eq(statusHistory.childId, id)).run();
		tx.delete(statuses).where(eq(statuses.childId, id)).run();
		tx.delete(pointLedger).where(eq(pointLedger.childId, id)).run();
		tx.delete(activityLogs).where(eq(activityLogs.childId, id)).run();
		tx.delete(children).where(eq(children.id, id)).run();
	});
}

export async function resetChildProgressData(
	childIdArg: ChildId,
	_tenantId: string,
): Promise<ChildProgressResetCounts> {
	const id = Number(childIdArg);
	// #3152: 子供 1 人分の進捗データを削除 (child 行は残す)。
	// 削除対象 4 テーブルはトランザクションで一括削除する。
	// #3184 item2: 削除件数を診断用に返す。SQLite は POINT# 行集計のため pointBalance は常に 0。
	return db.transaction((tx) => ({
		activityLogs: tx.delete(activityLogs).where(eq(activityLogs.childId, id)).run().changes,
		pointLedger: tx.delete(pointLedger).where(eq(pointLedger.childId, id)).run().changes,
		loginBonuses: tx.delete(loginStreaks).where(eq(loginStreaks.childId, id)).run().changes,
		childAchievements: tx.delete(childAchievements).where(eq(childAchievements.childId, id)).run()
			.changes,
		pointBalance: 0,
	}));
}

// #783: archive / restore
// Phase 7 PR-2a (#2688): reason 引数を `ArchivedReason` 型に強制 (PR-1 #2685 で配備済の
// `ARCHIVED_REASONS` SSOT integration)。schema.ts L45 の enum 制約と同期で型安全担保。

export async function archiveChildren(ids: ChildId[], reason: ArchivedReason, _tenantId: string) {
	if (ids.length === 0) return;
	for (const id of ids) {
		db.update(children)
			.set({ isArchived: 1, archivedReason: reason, updatedAt: new Date().toISOString() })
			.where(eq(children.id, Number(id)))
			.run();
	}
}

export async function restoreArchivedChildren(reason: ArchivedReason, _tenantId: string) {
	db.update(children)
		.set({ isArchived: 0, archivedReason: null, updatedAt: new Date().toISOString() })
		.where(eq(children.archivedReason, reason))
		.run();
}

export async function findArchivedChildren(_tenantId: string) {
	const rows = db.select().from(children).where(eq(children.isArchived, 1)).all();
	return rows.map((r) => toChild(hydrateChildRow(r)));
}
