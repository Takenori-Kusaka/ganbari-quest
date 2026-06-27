// Dynamic file server for uploaded avatars
// Serves from local filesystem (NUC) or S3 (Lambda)

import { error } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { safeContentDisposition, safeContentType } from '$lib/server/security/file-sanitizer';
import { getChildById } from '$lib/server/services/child-service';
import { readFile } from '$lib/server/storage';
import { storageKeyToPublicUrl } from '$lib/server/storage-keys';
import type { RequestHandler } from './$types';

// #3139: deny path は全て 404 で存在秘匿する (cross-tenant / unauth / avatarUrl=null / mismatch /
// 実体 missing を区別しない)。レスポンスは 404 のまま、deny 理由のみ内部ログに記録し、攻撃 404 と
// 正常 404 (default-icon fallback 等) の監視切り分けを可能にする (response には理由を漏らさない)。
function denyAvatar(
	reason: string,
	meta: { tenantId?: string; context?: Record<string, unknown> },
	// #3230: pre-auth / 自明に到達可能な deny (no-context / malformed-filename) は未認証連打で
	// log 行が無制限増加し CloudWatch ingestion 課金 / NUC ディスク膨張を招くため debug に下げる。
	// 攻撃シグナルとして意味のある post-auth deny (ownership-mismatch / no-child 等) は info で残す。
	level: 'info' | 'debug' = 'info',
): never {
	logger[level]('avatar serve deny', {
		tenantId: meta.tenantId,
		context: { reason, ...meta.context },
	});
	throw error(404, 'File not found');
}

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
	if (!context) {
		// #3230: 未認証で自明に到達 = noise。攻撃シグナルでないため debug に下げる。
		denyAvatar('no-context', { context: { filename } }, 'debug');
	}
	if (!childIdMatch) {
		// #3230: 認証済だが avatar pattern 外の任意 filename = 自明に到達可能 noise → debug。
		denyAvatar('malformed-filename', { tenantId: context.tenantId, context: { filename } }, 'debug');
	}
	const child = await getChildById(Number(childIdMatch[1]), context.tenantId);
	// file ownership anchor: avatarUrl がこの legacy filename を指していなければ拒否する
	const expectedPublicUrl = storageKeyToPublicUrl(`uploads/avatars/${filename}`);
	if (!child) {
		denyAvatar('no-child', { tenantId: context.tenantId, context: { childId: childIdMatch[1] } });
	}
	if (child.avatarUrl !== expectedPublicUrl) {
		// 所有権 anchor 不一致 (別ファイル参照 / avatarUrl=null)。cross-tenant 取得試行の主要シグナル。
		denyAvatar('ownership-mismatch', {
			tenantId: context.tenantId,
			context: { childId: childIdMatch[1], hasAvatarUrl: child.avatarUrl !== null },
		});
	}

	const result = await readFile(`uploads/avatars/${filename}`);
	if (!result) {
		denyAvatar('file-missing', {
			tenantId: context.tenantId,
			context: { childId: childIdMatch[1] },
		});
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
