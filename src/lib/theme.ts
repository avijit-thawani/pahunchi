// Light / dark / follow-the-phone theme, stored locally and applied to <html data-theme>.
// The call screen ignores it and always looks like a dark phone call.

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'phoney.theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function apply() {
  const pref = getThemePref()
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  document.documentElement.setAttribute('data-theme', dark ? 'duo-dark' : 'duo')
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131f24' : '#ffffff')
}

export function setThemePref(pref: ThemePref) {
  localStorage.setItem(KEY, pref)
  apply()
}

export function initTheme() {
  apply()
  media.addEventListener('change', apply)
}
