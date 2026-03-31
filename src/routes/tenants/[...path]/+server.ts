// Dynamic file server for tenant-scoped storage files
// Serves from local filesystem (NUC) or S3 (Lambda)
import { safeContentType } from '$lib/server/security/file-sanitizer';
import { readFile } from '$lib/server/storage';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const path = params.path;

	// Prevent path traversal
	if (!path || path.includes('..')) {
		throw error(400, 'Invalid path');
	}

	const storageKey = `tenants/${path}`;
	const result = await readFile(storageKey);
	if (!result) {
		throw error(404, 'File not found');
	}

	// 音声ファイルは attachment として配信（ブラウザでの直接実行を防止）
	const isAudio = result.contentType.startsWith('audio/');
	const disposition = isAudio ? 'attachment' : 'inline';

	return new Response(new Uint8Array(result.data), {
		headers: {
			'Content-Type': safeContentType(result.contentType),
			'Content-Disposition': disposition,
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
