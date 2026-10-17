import { readFile } from 'node:fs/promises';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) {
  throw new Error(`Expected one inline script in index.html, found ${scripts.length}`);
}

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.js'],
      languageOptions: { globals: globals.browser },
      rules: js.configs.recommended.rules,
    },
    {
      files: ['scripts/*.mjs'],
      languageOptions: { globals: globals.node },
      rules: js.configs.recommended.rules,
    },
  ],
});

const inline = scripts[0];
const offset = html.slice(0, inline.index).split('\n').length - 1;
const results = [
  ...(await eslint.lintText(inline[1], { filePath: 'index.js' })),
  ...(await eslint.lintFiles('scripts/*.mjs')),
];
for (const result of results) {
  for (const message of result.messages) {
    const file = result.filePath.endsWith('/index.js') ? 'index.html' : result.filePath;
    const line = file === 'index.html' ? message.line + offset : message.line;
    console.error(`${file}:${line}:${message.column} ${message.severity === 2 ? 'error' : 'warning'} ${message.ruleId}: ${message.message}`);
  }
}
const errors = results.reduce((sum, result) => sum + result.errorCount, 0);
const warnings = results.reduce((sum, result) => sum + result.warningCount, 0);
console.log(`ESLint: ${errors} errors, ${warnings} warnings`);
if (errors || warnings) process.exitCode = 1;
