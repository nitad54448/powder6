/* Apply the saved theme before the first paint.
 * Loaded synchronously in the document head; independent of the app runtime.
 */
(function applyInitialTheme() {
  'use strict';

  function readStoredValue(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      // Storage can be unavailable in private or restricted browser contexts.
      return null;
    }
  }

  function readThemePreference() {
    var settingsText = readStoredValue('powder6.settings');
    var settings;

    if (settingsText) {
      try {
        settings = JSON.parse(settingsText);
      } catch (error) {
        settings = null;
      }
    }

    var preference = settings && settings.theme;
    if (preference === 'light' || preference === 'dark' || preference === 'system') {
      return preference;
    }

    // Preserve the theme when opening an older Powder 5 project installation.
    var legacyPreference = readStoredValue('powder5-theme');
    if (legacyPreference === 'light' || legacyPreference === 'dark') {
      return legacyPreference;
    }

    return 'system';
  }

  var theme = readThemePreference();
  if (theme === 'system') {
    var darkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = darkMode ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', theme);
})();
