import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { languages, localeFile } from '../src/languages.ts';

const codes = languages.map(([code]) => code);
assert.equal(new Set(codes).size, codes.length, 'Duplicate language code');

async function load(code) {
  const file = new URL(
    `../src/locales/${localeFile(code)}.json`,
    import.meta.url,
  );
  return JSON.parse(await readFile(file, 'utf8'));
}

function checkMessages(expected, actual, path) {
  if (typeof expected === 'string') {
    assert.equal(typeof actual, 'string', `${path} must be text`);
    assert.ok(!expected || actual.trim(), `${path} is missing a translation`);
    return;
  }

  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    `${path} has missing or extra message keys`,
  );
  for (const key of Object.keys(expected)) {
    checkMessages(expected[key], actual[key], `${path}.${key}`);
  }
}

const source = await load('en');
for (const code of codes) checkMessages(source, await load(code), code);
console.log(`Checked message coverage for ${codes.length} tour languages.`);
