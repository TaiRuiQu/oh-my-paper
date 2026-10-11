import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const pgBin = resolve(root, '.tools/postgresql/usr/lib/postgresql/18/bin');
const toolEnv = {
  ...process.env,
  LD_LIBRARY_PATH: [resolve(root, '.tools/postgresql/usr/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
};
let failures = 0;
async function check(name, action) {
  try {
    const detail = await action();
    console.log(`✓ ${name}${detail ? ': ' + detail : ''}`);
  } catch (error) {
    failures++;
    // Connection errors can contain credentials; print only their code.
    console.error(`✗ ${name}: ${error.code || '验证失败'}`);
  }
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: toolEnv, encoding: 'utf8', timeout: 15000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0);
  return (result.stdout + result.stderr).trim();
}
await check('Node.js / pnpm', () => {
  assert.equal(process.versions.node.split('.')[0], '24');
  const pnpm = run('pnpm', ['--version']);
  assert.equal(pnpm.split('.')[0], '11');
  return `${process.version} / ${pnpm}`;
});
await check('项目依赖', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const packages = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [name, expected] of Object.entries(packages)) {
    const installed = JSON.parse(readFileSync(resolve('node_modules', name, 'package.json'), 'utf8'));
    assert.equal(installed.version, expected, name);
  }
  return `${Object.keys(packages).length} 个直接依赖版本匹配`;
});
await check('Python / SymPy', () => run(resolve(root, process.env.PYTHON_PATH || '.venv/bin/python'), ['-c', 'import sympy; x=sympy.Symbol("x"); assert sympy.simplify((x+1)**2-x*x-2*x-1)==0; print("SymPy " + sympy.__version__)']));
await check('Poppler 渲染和文本工具', () => {
  const versions = [run(process.env.PDFTOPPM_PATH || 'pdftoppm', ['-v']), run(process.env.PDFTOTEXT_PATH || 'pdftotext', ['-v'])];
  return versions.map(text => text.split('\n')[0]).join(' / ');
});
await check('中文字体', () => {
  const fonts = run('fc-match', ['Noto Sans CJK SC:lang=zh']);
  assert.match(fonts, /Noto.*CJK/);
  return fonts;
});
await check('Sharp 图像处理', async () => {
  const { default: sharp } = await import('sharp');
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).width, 2);
  return 'PNG 创建和读取通过';
});
await check('AI SDK', async () => {
  const { ToolLoopAgent } = await import('ai');
  assert.equal(typeof ToolLoopAgent, 'function');
  return 'ToolLoopAgent 可用';
});
await check('PostgreSQL 工具', () => run(resolve(pgBin, 'psql'), ['--version']));
await check('PostgreSQL 连接', async () => {
  assert.ok(process.env.DATABASE_URL);
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    const result = await client.query('SELECT current_database() AS db, current_setting(\'server_version\') AS version');
    return `${result.rows[0].db} / ${result.rows[0].version}`;
  } finally {
    await client.end();
  }
});
process.exitCode = failures ? 1 : 0;
