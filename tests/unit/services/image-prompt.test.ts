// tests/unit/services/image-prompt.test.ts
// image-prompt サービスのユニットテスト — 純粋関数のプロンプト生成

import { describe, expect, it } from 'vitest';

import { buildAvatarPrompt, buildFaviconPrompt } from '$lib/server/services/image-prompt';

describe('image-prompt', () => {
	describe('buildAvatarPrompt', () => {
		const baseParams = {
			nickname: 'テスト太郎',
			age: 8,
			theme: 'blue',
			characterType: 'beginner',
			level: 3,
		};

		it('出力にニックネーム・年齢・レベル・キャラクタータイプが含まれる', () => {
			const result = buildAvatarPrompt(baseParams);

			expect(result).toContain('テスト太郎');
			expect(result).toContain('8');
			expect(result).toContain('3');
			expect(result).toContain('beginner');
		});

		it('characterType "beginner" のヒントテキストが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, characterType: 'beginner' });

			expect(result).toContain('cheerful child just starting their journey');
		});

		it('characterType "growing" のヒントテキストが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, characterType: 'growing' });

			expect(result).toContain('adventurous child making progress');
			expect(result).not.toContain('cheerful child just starting their journey');
		});

		it('characterType "skilled" のヒントテキストが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, characterType: 'skilled' });

			expect(result).toContain('confident young adventurer');
		});

		it('characterType "expert" のヒントテキストが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, characterType: 'expert' });

			expect(result).toContain('skilled hero with an impressive outfit');
		});

		it('characterType "master" のヒントテキストが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, characterType: 'master' });

			expect(result).toContain('legendary hero in magnificent armor');
		});

		it('未知の characterType は "beginner" にフォールバックする', () => {
			const result = buildAvatarPrompt({ ...baseParams, characterType: 'unknown_type' });

			expect(result).toContain('cheerful child just starting their journey');
		});

		it('theme "blue" の色パレットが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, theme: 'blue' });

			expect(result).toContain('sky blue, navy, and silver tones');
		});

		it('theme "pink" の色パレットが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, theme: 'pink' });

			expect(result).toContain('soft pink, rose, and white tones');
		});

		it('theme "green" の色パレットが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, theme: 'green' });

			expect(result).toContain('emerald green, lime, and gold tones');
		});

		it('theme "purple" の色パレットが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, theme: 'purple' });

			expect(result).toContain('lavender, violet, and silver tones');
		});

		it('theme "orange" の色パレットが含まれる', () => {
			const result = buildAvatarPrompt({ ...baseParams, theme: 'orange' });

			expect(result).toContain('warm orange, amber, and cream tones');
		});

		it('未知の theme は "pink" にフォールバックする', () => {
			const result = buildAvatarPrompt({ ...baseParams, theme: 'unknown_theme' });

			expect(result).toContain('soft pink, rose, and white tones');
		});

		it('アートスタイル要件（CRITICAL）が含まれる', () => {
			const result = buildAvatarPrompt(baseParams);

			expect(result).toContain('Art style requirements (CRITICAL)');
			expect(result).toContain('chibi');
			expect(result).toContain('Child-safe content only');
			expect(result).toContain('512x512');
		});

		it('異なる characterType 同士で異なるプロンプトが生成される', () => {
			const beginnerPrompt = buildAvatarPrompt({ ...baseParams, characterType: 'beginner' });
			const masterPrompt = buildAvatarPrompt({ ...baseParams, characterType: 'master' });

			expect(beginnerPrompt).not.toBe(masterPrompt);
		});

		it('異なる theme 同士で異なるプロンプトが生成される', () => {
			const bluePrompt = buildAvatarPrompt({ ...baseParams, theme: 'blue' });
			const orangePrompt = buildAvatarPrompt({ ...baseParams, theme: 'orange' });

			expect(bluePrompt).not.toBe(orangePrompt);
		});
	});

	describe('buildFaviconPrompt', () => {
		it('空でない文字列を返す', () => {
			const result = buildFaviconPrompt();

			expect(result).toBeTypeOf('string');
			expect(result.length).toBeGreaterThan(0);
		});

		it('アプリ名のキーワードが含まれる', () => {
			const result = buildFaviconPrompt();

			expect(result).toContain('がんばりクエスト');
			expect(result).toContain('Ganbari Quest');
		});

		it('favicon用の技術要件が含まれる', () => {
			const result = buildFaviconPrompt();

			expect(result).toContain('256x256');
			expect(result).toContain('favicon');
		});

		it('子供向けデザイン要件が含まれる', () => {
			const result = buildFaviconPrompt();

			expect(result).toContain('Child-friendly');
		});
	});
});
