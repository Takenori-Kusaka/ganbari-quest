// Dynamic file server for uploaded avatars
// Serves from local filesystem (NUC) or S3 (Lambda)
import { readFile } from '$lib/server/storage';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const filename = params.filename;

	// Prevent path traversal
	if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	const result = await readFile(`uploads/avatars/${filename}`);
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
