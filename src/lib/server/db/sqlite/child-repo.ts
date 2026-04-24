import { eq, isNull, or } from 'drizzle-orm';
import { normalizeUiMode } from '$lib/domain/validation/age-tier';
import { db } from '../client';
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
	loginBonuses,
	pointLedger,
	specialRewards,
	statuses,
	statusHistory,
} from '../schema';

type ChildRow = typeof children.$inferSelect;

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
	return rows.map(hydrateChildRow);
}

export async function findChildById(id: number, _tenantId: string) {
	const row = db.select().from(children).where(eq(children.id, id)).get();
	if (!row) return row;
	return hydrateChildRow(row);
}

export async function findChildByUserId(userId: string, _tenantId: string) {
	const row = db.select().from(children).where(eq(children.userId, userId)).get();
	if (!row) return row;
	return hydrateChildRow(row);
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
	return db
		.insert(children)
		.values({
			nickname: input.nickname,
			age: input.age,
			theme: input.theme ?? 'pink',
			uiMode: input.uiMode ?? (input.age <= 2 ? 'baby' : 'preschool'),
			birthDate: input.birthDate ?? null,
			[SCHEMA_VERSION_FIELD]: ENTITY_VERSIONS.child.latest,
		})
		.returning()
		.get();
}

export async function updateChild(
	id: number,
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
	return db
		.update(children)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(children.id, id))
		.returning()
		.get();
}

export async function deleteChild(id: number, _tenantId: string) {
	// トランザクションで関連データをすべて削除
	return db.transaction((tx) => {
		tx.delete(checklistOverrides).where(eq(checklistOverrides.childId, id)).run();
		tx.delete(checklistLogs).where(eq(checklistLogs.childId, id)).run();
		tx.delete(specialRewards).where(eq(specialRewards.childId, id)).run();
		tx.delete(childAchievements).where(eq(childAchievements.childId, id)).run();
		tx.delete(loginBonuses).where(eq(loginBonuses.childId, id)).run();
		tx.delete(characterImages).where(eq(characterImages.childId, id)).run();
		tx.delete(evaluations).where(eq(evaluations.childId, id)).run();
		tx.delete(statusHistory).where(eq(statusHistory.childId, id)).run();
		tx.delete(statuses).where(eq(statuses.childId, id)).run();
		tx.delete(pointLedger).where(eq(pointLedger.childId, id)).run();
		tx.delete(activityLogs).where(eq(activityLogs.childId, id)).run();
		tx.delete(children).where(eq(children.id, id)).run();
	});
}

// #783: archive / restore

export async function archiveChildren(ids: number[], reason: string, _tenantId: string) {
	if (ids.length === 0) return;
	for (const id of ids) {
		db.update(children)
			.set({ isArchived: 1, archivedReason: reason, updatedAt: new Date().toISOString() })
			.where(eq(children.id, id))
			.run();
	}
}

export async function restoreArchivedChildren(reason: string, _tenantId: string) {
	db.update(children)
		.set({ isArchived: 0, archivedReason: null, updatedAt: new Date().toISOString() })
		.where(eq(children.archivedReason, reason))
		.run();
}

export async function findArchivedChildren(_tenantId: string) {
	const rows = db.select().from(children).where(eq(children.isArchived, 1)).all();
	return rows.map(hydrateChildRow);
}
