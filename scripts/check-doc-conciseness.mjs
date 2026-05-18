import fs from 'fs';
import path from 'path';

// 簡潔性（Conciseness）を強制するための制限
const MAX_PARAGRAPH_LENGTH = 200; // 1段落あたりの最大文字数
const MAX_SENTENCES_PER_PARAGRAPH = 3; // 1段落あたりの最大文の数（「。」の数）

function getFiles(dir, ext, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      // アーカイブや外部向けZennは対象外
      if (filePath.includes('archive') || filePath.includes('zenn')) continue;
      getFiles(filePath, ext, fileList);
    } else if (filePath.endsWith(ext)) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const mdFiles = getFiles('docs', '.md');
let totalErrors = 0;

console.log('ドキュメントの簡潔性ルール（長文禁止）をチェックしています...');

for (const file of mdFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  
  // コードブロックとHTMLコメントを除外して誤検知を防ぐ
  const noCodeContent = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  
  // 空行で区切って段落を取得
  const paragraphs = noCodeContent.split(/\n\n+/);
  
  paragraphs.forEach((p, index) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    
    // Markdownの構造化要素（リスト、見出し、引用、テーブル、HTML）の場合はスキップ
    if (
      trimmed.startsWith('-') || 
      trimmed.startsWith('*') || 
      trimmed.startsWith('#') || 
      trimmed.startsWith('>') || 
      trimmed.startsWith('<') || 
      trimmed.startsWith('|') ||
      trimmed.match(/^\d+\./) // 順序付きリスト
    ) {
      return;
    }

    const textLength = trimmed.replace(/\s+/g, '').length;
    const sentences = (trimmed.match(/。/g) || []).length;

    let errors = [];
    if (textLength > MAX_PARAGRAPH_LENGTH) {
      errors.push(`長さが${textLength}文字あります（上限${MAX_PARAGRAPH_LENGTH}文字）`);
    }
    if (sentences > MAX_SENTENCES_PER_PARAGRAPH) {
      errors.push(`1段落に${sentences}文含まれています（上限${MAX_SENTENCES_PER_PARAGRAPH}文）`);
    }

    if (errors.length > 0) {
      console.error(`\x1b[31m[Conciseness Error]\x1b[0m ${file}`);
      console.error(`  長文が検出されました。情報量を落とさず、箇条書き（- ）や表（|---|）に変換して要約してください。`);
      errors.forEach(e => console.error(`  - ${e}`));
      console.error(`  [抜粋]: ${trimmed.substring(0, 80).replace(/\n/g, ' ')}...\n`);
      totalErrors++;
    }
  });
}

if (totalErrors > 0) {
  console.error(`Total violations: ${totalErrors}`);
  console.error(`\x1b[31m❌ ドキュメントが冗長です。文章（ですます調・である調）での説明を減らし、構造化してください。\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[32m✔ All documentation paragraphs are concise.\x1b[0m`);
}
