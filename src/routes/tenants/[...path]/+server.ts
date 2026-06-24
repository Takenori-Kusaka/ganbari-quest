// Dynamic file server for tenant-scoped storage files
// Serves from local filesystem (NUC) or S3 (Lambda)

import { error } from '@sveltejs/kit';
import { safeContentDisposition, safeContentType } from '$lib/server/security/file-sanitizer';
import { readFile } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const path = params.path;

	// Prevent path traversal
	if (!path || path.includes('..')) {
		throw error(400, 'Invalid path');
	}

	// #3133: cross-tenant IDOR 防止。storage key は `tenants/<tenantId>/<type>/<childId>/<file>`
	// 構造（storage-keys.ts）であり、path の先頭セグメントが tenantId。認証コンテキストの
	// tenantId と一致しない場合は他テナントのファイルへのアクセスのため拒否する。
	// 存在有無を漏らさないよう 403 ではなく 404 を返す。
	const context = locals.context;
	const requestedTenantId = path.split('/')[0];
	if (!context || requestedTenantId !== context.tenantId) {
		throw error(404, 'File not found');
	}

	const storageKey = `tenants/${path}`;
	const result = await readFile(storageKey);
	if (!result) {
		throw error(404, 'File not found');
	}

	// #3105: ラスタ画像のみ inline、SVG / audio / 不明 type は attachment 配信
	// (script 入り SVG への top-level navigation で inline script が実行される stored XSS を封殺)。
	const ct = safeContentType(result.contentType);

	return new Response(new Uint8Array(result.data), {
		headers: {
			'Content-Type': ct,
			'Content-Disposition': safeContentDisposition(ct),
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
