/**
 * Custom ESLint rule: max-svelte-lines
 *
 * Flags route Svelte components that exceed the configured maximum total line count.
 * Default max is 500 lines.
 *
 * Overly large route components should have logic extracted to $lib/features/.
 */
export default {
	meta: {
		docs: {
			description:
				'enforce a maximum total line count for Svelte route components to encourage splitting',
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
				'Route component is {{count}} lines (recommended max {{max}}). Consider extracting logic to $lib/features/.',
		},
		type: 'suggestion',
	},
	create(context) {
		const options = context.options[0] || {};
		const max = options.max || 500;

		return {
			Program(node) {
				const sourceCode = context.sourceCode || context.getSourceCode();
				const totalLines = sourceCode.lines.length;
				if (totalLines > max) {
					context.report({
						loc: node.loc,
						messageId: 'tooManyLines',
						data: {
							count: String(totalLines),
							max: String(max),
						},
					});
				}
			},
		};
	},
};
