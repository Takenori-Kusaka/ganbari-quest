/**
 * Custom ESLint rule: max-style-lines
 *
 * Flags <style> blocks that exceed the configured maximum line count.
 * Default max is 50 lines (per CLAUDE.md: "src/routes/ 配下の <style> ブロックは原則50行以下").
 *
 * Overly long style blocks indicate the component should be split
 * or styles should be converted to Tailwind utility classes.
 */
export default {
	meta: {
		docs: {
			description: 'enforce a maximum line count for <style> blocks in Svelte route components',
			category: 'Best Practices',
			recommended: false,
		},
		schema: [
			{
				type: 'object',
				properties: {
					max: {
						type: 'integer',
						minimum: 1,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			tooManyLines:
				'Style block is {{count}} lines (max {{max}}). Convert CSS to Tailwind classes or extract to a component.',
		},
		type: 'suggestion',
	},
	create(context) {
		const options = context.options[0] || {};
		const max = options.max || 50;

		return {
			SvelteStyleElement(node) {
				const lineCount = node.loc.end.line - node.loc.start.line;
				if (lineCount > max) {
					context.report({
						loc: node.loc,
						messageId: 'tooManyLines',
						data: {
							count: String(lineCount),
							max: String(max),
						},
					});
				}
			},
		};
	},
};
