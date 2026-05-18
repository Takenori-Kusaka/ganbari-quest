import fs from 'fs';
import path from 'path';

function getFiles(dir, ext, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getFiles(filePath, ext, fileList);
    } else if (filePath.endsWith(ext)) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const mdFiles = getFiles('docs', '.md');
mdFiles.push('DESIGN.md');
mdFiles.push('CLAUDE.md');

const codebasePrefixes = ['src/', 'site/', 'tests/', 'scripts/', 'infra/', '.github/'];
let totalErrors = 0;
const deprecatedCandidates = new Set();

console.log('ドキュメント内のコード参照（実装との突合）をチェックしています...\n');

for (const file of mdFiles) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf-8');
  
  // 陳腐化フラグがあるドキュメントはチェックをスキップする
  if (content.includes('status: deprecated') || content.includes('> **Warning**: このドキュメントは現在の実装と乖離しており陳腐化（Deprecated）しています。')) {
    continue;
  }
  
  // マッチさせたいパスの形式 (空白, バッククォート, 括弧などで囲まれている想定)
  const words = content.split(/[\s`"'\(\)\[\]\n\r<>]+/);
  
  const checked = new Set();
  let fileErrors = 0;

  for (let word of words) {
    if (codebasePrefixes.some(prefix => word.startsWith(prefix))) {
      // '#' 以降（行番号やアンカー）を削除
      let cleanPath = word.split('#')[0];
      // '::' や ':' によるメソッド参照・行番号指定を削除
      cleanPath = cleanPath.split('::')[0];
      cleanPath = cleanPath.replace(/:\d+(-\d+)?$/, '');
      // 末尾の句読点を削除
      cleanPath = cleanPath.replace(/[.,:;!?]+$/, '');
      
      // ワイルドカードや変数展開を含むものは除外
      if (cleanPath.includes('*') || cleanPath.includes('{') || cleanPath.includes('$')) {
        continue;
      }

      if (checked.has(cleanPath)) continue;
      checked.add(cleanPath);

      // 末尾の / を取り除いてチェック
      const checkPath = cleanPath.endsWith('/') ? cleanPath.slice(0, -1) : cleanPath;

      if (!fs.existsSync(checkPath)) {
        console.error(`\x1b[31m[Broken Code Ref]\x1b[0m ${file}`);
        console.error(`  -> 存在しないパス: ${cleanPath}`);
        fileErrors++;
        totalErrors++;
        deprecatedCandidates.add(file);
      }
    }
  }
}

console.log('\n--- 監査結果 ---');
if (totalErrors > 0) {
  console.error(`計 ${totalErrors} 件のデッドリンク（存在しない実装への参照）が見つかりました。`);
  console.log(`\n以下のドキュメントは陳腐化している可能性が高いです（Deprecated候補）:`);
  deprecatedCandidates.forEach(f => {
    console.log(`- ${f}`);
    if (process.argv.includes('--fix')) {
      const fc = fs.readFileSync(f, 'utf-8');
      const warning = '> **Warning**: このドキュメントは現在の実装と乖離しており陳腐化（Deprecated）しています。\n\n';
      // Insert after the first H1 if present, otherwise at top
      if (fc.startsWith('# ')) {
        const parts = fc.split('\n');
        parts.splice(1, 0, '\n' + warning);
        fs.writeFileSync(f, parts.join('\n'));
      } else {
        fs.writeFileSync(f, warning + fc);
      }
      console.log(`  -> ${f} に Deprecated 警告を追加しました。`);
    }
  });
  if (process.argv.includes('--fix')) {
    console.log('\n--fix オプションにより警告を自動挿入しました。再度スクリプトを実行して確認してください。');
    process.exit(0);
  }
  process.exit(1);
} else {
  console.log('\x1b[32m✔ すべてのコード参照は実装（現在のファイルパス）と一致しています。\x1b[0m');
}
