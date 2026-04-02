import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? '' });
};
