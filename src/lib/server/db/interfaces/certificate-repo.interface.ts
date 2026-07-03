// src/lib/server/db/interfaces/certificate-repo.interface.ts
// ICertificateRepo — Certificate (がんばり証明書) repository contract.
//
// ADR-0048: Multi-Lambda Demo Deployment (`DATA_SOURCE=demo`) では sqlite テーブルが
// 存在しないため、本 interface 経由で stateless demo Fake に切替える。
// Issue #2262: factory 化漏れにより demo Lambda で `findCertificates` 等を呼ぶと
// `no such table: certificates` で 500 fail していた構造的欠陥を解消するための I/F。

import type { Certificate, InsertCertificateInput } from '../types';

export interface ICertificateRepo {
	issueCertificate(input: InsertCertificateInput, tenantId: string): Promise<Certificate | null>;
	findCertificates(childId: number, tenantId: string): Promise<Certificate[]>;
	findCertificateById(id: number, tenantId: string): Promise<Certificate | undefined>;
	hasCertificate(childId: number, certificateType: string, tenantId: string): Promise<boolean>;

	/**
	 * #3329 backup restore 用: issuedAt / metadata を保全して証明書を復元する。
	 * issueCertificate は issuedAt を schema default (now) で発番するため round-trip で授与日時が
	 * 失われる。本メソッドは export された issuedAt をそのまま書き戻す (id は新規採番、
	 * tenantId は復元先の値を使う、childId は呼び出し側が解決済)。
	 */
	insertForRestore(
		input: Omit<Certificate, 'id' | 'tenantId'>,
		tenantId: string,
	): Promise<Certificate | null>;

	/** #3329: テナントの全証明書を削除 (clear / テナント削除時。child_id は no-cascade のため明示削除が必要)。 */
	deleteByTenantId(tenantId: string): Promise<void>;
}
