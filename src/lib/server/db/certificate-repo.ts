// src/lib/server/db/certificate-repo.ts — Facade (delegates to factory)
//
// 旧実装は `db` を直 import して sqlite を強制参照していた (#2262 root cause)。
// factory 化により sqlite / demo / dynamodb 3 実装を DATA_SOURCE で切替える。

import { getRepos } from './factory';
import type { InsertCertificateInput } from './types';

export async function issueCertificate(input: InsertCertificateInput, tenantId: string) {
	return getRepos().certificate.issueCertificate(input, tenantId);
}

export async function findCertificates(childId: number, tenantId: string) {
	return getRepos().certificate.findCertificates(childId, tenantId);
}

export async function findCertificateById(id: number, tenantId: string) {
	return getRepos().certificate.findCertificateById(id, tenantId);
}

export async function hasCertificate(childId: number, certificateType: string, tenantId: string) {
	return getRepos().certificate.hasCertificate(childId, certificateType, tenantId);
}
