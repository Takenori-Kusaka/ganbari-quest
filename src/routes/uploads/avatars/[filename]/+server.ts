import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
// Dynamic file server for uploaded avatars
// adapter-node only serves build-time static files, so runtime uploads need a route
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const UPLOAD_DIR = join(
	process.cwd(),
	process.env.NODE_ENV === 'production' ? 'client' : 'static',
	'uploads',
	'avatars',
);

const MIME_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
};

export const GET: RequestHandler = ({ params }) => {
	const filename = params.filename;

	// Prevent path traversal
	if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	const filePath = join(UPLOAD_DIR, filename);

	if (!existsSync(filePath)) {
		throw error(404, 'File not found');
	}

	const ext = extname(filename).toLowerCase();
	const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
	const data = readFileSync(filePath);

	return new Response(data, {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	});
};
