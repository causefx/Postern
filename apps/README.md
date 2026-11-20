# Apps

Each folder here is one self-hosted app Postern knows. The folder name is the app's id. Postern uses
the folder to:

- recognise the app when someone types its address (the hint in the service drawer),
- suggest how the app takes its key and where to find it, and
- show the app's icon next to services that use it.

Nothing here is code. The server checks every folder at start-up, and `go test ./...` checks them too.

## Adding an app

1. Make a folder named after the app: `apps/<id>/`. Use lower-case letters, digits and dashes, such as
   `audiobookshelf`.
2. Add `app.json`. Start from a similar app. Your editor completes and checks it through the
   `"$schema": "../schema.json"` line.
3. Add `icon.svg`, then run `npm run icons:optimize`.
4. Run `go test ./cmd/postern/` and fix anything it reports.

No Go or JavaScript changes are needed.

### `app.json`

```json
{
  "$schema": "../schema.json",
  "label": "Jellyfin",
  "auth": { "header": "X-Emby-Token" },
  "keyHint": "Dashboard → API Keys → +",
  "match": { "title": ["jellyfin"] },
  "probe": {
    "path": "System/Info/Public",
    "discover": true,
    "json": { "ProductName": { "contains": "Jellyfin" } },
    "version": { "json": "Version" }
  },
  "icon": { "source": "dashboard-icons" }
}
```

| Field | What it is |
|---|---|
| `label` | The app's name as people write it. |
| `auth` | How the app takes its key (below). Use `null` for an app Postern cannot send a key to, and explain why in `note`. |
| `keyHint` | Where the key is in the app, as a menu path with `→`. |
| `note` | Shown instead of a key suggestion. Only with `"auth": null`. |
| `match` | How the app's own page gives it away (below). |
| `probe` | A public endpoint that confirms the app and reports its version (below). Optional. |
| `icon.source` | Where `icon.svg` comes from. `LICENSES/<source>.txt` must hold its licence. |

### How the app takes its key

`auth` lists every way the app accepts its key. Give all of them: Postern sends the key each way.

| Key | Means | Example |
|---|---|---|
| `header` | the key goes in this header | `"X-Api-Key"` |
| `query` | the key goes in this URL parameter | `"apikey"` |
| `authz` | an `Authorization` header: `bearer` for a token, `basic` for a user name and password | `"bearer"` |

```json
"auth": { "header": "X-Api-Key", "query": "apikey" }
```

When a test recognises the app, its **Set up for <app>** button adds each of these to the service's
upstream credentials, ready for the key to be typed in.

### Matching the page

Postern first reads the page the address returns and scores every app against it. The best score wins:

| Rule | Matches when | Score |
|---|---|---|
| `match.header` | the response has this header | strongest |
| `match.body` | the page contains this exact string, such as `window.Sonarr` | strong |
| `match.title` | the page `<title>` is this, or contains it as a whole word | the title is exactly it beats a word in it |

Titles are lower case and match whole words, so `jellyfin` does not match a Jellyseerr page. Body
strings are at least 6 characters, so they stay specific.

### Probes

When the page names an app that has a `probe`, Postern asks that endpoint for the version. The request
never carries the upstream key and never follows a redirect to another host.

A probe passes when every check it lists passes:

- `json`: top-level fields of a JSON answer, each with one test: `{"contains": "..."}`,
  `{"equals": "..."}` or `{"present": true}`.
- `jsonKeys`: the answer has exactly these top-level keys, and no others.
- `text`: the answer contains each of these strings.

`version` says where the version is: `{"json": "Version"}` for a top-level field, or
`{"regex": "..."}` whose first group is the version.

`"discover": true` lets Postern also try the probe when the page named no app at all, which helps with
apps whose page is a blank shell. Every such probe is a request to every address someone types, so at
most 6 different paths may discover. Apps that share an endpoint, such as Jellyfin and Emby on
`System/Info/Public`, share one request.

### Icons

- SVG only, at most 64 KB. Keep it square and readable at 16 pixels.
- No scripts, event handlers, `<foreignObject>`, external links, embedded images or `<!DOCTYPE>`. The
  test refuses them. Illustrator exports often carry an empty `<foreignObject/>` inside a `<switch>`,
  and some carry a hidden `<image>` preview; delete them.
- It sits on a tile that follows the theme, so it must read on light and dark alike. An icon in one
  colour (all black or all white) gets a tile of its own in the opposite colour, drawn as a `<rect>`
  behind it, as `jackett` and `mylar` do.
- Run `npm run icons:optimize` before committing.
- Most icons come from [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) (Apache 2.0).
  When it has only a PNG, try [selfh.st icons](https://github.com/selfhst/icons) (CC BY 4.0, source
  `selfhst-icons`). An icon from somewhere else needs its licence in `LICENSES/<source>.txt` and that
  `source` in `app.json`.

