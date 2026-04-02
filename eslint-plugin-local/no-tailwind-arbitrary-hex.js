/**
 * Custom ESLint rule: no-tailwind-arbitrary-hex
 *
 * Flags hardcoded hex colors in Tailwind arbitrary value syntax within class attributes.
 * e.g. bg-[#667eea], text-[#fff], border-[#ccc]
 *
 * Allowed: bg-[var(--color-brand-500)], text-[var(--theme-text)]
 */
export default {
	meta: {
		docs: {
			description:
				'disallow hardcoded hex colors in Tailwind arbitrary values; use CSS variables instead',
			category: 'Best Practices',
			recommended: false,
		},
		schema: [],
		messages: {
			hardcodedHex:
				'Hardcoded hex color in Tailwind arbitrary value. Use CSS variables: bg-[var(--color-*)] instead of bg-[#hex].',
		},
		type: 'suggestion',
	},
	create(context) {
		// Matches any Tailwind utility with an arbitrary hex value: word-[#hex...]
		const ARBITRARY_HEX_PATTERN = /\w-\[#[0-9a-fA-F]/;

		return {
			SvelteAttribute(node) {
				if (node.key.name !== 'class') {
					return;
				}

				// Extract string value from the attribute
				for (const valueNode of node.value) {
					if (valueNode.type === 'SvelteLiteral' && typeof valueNode.value === 'string') {
						if (ARBITRARY_HEX_PATTERN.test(valueNode.value)) {
							context.report({ loc: node.loc, messageId: 'hardcodedHex' });
						}
					}
				}
			},
		};
	},
};
