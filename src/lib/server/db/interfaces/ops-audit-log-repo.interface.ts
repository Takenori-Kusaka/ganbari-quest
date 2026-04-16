// src/lib/server/db/interfaces/ops-audit-log-repo.interface.ts
// #820: /ops 運営操作の監査ログ

export interface OpsAuditLogRow {
	id: number;
	actorId: string;
	actorEmail: string;
	ip: string | null;
	ua: string | null;
	action: string;
	target: string | null;
	/** JSON 文字列。呼び出し側でパース */
	metadata: string | null;
	createdAt: string;
}

export interface InsertOpsAuditLogInput {
	actorId: string;
	actorEmail: string;
	ip?: string | null;
	ua?: string | null;
	action: string;
	target?: string | null;
	/** 任意の構造化メタ。repo 層で JSON 文字列化する */
	metadata?: Record<string, unknown> | null;
}

export interface IOpsAuditLogRepo {
	insert(input: InsertOpsAuditLogInput): Promise<void>;
	findRecent(limit: number): Promise<OpsAuditLogRow[]>;
	findByActor(actorId: string, limit: number): Promise<OpsAuditLogRow[]>;
}
