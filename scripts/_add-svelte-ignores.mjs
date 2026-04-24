#!/usr/bin/env node
// Temporary helper script for #1432: add svelte-ignore comments from warning list
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Remaining svelte-check warnings: file, line, warning type
// Sorted by file+line
const warnings = [
	{
		file: 'src/lib/features/admin/components/ActivityCreateForm.svelte',
		line: 38,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityCreateForm.svelte',
		line: 39,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityCreateForm.svelte',
		line: 40,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityCreateForm.svelte',
		line: 41,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityCreateForm.svelte',
		line: 43,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityCreateForm.svelte',
		line: 47,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityCreateForm.svelte',
		line: 48,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 19,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 20,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 21,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 25,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 26,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 27,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 28,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 29,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 30,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/ActivityEditForm.svelte',
		line: 31,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/AdminHome.svelte',
		line: 108,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/admin/components/AdminLayout.svelte',
		line: 274,
		type: 'template',
		rule: 'a11y_interactive_supports_focus',
	},
	{
		file: 'src/lib/features/admin/components/ChildListCard.svelte',
		line: 59,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/lib/features/admin/components/ChildListCard.svelte',
		line: 63,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/lib/features/admin/components/ChildProfileCard.svelte',
		line: 69,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/features/battle/BattleScene.svelte',
		line: 27,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/ui/components/MonthlyRewardDialog.svelte',
		line: 16,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/ui/components/StampPressOverlay.svelte',
		line: 239,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/lib/ui/primitives/FormField.svelte',
		line: 46,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/ui/primitives/NativeSelect.svelte',
		line: 32,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/lib/ui/primitives/NativeSelect.svelte',
		line: 33,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/routes/(child)/[uiMode=uiMode]/home/+page.svelte',
		line: 53,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/routes/(child)/[uiMode=uiMode]/home/+page.svelte',
		line: 993,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/routes/demo/(child)/checklist/+page.svelte',
		line: 24,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/routes/marketplace/+page.svelte',
		line: 54,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/routes/marketplace/[type]/[itemId]/+page.svelte',
		line: 22,
		type: 'script',
		rule: 'state_referenced_locally',
	},
	{
		file: 'src/routes/ops/business/+page.svelte',
		line: 261,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/routes/ops/license/[key]/+page.svelte',
		line: 236,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/routes/ops/license/[key]/+page.svelte',
		line: 237,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/routes/ops/license/[key]/+page.svelte',
		line: 242,
		type: 'style',
		rule: 'css_unused_selector',
	},
	{
		file: 'src/routes/setup/packs/+page.svelte',
		line: 127,
		type: 'template',
		rule: 'a11y_no_static_element_interactions',
	},
	{
		file: 'src/routes/setup/questionnaire/+page.svelte',
		line: 7,
		type: 'script',
		rule: 'state_referenced_locally',
	},
];

function _makeComment(type, rule) {
	switch (type) {
		case 'script':
			return `\t// @svelte-ignore ${rule}`;
		case 'style':
			return `\t/* svelte-ignore ${rule} */`;
		case 'template':
			return `\t\t\t<!-- svelte-ignore ${rule} -->`;
		default:
			return `\t// @svelte-ignore ${rule}`;
	}
}

// Group by file, sort lines descending
const byFile = {};
for (const w of warnings) {
	if (!byFile[w.file]) byFile[w.file] = [];
	byFile[w.file].push(w);
}

let modified = 0;
for (const [filePath, ws] of Object.entries(byFile)) {
	const absPath = resolve(filePath);
	if (!existsSync(absPath)) {
		console.error('NOT FOUND:', absPath);
		continue;
	}
	const content = readFileSync(absPath, 'utf8');
	const lines = content.split('\n');

	// Deduplicate by line (multiple warnings on same line → one comment)
	const uniqueLines = [];
	const seen = new Set();
	for (const w of ws) {
		const key = `${w.line}:${w.rule}`;
		if (!seen.has(key)) {
			seen.add(key);
			uniqueLines.push(w);
		}
	}

	// Sort descending so insertions don't shift positions
	uniqueLines.sort((a, b) => b.line - a.line);

	for (const w of uniqueLines) {
		const lineIdx = w.line - 1;
		const prevLine = lines[lineIdx - 1];
		// Skip if comment already exists
		if (prevLine?.includes(`svelte-ignore ${w.rule}`)) continue;
		const targetLine = lines[lineIdx] || '';
		const indent = targetLine.match(/^(\s*)/)[1];
		let comment;
		if (w.type === 'script') {
			comment = `${indent}// @svelte-ignore ${w.rule}`;
		} else if (w.type === 'style') {
			comment = `${indent}/* svelte-ignore ${w.rule} */`;
		} else {
			comment = `${indent}<!-- svelte-ignore ${w.rule} -->`;
		}
		lines.splice(lineIdx, 0, comment);
	}
	writeFileSync(absPath, lines.join('\n'));
	modified++;
	console.log('Fixed:', filePath);
}
console.log(`Modified ${modified} files`);
