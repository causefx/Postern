# Gallery

Every screen of the admin UI, in the order you meet them. The pictures follow your GitHub theme (dark or light). Both versions of each are in [`screenshots/`](screenshots/), together with the phone layouts.

The services shown are made up, and so are their keys. [`e2e/screenshots/`](../e2e/screenshots/) takes the pictures and rebuilds this page: `npm run screenshots`, then `npm run screenshots:publish`.

- [Sign in](#sign-in)
- [Dashboard](#dashboard)
- [Add a service](#add-a-service)
- [Edit a service](#edit-a-service)
- [Settings](#settings)
- [Backup: export and import](#backup-export-and-import)
- [On a phone](#on-a-phone)

## Sign in

The password sign-in, with the diagram of what a caller sends and what the service receives. With OpenID Connect set up, a second button appears beside the password.

**Sign in**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/login-dark.webp">
  <img src="screenshots/desktop/login-light.webp" alt="The sign-in page" width="900">
</picture>

**A wrong password says so and keeps the field focused**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/login-wrong-password-dark.webp">
  <img src="screenshots/desktop/login-wrong-password-light.webp" alt="The sign-in page after a wrong password" width="900">
</picture>

## Dashboard

Every service, with its route, upstream, how callers get in and what it last did. Press `Ctrl` or `⌘` `K` for the command palette, or tick rows for bulk actions.

**First run**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/dashboard-empty-dark.webp">
  <img src="screenshots/desktop/dashboard-empty-light.webp" alt="The dashboard before any service exists" width="900">
</picture>

**The dashboard**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/dashboard-dark.webp">
  <img src="screenshots/desktop/dashboard-light.webp" alt="The dashboard with eight services" width="900">
</picture>

**Tick rows for bulk actions**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/dashboard-selection-dark.webp">
  <img src="screenshots/desktop/dashboard-selection-light.webp" alt="Two services selected, with the bulk action bar" width="900">
</picture>

**The command palette**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/palette-search-dark.webp">
  <img src="screenshots/desktop/palette-search-light.webp" alt="The command palette searching for plex" width="900">
</picture>

**The account menu**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/account-menu-dark.webp">
  <img src="screenshots/desktop/account-menu-light.webp" alt="The account menu with Settings, Theme and Sign out" width="900">
</picture>

## Add a service

A name, the upstream address and its credentials. A preset fills in the credential shape for common apps. The upstream key is stored on the server and never shown again.

**Add a service from a preset**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/add-service-filled-dark.webp">
  <img src="screenshots/desktop/add-service-filled-light.webp" alt="The add service drawer, filled in from the *arr preset" width="900">
</picture>

**A form that is not ready is refused with the reason**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/add-service-error-dark.webp">
  <img src="screenshots/desktop/add-service-error-light.webp" alt="The add service drawer refusing an empty form" width="900">
</picture>

## Edit a service

Everything about one service lives in a drawer with five tabs. Edits are marked until saved.

**Connection: name, upstream and credentials**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-connection-dark.webp">
  <img src="screenshots/desktop/edit-connection-light.webp" alt="The Connection tab of a service" width="900">
</picture>

**Access: how callers get in, and their tokens**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-access-dark.webp">
  <img src="screenshots/desktop/edit-access-light.webp" alt="The Access tab with three caller tokens" width="900">
</picture>

**Limit a token to some methods and paths**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-access-scope-dark.webp">
  <img src="screenshots/desktop/edit-access-scope-light.webp" alt="Limiting a token to read-only methods and one path" width="900">
</picture>

**Give a token an expiry date**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-access-expiry-dark.webp">
  <img src="screenshots/desktop/edit-access-expiry-light.webp" alt="Setting an expiry date on a token" width="900">
</picture>

**Advanced: paths that need no token**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-open-paths-dark.webp">
  <img src="screenshots/desktop/edit-open-paths-light.webp" alt="The Advanced tab with open paths" width="900">
</picture>

**Requests: what callers did, with refusals marked**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-requests-dark.webp">
  <img src="screenshots/desktop/edit-requests-light.webp" alt="The service request log" width="900">
</picture>

**How to use: examples with the real address**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-how-to-use-dark.webp">
  <img src="screenshots/desktop/edit-how-to-use-light.webp" alt="The How to use tab with copy-ready examples" width="900">
</picture>

**Closing with edits asks what to do**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-unsaved-dark.webp">
  <img src="screenshots/desktop/edit-unsaved-light.webp" alt="The unsaved changes dialog" width="900">
</picture>

**Rotate a token**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-rotate-token-dark.webp">
  <img src="screenshots/desktop/edit-rotate-token-light.webp" alt="The rotate token dialog" width="900">
</picture>

**Delete asks for the name**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/edit-delete-confirm-dark.webp">
  <img src="screenshots/desktop/edit-delete-confirm-light.webp" alt="The delete confirmation, which needs the name typed" width="900">
</picture>

**Duplicate a service**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/dialog-duplicate-dark.webp">
  <img src="screenshots/desktop/dialog-duplicate-light.webp" alt="The duplicate service dialog" width="900">
</picture>

**Rotate several tokens at once**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/dialog-bulk-rotate-dark.webp">
  <img src="screenshots/desktop/dialog-bulk-rotate-light.webp" alt="Rotating the tokens of two selected services" width="900">
</picture>

## Settings

Rate limit, log sizes, sign-in options and which sites may embed the admin UI. Changes are held until you press Save, and each save is written to the admin log.

**Settings**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-dark.webp">
  <img src="screenshots/desktop/settings-light.webp" alt="The settings drawer" width="900">
</picture>

**A setting with presets and a stepper**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-rate-limit-dark.webp">
  <img src="screenshots/desktop/settings-rate-limit-light.webp" alt="The rate limit setting expanded" width="900">
</picture>

**Saved, and logged**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-saved-toast-dark.webp">
  <img src="screenshots/desktop/settings-saved-toast-light.webp" alt="The settings saved notification" width="900">
</picture>

**Allow a dashboard to embed the admin UI**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-embedding-dark.webp">
  <img src="screenshots/desktop/settings-embedding-light.webp" alt="The embedding setting with two allowed sites" width="900">
</picture>

**Requests: every service in one list**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-requests-tab-dark.webp">
  <img src="screenshots/desktop/settings-requests-tab-light.webp" alt="The request log for all services" width="900">
</picture>

**Admin log: who changed what**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-admin-log-tab-dark.webp">
  <img src="screenshots/desktop/settings-admin-log-tab-light.webp" alt="The admin log" width="900">
</picture>

## Backup: export and import

Copy your services out as one JSON file, and read them back in. An import is checked first with a dry run, and nothing is applied unless every service passes.

**Export without secrets, safe to share**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-export-redacted-dark.webp">
  <img src="screenshots/desktop/settings-export-redacted-light.webp" alt="Exporting a redacted config" width="900">
</picture>

**Or a full backup, which needs a tick to confirm**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-export-full-dark.webp">
  <img src="screenshots/desktop/settings-export-full-light.webp" alt="Exporting a full backup" width="900">
</picture>

**Import from a file or pasted JSON**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-import-dark.webp">
  <img src="screenshots/desktop/settings-import-light.webp" alt="The import screen" width="900">
</picture>

**A misspelt field is an error, not silently dropped**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-import-unknown-field-dark.webp">
  <img src="screenshots/desktop/settings-import-unknown-field-light.webp" alt="An import refused because of a misspelt field" width="900">
</picture>

**Review what would happen before anything changes**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/desktop/settings-import-review-dark.webp">
  <img src="screenshots/desktop/settings-import-review-light.webp" alt="The import review: one create, one skip, one error" width="900">
</picture>

## On a phone

The same screens on a phone: a list instead of a table, drawers and the account menu as sheets that slide up. Swipe a row for quick actions, or press and hold to select several.

<table>
<tr>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/login-dark.webp">
  <img src="screenshots/mobile/login-light.webp" alt="Sign in" width="200">
</picture>

<sub>Sign in</sub>

</td>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/dashboard-dark.webp">
  <img src="screenshots/mobile/dashboard-light.webp" alt="The service list" width="200">
</picture>

<sub>The service list</sub>

</td>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/palette-search-dark.webp">
  <img src="screenshots/mobile/palette-search-light.webp" alt="The command palette" width="200">
</picture>

<sub>The command palette</sub>

</td>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/account-menu-dark.webp">
  <img src="screenshots/mobile/account-menu-light.webp" alt="The account menu" width="200">
</picture>

<sub>The account menu</sub>

</td>
</tr>
</table>

<table>
<tr>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/add-service-filled-dark.webp">
  <img src="screenshots/mobile/add-service-filled-light.webp" alt="Adding a service" width="200">
</picture>

<sub>Adding a service</sub>

</td>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/edit-access-dark.webp">
  <img src="screenshots/mobile/edit-access-light.webp" alt="A service: Access" width="200">
</picture>

<sub>A service: Access</sub>

</td>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/edit-requests-dark.webp">
  <img src="screenshots/mobile/edit-requests-light.webp" alt="A service: Requests" width="200">
</picture>

<sub>A service: Requests</sub>

</td>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/settings-dark.webp">
  <img src="screenshots/mobile/settings-light.webp" alt="Settings" width="200">
</picture>

<sub>Settings</sub>

</td>
</tr>
</table>

<table>
<tr>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/settings-export-redacted-dark.webp">
  <img src="screenshots/mobile/settings-export-redacted-light.webp" alt="Exporting a config" width="200">
</picture>

<sub>Exporting a config</sub>

</td>
<td align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/mobile/settings-import-review-dark.webp">
  <img src="screenshots/mobile/settings-import-review-light.webp" alt="Reviewing an import" width="200">
</picture>

<sub>Reviewing an import</sub>

</td>
</tr>
</table>
