/**
 * Custom ESLint rule: no-raw-button
 *
 * Flags raw <button> HTML elements in route components.
 * Forces usage of <Button> from $lib/ui/primitives/Button.svelte instead.
 *
 * This rule is scoped to src/routes/ via eslint.config.js,
 * so $lib/ui/ primitives can still use raw <button> internally.
 */
export default {
	meta: {
		docs: {
			description:
				'disallow raw <button> elements; use <Button> from $lib/ui/primitives/Button.svelte',
			category: 'Best Practices',
			recommended: false,
		},
		schema: [],
		messages: {
			rawButton:
				'Use <Button> from $lib/ui/primitives/Button.svelte instead of raw <button>. See CLAUDE.md UI implementation rules.',
		},
		type: 'suggestion',
	},
	create(context) {
		return {
			SvelteElement(node) {
				if (node.kind === 'html' && node.name.name === 'button') {
					context.report({ loc: node.loc, messageId: 'rawButton' });
				}
			},
		};
	},
};
