/**
 * Custom ESLint rule: no-hardcoded-jp-text
 *
 * Flags hardcoded Japanese text (hiragana, katakana, kanji) directly in Svelte templates.
 * Forces usage of constants from $lib/domain/labels.ts instead.
 *
 * Applied as 'error' to src/routes/**\/*.svelte and src/lib/**\/*.svelte via eslint.config.js,
 * so `npm run lint:svelte` (a hard-fail step of the CI `lint-and-test` job) rejects new violations.
 * Scope is the Svelte *template* only: SvelteText nodes and the JP_ATTRS attributes.
 * `<script>` blocks and plain .ts files are NOT covered — those stay a review concern.
 * NOTE: check-hardcoded-strings.mjs (the count ratchet) was deleted in #4322; the rule itself
 * is what enforces the ban now, per violation rather than per count.
 */

const JP_REGEX = /[ぁ-ヿ一-鿿　-〿！-ﾟ]/;
const JP_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'alt', 'label']);

export default {
	meta: {
		docs: {
			description:
				'disallow hardcoded Japanese text in Svelte templates; use constants from $lib/domain/labels.ts',
			category: 'Best Practices',
			recommended: false,
		},
		schema: [],
		messages: {
			hardcodedJpText:
				'Hardcoded Japanese text. Use a constant from $lib/domain/labels.ts instead.',
			hardcodedJpAttr:
				'Hardcoded Japanese text in "{{attr}}" attribute. Use a constant from $lib/domain/labels.ts instead.',
		},
		type: 'suggestion',
	},
	create(context) {
		return {
			SvelteText(node) {
				const text = node.value;
				if (text.trim() && JP_REGEX.test(text)) {
					context.report({ loc: node.loc, messageId: 'hardcodedJpText' });
				}
			},
			SvelteElement(node) {
				if (node.kind !== 'html') return;
				for (const attribute of node.startTag.attributes) {
					if (attribute.type !== 'SvelteAttribute') continue;
					const attrName = attribute.key.name;
					if (!JP_ATTRS.has(attrName)) continue;
					for (const valueNode of attribute.value) {
						if (valueNode.type === 'SvelteLiteral' && JP_REGEX.test(valueNode.value)) {
							context.report({
								loc: valueNode.loc,
								messageId: 'hardcodedJpAttr',
								data: { attr: attrName },
							});
						}
					}
				}
			},
		};
	},
};
