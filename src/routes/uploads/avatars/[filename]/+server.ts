// Dynamic file server for uploaded avatars
// Serves from local filesystem (NUC) or S3 (Lambda)

import { error } from '@sveltejs/kit';
import { safeContentDisposition, safeContentType } from '$lib/server/security/file-sanitizer';
import { getChildById } from '$lib/server/services/child-service';
import { readFile } from '$lib/server/storage';
import { storageKeyToPublicUrl } from '$lib/server/storage-keys';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const filename = params.filename;

	// Prevent path traversal
	if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	// #3133: cross-tenant IDOR 防止。本経路は legacy flat 配置のアバター
	// (`uploads/avatars/avatar-<childId>-<...>`、storage-keys.ts の旧形式) のみを配信する。
	//
	// 【id-collision 対策（QM BLOCK 対応）】childId は tenant-scoped に採番される
	// (`nextId(child, tenantId)`) ため、どのテナントにも child id=1,2,... が存在し得る。
	// 一方 legacy flat key (`uploads/avatars/avatar-<childId>-<suffix>`) は tenant 非依存の
	// flat 配置のため、`getChildById(<filename の childId>, tenantId)` が成功しても
	// 「自テナントに同 id の子供が居る」ことしか証明できず、その filename が
	// 本当にその子供のアバターである保証にならない。攻撃者は自テナントの child id=1 を
	// 用いて被害者テナントの `avatar-1-<victimSuffix>.png` を取得できてしまう。
	//
	// そこで file ownership を anchor で検証する: 解決した child の `avatarUrl`
	// (= `storageKeyToPublicUrl('uploads/avatars/avatar-<id>-<suffix>')`、先頭 `/` 付与)
	// が、要求された filename を指している場合のみ配信する。avatarUrl が null /
	// 別ファイルを指す（= この legacy file の所有者ではない）場合は fail-closed で 404。
	// 存在有無を漏らさないよう全て 404 を返す。
	const context = locals.context;
	const childIdMatch = filename.match(/^avatar-(\d+)-/);
	if (!context || !childIdMatch) {
		throw error(404, 'File not found');
	}
	const child = await getChildById(Number(childIdMatch[1]), context.tenantId);
	// file ownership anchor: avatarUrl がこの legacy filename を指していなければ拒否する
	const expectedPublicUrl = storageKeyToPublicUrl(`uploads/avatars/${filename}`);
	if (!child || child.avatarUrl !== expectedPublicUrl) {
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
