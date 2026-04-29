// src/lib/server/db/interfaces/graduation-consent-repo.interface.ts
// 卒業フロー: 事例公開承諾 + 利用期間記録 (#1603 / ADR-0023 §3.8 / §5 I10)
//
// 「卒業」を選んだ親が、残ポイント還元提案を確認した上で「事例として公開しても良い」
// 旨を任意で承諾するためのレコード。承諾無しでも「卒業セッション完了」を記録し、
// PO の「ポジティブな解約」KPI 集計に使う (consented=false でも 1 件カウント)。

export interface GraduationConsentRecord {
	id: number;
	tenantId: string;
	/** 公開時の表示名（実名禁止 — 親が任意指定） */
	nickname: string;
	/** 公開承諾フラグ。false でも卒業者数 KPI には含まれる */
	consented: boolean;
	/** 卒業時の残ポイント合計（参考値） */
	userPoints: number;
	/** テナント作成日 → 卒業日 までの日数 */
	usagePeriodDays: number;
	/** 任意の卒業メッセージ（公開可、最大 500 文字） */
	message: string | null;
	consentedAt: string;
}

export interface CreateGraduationConsentInput {
	tenantId: string;
	nickname: string;
	consented: boolean;
	userPoints: number;
	usagePeriodDays: number;
	message?: string | null;
}

export interface GraduationStats {
	/** 直近 N 日の卒業者数（consented true/false 問わず全件） */
	totalGraduations: number;
	/** うち事例公開承諾あり */
	consentedCount: number;
	/** 卒業者の平均利用日数 */
	avgUsagePeriodDays: number;
	/** 全解約数 (= cancellationReasons.total) */
	totalCancellations: number;
	/** 卒業率 (totalGraduations / totalCancellations) — 0..1 */
	graduationRate: number;
	/** 公開承諾された事例（最新順、最大 limit 件、message が空でないもの） */
	publicSamples: Array<{
		id: number;
		nickname: string;
		userPoints: number;
		usagePeriodDays: number;
		message: string;
		consentedAt: string;
	}>;
}

export interface IGraduationConsentRepo {
	create(input: CreateGraduationConsentInput): Promise<GraduationConsentRecord>;
	listByTenant(tenantId: string): Promise<GraduationConsentRecord[]>;
	/** 直近 N 日の卒業統計（デフォルト 90 日） */
	aggregateRecent(days?: number): Promise<{
		totalGraduations: number;
		consentedCount: number;
		avgUsagePeriodDays: number;
		publicSamples: GraduationStats['publicSamples'];
	}>;
	/** テナント完全削除時のクリーンアップ */
	deleteByTenantId(tenantId: string): Promise<void>;
}
