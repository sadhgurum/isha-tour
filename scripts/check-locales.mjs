import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { languages } from '../src/languages.ts';

const codes = languages.map(([code]) => code);
// These places use English until a locale has a translation for them.
const englishFallbackPlaces = [
  'roadside-food',
  'c-section',
  'neem-point',
  'adiyogi-parking',
];
assert.equal(new Set(codes).size, codes.length, 'Duplicate language code');
const englishNames = languages.map(([, name]) => name.toLocaleLowerCase('en'));
assert.equal(
  new Set(englishNames).size,
  englishNames.length,
  'Duplicate English language name',
);

async function load(code) {
  const file = new URL(`../src/locales/${code}.json`, import.meta.url);
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
for (const code of codes) {
  const locale = await load(code);
  const expected = { ...source, places: { ...source.places } };
  for (const place of englishFallbackPlaces) {
    if (!Object.hasOwn(locale.places, place)) delete expected.places[place];
  }
  checkMessages(expected, locale, code);
}
console.log(`Checked message coverage for ${codes.length} tour languages.`);
