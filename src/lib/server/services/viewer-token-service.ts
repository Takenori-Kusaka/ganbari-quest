// src/lib/server/services/viewer-token-service.ts
// 閲覧専用リンク管理サービス (#371)

import { randomBytes } from 'node:crypto';
import { getRepos } from '$lib/server/db/factory';
import type { ViewerToken } from '$lib/server/db/types';

/** トークン文字列を生成（URL-safe, 32 bytes = 43 chars base64url） */
function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

/** 有効期限を計算 */
function computeExpiry(duration: '7d' | '30d' | 'unlimited'): string | null {
	if (duration === 'unlimited') return null;
	const days = duration === '7d' ? 7 : 30;
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString();
}

/** 閲覧トークンを発行 */
export async function createViewerToken(
	tenantId: string,
	options: { label?: string; duration: '7d' | '30d' | 'unlimited' },
): Promise<ViewerToken> {
	const repos = getRepos();
	return repos.viewerToken.insert(
		{
			token: generateToken(),
			label: options.label ?? null,
			expiresAt: computeExpiry(options.duration),
		},
		tenantId,
	);
}

/** テナントの全閲覧トークンを取得 */
export async function listViewerTokens(tenantId: string): Promise<ViewerToken[]> {
	const repos = getRepos();
	return repos.viewerToken.findByTenant(tenantId);
}

/** トークン文字列から有効なトークンを検証・取得 */
export async function resolveViewerToken(token: string): Promise<ViewerToken | null> {
	const repos = getRepos();
	const record = await repos.viewerToken.findByToken(token);
	if (!record) return null;
	if (record.revokedAt) return null;
	if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null;
	return record;
}

/** トークンを無効化 */
export async function revokeViewerToken(id: number, tenantId: string): Promise<void> {
	const repos = getRepos();
	await repos.viewerToken.revoke(id, tenantId);
}

/** トークンを削除 */
export async function deleteViewerToken(id: number, tenantId: string): Promise<void> {
	const repos = getRepos();
	await repos.viewerToken.deleteById(id, tenantId);
}
