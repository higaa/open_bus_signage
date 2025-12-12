/* 簡易ビルド: src/web を dist へコピーし、JSONも同梱。loaderのURLを相対に修正 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcWeb = path.join(root, 'src', 'web');
const dist = path.join(root, 'dist');
const outputJson = path.join(root, 'output', 'signage_data.json');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  console.log(`Copied: ${path.relative(root, dest)}`);
}

function copyDir(srcDir, destDir, filterFn = () => true) {
  ensureDir(destDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(srcDir, e.name);
    const destPath = path.join(destDir, e.name);
    if (!filterFn(e.name)) continue;
    if (e.isDirectory()) {
      copyDir(srcPath, destPath, filterFn);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

function rewriteLoaderUrl(distJsPath) {
  const loaderPath = path.join(distJsPath, 'signage-data-loader.js');
  let code = fs.readFileSync(loaderPath, 'utf-8');
  // SIGNAGE_DATA_URL を dist 同梱のファイル参照に置換
  code = code.replace(
    /const\s+SIGNAGE_DATA_URL\s*=\s*['"`].*?['"`]\s*;/,
    'const SIGNAGE_DATA_URL = \'./signage_data.json\';'
  );
  fs.writeFileSync(loaderPath, code, 'utf-8');
  console.log('Rewrote SIGNAGE_DATA_URL -> ./signage_data.json');
}

function main() {
  ensureDir(dist);

  // index.html, styles.css
  copyFile(path.join(srcWeb, 'index.html'), path.join(dist, 'index.html'));
  copyFile(path.join(srcWeb, 'styles.css'), path.join(dist, 'styles.css'));

  // js配下
  const distJs = path.join(dist, 'js');
  copyDir(path.join(srcWeb, 'js'), distJs);

  // JSONを同梱
  if (!fs.existsSync(outputJson)) {
    console.error('ERROR: output/signage_data.json が見つかりません。前処理を先に実行してください。');
    process.exit(1);
  }
  copyFile(outputJson, path.join(dist, 'signage_data.json'));

  // ローダのURL書き換え
  rewriteLoaderUrl(distJs);

  console.log('Build completed. Dist ready at ./dist');
}

main();