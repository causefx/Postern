/**
 * Opt-out attributes for password managers and browser autofill. `autocomplete="off"` alone is
 * ignored by most managers, so each one gets its own. Applied to every input by h() in h.js; the
 * admin sign-in password is the one field that passes `allowAutofill: true`.
 */
export const IGNORE_ATTRS = {
  'data-1p-ignore': 'true', // 1Password
  'data-lpignore': 'true', // LastPass
  'data-bwignore': 'true', // Bitwarden
  'data-form-type': 'other', // Dashlane
  'data-protonpass-ignore': 'true', // Proton Pass
};
