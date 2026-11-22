import { languages, supportedLanguage } from './languages';
import english from './locales/en.json';

type Language = (typeof languages)[number][0];
type Messages = typeof english;
type MessageKey = keyof Messages['ui'];
type Place = keyof Messages['places'];

const storageKey = 'isha.language';
const rightToLeft = new Set<Language>(['ar', 'fa', 'he', 'ur']);
const loaders = import.meta.glob<Messages>(
  ['./locales/*.json', '!./locales/en.json'],
  { import: 'default' },
);
const listeners = new Set<() => void>();

let messages = english;
let current: Language = 'en';
let request = 0;

export const message = (key: MessageKey) => messages.ui[key];
export const placeText = (place: Place) => messages.places[place];

export function onLanguageChange(render: () => void) {
  listeners.add(render);
  render();
}

export function bindMessage(
  element: HTMLElement,
  key: MessageKey,
  property: 'textContent' | 'title' = 'textContent',
) {
  onLanguageChange(() => {
    element[property] = message(key);
  });
}

function preferredLanguage() {
  const shared = supportedLanguage(
    new URL(location.href).searchParams.get('lang'),
  );
  if (shared) return shared;

  try {
    const saved = supportedLanguage(localStorage.getItem(storageKey));
    if (saved) return saved;
  } catch {
    // The picker also works when browser storage is blocked.
  }

  for (const tag of navigator.languages) {
    const language = supportedLanguage(tag.toLowerCase().split('-')[0]);
    if (language) return language;
  }
  return 'en';
}

async function activate(language: Language) {
  const revision = ++request;
  let next = english;
  if (language !== 'en') {
    const load = loaders[`./locales/${language}.json`];
    if (!load) throw new Error(`Missing tour locale: ${language}`);
    next = await load();
  }
  if (revision !== request) return false;

  messages = next;
  current = language;
  document.documentElement.lang = language === 'zh' ? 'zh-Hans' : language;
  document.documentElement.dir = rightToLeft.has(language) ? 'rtl' : 'ltr';
  for (const render of listeners) render();
  return true;
}

export async function initializeLanguage(
  select: HTMLSelectElement,
  indicator: HTMLElement,
) {
  function updateSelection() {
    select.value = current;
    indicator.textContent = current;

    const url = new URL(location.href);
    if (current === 'en') url.searchParams.delete('lang');
    else url.searchParams.set('lang', current);
    if (url.href !== location.href) {
      history.replaceState(history.state, '', url);
    }
  }

  for (const [language, nativeName] of languages) {
    const option = new Option(nativeName, language);
    option.lang = language === 'zh' ? 'zh-Hans' : language;
    option.dir = rightToLeft.has(language) ? 'rtl' : 'ltr';
    select.add(option);
  }

  try {
    await activate(preferredLanguage());
  } catch (error) {
    console.warn('Could not load the preferred tour language.', error);
  }
  updateSelection();

  select.addEventListener('change', async () => {
    const language = supportedLanguage(select.value);
    if (!language) return;
    try {
      if (!(await activate(language))) return;
    } catch (error) {
      if (select.value === language) select.value = current;
      console.warn('Could not apply the tour language preference.', error);
      return;
    }

    updateSelection();
    try {
      localStorage.setItem(storageKey, language);
    } catch {
      // The selected language still applies for this visit.
    }
  });
}
