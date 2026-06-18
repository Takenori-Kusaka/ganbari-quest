// Dynamic file server for uploaded avatars
// Serves from local filesystem (NUC) or S3 (Lambda)

import { error } from '@sveltejs/kit';
import { safeContentDisposition, safeContentType } from '$lib/server/security/file-sanitizer';
import { getChildById } from '$lib/server/services/child-service';
import { readFile } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const filename = params.filename;

	// Prevent path traversal
	if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	// #3133: cross-tenant IDOR 防止。本経路は legacy flat 配置のアバター
	// (`uploads/avatars/avatar-<childId>-<...>`、storage-keys.ts の旧形式) のみを配信する。
	// filename に埋め込まれた childId が認証コンテキストの tenant に属する子供かを検証し、
	// 他テナントの子供のアバターを GET できないようにする。存在有無を漏らさないよう 404 を返す。
	const context = locals.context;
	const childIdMatch = filename.match(/^avatar-(\d+)-/);
	if (!context || !childIdMatch) {
		throw error(404, 'File not found');
	}
	const child = await getChildById(Number(childIdMatch[1]), context.tenantId);
	if (!child) {
		throw error(404, 'File not found');
	}

	const result = await readFile(`uploads/avatars/${filename}`);
	if (!result) {
		throw error(404, 'File not found');
	}

	// #3105: avatar も tenants 配信路と対称に、ラスタ画像のみ inline / SVG 等は attachment
	// (upload 路は sharp 再エンコードで非 SVG だが、防御の対称化として共通 helper を経由)。
	const ct = safeContentType(result.contentType);

	return new Response(new Uint8Array(result.data), {
		headers: {
			'Content-Type': ct,
			'Content-Disposition': safeContentDisposition(ct),
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
