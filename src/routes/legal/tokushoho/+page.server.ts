import { redirect } from '@sveltejs/kit';

export function load() {
	redirect(301, 'https://www.ganbari-quest.com/tokushoho.html');
}
