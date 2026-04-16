// src/lib/server/db/interfaces/license-event-repo.interface.ts
// #804: ライセンスキーライフサイクル監査ログ

export type LicenseEventType =
	| 'issued'
	| 'validated'
	| 'validation_failed'
	| 'consumed'
	| 'consume_failed'
	| 'revoked';

export interface LicenseEventRow {
	id: number;
	eventType: LicenseEventType;
	licenseKey: string;
	tenantId: string | null;
	actorId: string | null;
	ip: string | null;
	ua: string | null;
	/** JSON 文字列。呼び出し側でパース */
	metadata: string | null;
	createdAt: string;
}

export interface InsertLicenseEventInput {
	eventType: LicenseEventType;
	/** 完全なキー or 未知キーの先頭 7 文字 + '...' */
	licenseKey: string;
	tenantId?: string | null;
	actorId?: string | null;
	ip?: string | null;
	ua?: string | null;
	/** 任意の構造化メタ。repo 層で JSON 文字列化する */
	metadata?: Record<string, unknown> | null;
}

export interface ILicenseEventRepo {
	insert(input: InsertLicenseEventInput): Promise<void>;
	/** 特定キーのイベント履歴を時系列降順で取得 (ops ダッシュボード用) */
	findByLicenseKey(licenseKey: string, limit: number): Promise<LicenseEventRow[]>;
	/** 直近 N 件 (ops 一覧用) */
	findRecent(limit: number): Promise<LicenseEventRow[]>;
	/**
	 * 指定時間窓内の validation_failed の件数を ip ごとに集計する（ブルートフォース検知）。
	 * 返却: `[{ ip, count }]` (ip が null のものは集計対象外)
	 */
	countRecentFailuresByIp(
		windowMinutes: number,
		limit: number,
	): Promise<Array<{ ip: string; count: number }>>;
}
