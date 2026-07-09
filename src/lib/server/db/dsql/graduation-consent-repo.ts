// src/lib/server/db/dsql/graduation-consent-repo.ts
// EPIC #3424 / PR-R10 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9 / #3557
//
// IGraduationConsentRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。全メソッド単一文のため runner 不要。
//   - **family scope (child 主軸でない)**: 1 家族が複数子×複数回卒業し得るため graduation_consent は
//     UUID surrogate PK (family_id, consent_id) の多数行モデル (§11.2)。
//   - **§P9 の適用は per-method**: create / listByTenant / deleteByTenantId は family_id 述語で
//     tenant 限定する。⚠️ **aggregateRecent / publicSamples は意図的に cross-tenant** (全家族横断の
//     ポジティブ解約 KPI + 公開事例集計、§11.2 #3557 secondary(consented, consented_at) が
//     cross-tenant 用)。sqlite backend も同様に tenant 述語を持たない (parity)。この 2 経路のみ
//     §P9 述語を持たないことは設計上の正であり、逸脱ではない。
//   - **boolean 契約**: GraduationConsentRecord.consented は boolean (voice の isActive=number と異なる)。
//     DSQL 列も boolean のため変換不要 (PGlite/pg は JS boolean を返す)。
//   - **ordering**: sqlite は id (autoincrement) DESC = 挿入順。DSQL は UUID consent_id が乱数のため
//     id 順に意味がなく、consented_at DESC + consent_id で決定的な「最新順」を作る。

import { sql } from 'drizzle-orm';
import type {
	CreateGraduationConsentInput,
	GraduationConsentRecord,
	GraduationStats,
	IGraduationConsentRepo,
} from '../interfaces/graduation-consent-repo.interface';
import type { SqlExecutor } from './sql-executor';

const DEFAULT_AGGREGATION_DAYS = 90;
const DEFAULT_PUBLIC_SAMPLE_LIMIT = 20;

interface ConsentRow {
	consent_id: string;
	family_id: string;
	nickname: string;
	consented: boolean;
	user_points: number;
	usage_period_days: number;
	message: string | null;
	consented_at: string;
}

const CONSENT_COLUMNS = sql.raw(
	`consent_id, family_id, nickname, consented, user_points, usage_period_days, message,
	 consented_at`,
);

/** row → GraduationConsentRecord (consented は boolean 契約、変換不要)。 */
function toRecord(row: ConsentRow): GraduationConsentRecord {
	return {
		id: row.consent_id,
		tenantId: row.family_id,
		nickname: row.nickname,
		consented: row.consented === true,
		userPoints: row.user_points,
		usagePeriodDays: row.usage_period_days,
		message: row.message ?? null,
		consentedAt: row.consented_at,
	};
}

/** DSQL 用 IGraduationConsentRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlGraduationConsentRepo(db: SqlExecutor): IGraduationConsentRepo {
	return {
		async create(input: CreateGraduationConsentInput): Promise<GraduationConsentRecord> {
			const result = await db.execute(sql`
				INSERT INTO graduation_consent
					(family_id, nickname, consented, user_points, usage_period_days, message)
				VALUES (${input.tenantId}, ${input.nickname}, ${input.consented}, ${input.userPoints},
					${input.usagePeriodDays}, ${input.message ?? null})
				RETURNING ${CONSENT_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ConsentRow | undefined;
			if (!row) throw new Error('Failed to create graduation consent');
			return toRecord(row);
		},

		async listByTenant(tenantId: string): Promise<GraduationConsentRecord[]> {
			// §P9: family 限定。最新順 (id が乱数のため consented_at DESC で並べる)。
			const result = await db.execute(sql`
				SELECT ${CONSENT_COLUMNS} FROM graduation_consent
				WHERE family_id = ${tenantId}
				ORDER BY consented_at DESC, consent_id
			`);
			return (result.rows as unknown as ConsentRow[]).map(toRecord);
		},

		async aggregateRecent(days: number = DEFAULT_AGGREGATION_DAYS): Promise<{
			totalGraduations: number;
			consentedCount: number;
			avgUsagePeriodDays: number;
			publicSamples: GraduationStats['publicSamples'];
		}> {
			// ⚠️ cross-tenant (KPI): family 述語なしが正 (§11.2 #3557、sqlite parity)。
			const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
			const windowRows = await db.execute(sql`
				SELECT consented, usage_period_days FROM graduation_consent
				WHERE consented_at >= ${since}::timestamptz
			`);
			const rows = windowRows.rows as unknown as Array<{
				consented: boolean;
				usage_period_days: number;
			}>;
			const totalGraduations = rows.length;
			const consentedCount = rows.filter((r) => r.consented === true).length;
			const sumUsage = rows.reduce((s, r) => s + r.usage_period_days, 0);
			const avgUsagePeriodDays =
				totalGraduations > 0 ? Math.round((sumUsage / totalGraduations) * 10) / 10 : 0;

			// 公開承諾 + message 非空 (最新順、最大 limit)。sqlite parity: window でなく全期間から拾う。
			const sampleResult = await db.execute(sql`
				SELECT consent_id, nickname, user_points, usage_period_days, message, consented_at
				FROM graduation_consent
				WHERE consented = true AND message IS NOT NULL AND message <> ''
				ORDER BY consented_at DESC, consent_id
				LIMIT ${DEFAULT_PUBLIC_SAMPLE_LIMIT}
			`);
			const publicSamples = (
				sampleResult.rows as unknown as Array<{
					consent_id: string;
					nickname: string;
					user_points: number;
					usage_period_days: number;
					message: string;
					consented_at: string;
				}>
			).map((r) => ({
				id: r.consent_id,
				nickname: r.nickname,
				userPoints: r.user_points,
				usagePeriodDays: r.usage_period_days,
				message: r.message ?? '',
				consentedAt: r.consented_at,
			}));

			return { totalGraduations, consentedCount, avgUsagePeriodDays, publicSamples };
		},

		async deleteByTenantId(tenantId: string): Promise<void> {
			await db.execute(sql`DELETE FROM graduation_consent WHERE family_id = ${tenantId}`);
		},
	};
}
