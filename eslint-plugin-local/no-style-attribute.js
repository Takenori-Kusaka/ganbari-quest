/**
 * Custom ESLint rule: no-style-attribute
 *
 * Flags `style="..."` attributes in Svelte HTML elements,
 * but allows `style:prop={value}` directives (Svelte's idiomatic way for dynamic styles).
 *
 * This replaces svelte/no-inline-styles which flags both forms equally.
 */
export default {
	meta: {
		docs: {
			description: 'disallow style="..." attributes; allow style: directives for dynamic values',
			category: 'Best Practices',
			recommended: false,
		},
		schema: [],
		messages: {
			hasStyleAttribute:
				'Found disallowed style="..." attribute. Use Tailwind classes for static styles or style:prop={value} for dynamic values.',
		},
		type: 'suggestion',
	},
	create(context) {
		return {
			SvelteElement(node) {
				if (node.kind !== 'html') {
					return;
				}
				for (const attribute of node.startTag.attributes) {
					// Only flag style="..." attributes, NOT style: directives
					if (attribute.type === 'SvelteAttribute' && attribute.key.name === 'style') {
						context.report({ loc: attribute.loc, messageId: 'hasStyleAttribute' });
					}
				}
			},
		};
	},
};
