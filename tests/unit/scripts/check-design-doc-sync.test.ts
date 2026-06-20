// tests/unit/scripts/check-design-doc-sync.test.ts
// #3152: check-design-doc-sync の exempt 判定の回帰テスト。
// 「src/routes/CLAUDE.md (route-trigger かつ exempt) + tests/ (検証、設計書同期不要)」の PR が
// 誤って fail していた問題 (tests/ が FILE_EXEMPT_MATCHERS に無かった) を pin する。

import { describe, expect, it } from 'vitest';
import {
	checkDesignDocSync,
	hasRouteChanges,
	isAllFilesExempt,
} from '../../../scripts/check-design-doc-sync.mjs';

describe('#3152 check-design-doc-sync exempt 判定', () => {
	it('tests/ 配下は exempt (検証であって設計書同期不要)', () => {
		expect(isAllFilesExempt(['tests/unit/architecture/route-db-boundary.test.ts'])).toBe(true);
	});

	it('src/routes/CLAUDE.md + tests/ のみの PR は skip する (誤 fail 回帰)', () => {
		const files = [
			'src/routes/CLAUDE.md',
			'tests/unit/architecture/route-db-boundary.test.ts',
			'CLAUDE.md',
		];
		// src/routes/CLAUDE.md は route 変更として検出されるが、全ファイルが exempt のため skip。
		expect(hasRouteChanges(files)).toBe(true);
		expect(isAllFilesExempt(files)).toBe(true);
		const result = checkDesignDocSync({ files, labels: [] });
		expect(result.status).toBe('skip');
	});

	it('実 route component (.svelte) 変更 + 設計書同期なし は依然 fail (gate を弱めない)', () => {
		const files = ['src/routes/(parent)/admin/foo/+page.svelte', 'tests/e2e/foo.spec.ts'];
		expect(isAllFilesExempt(files)).toBe(false);
		const result = checkDesignDocSync({ files, labels: [] });
		expect(result.status).toBe('fail');
	});

	it('route 変更 + docs/design 同期あり は pass', () => {
		const files = ['src/routes/(parent)/admin/foo/+page.svelte', 'docs/design/06-UI設計書.md'];
		const result = checkDesignDocSync({ files, labels: [] });
		expect(result.status).not.toBe('fail');
	});
});
