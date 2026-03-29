// Dynamic file server for tenant-scoped storage files
// Serves from local filesystem (NUC) or S3 (Lambda)
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

	return new Response(new Uint8Array(result.data), {
		headers: {
			'Content-Type': result.contentType,
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
