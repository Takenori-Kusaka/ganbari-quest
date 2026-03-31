import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			out: 'build',
		}),
		alias: {
			$lib: 'src/lib',
		},
		csrf: {
			checkOrigin: true,
		},
	},
};

export default config;
