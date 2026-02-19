import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
		environment: 'jsdom',
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			include: ['src/lib/**/*.ts', 'src/lib/**/*.svelte'],
			exclude: ['src/lib/**/*.d.ts', 'src/lib/**/index.ts'],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 75,
				statements: 80,
			},
		},
	},
});
