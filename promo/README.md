# Promo video

How to rebuild `promo/postern-promo.mp4` after the UI changes: take fresh screenshots, render the
motion-graphics scenes from them, and join everything into the final video.

```
e2e/screenshots/shoot.mjs   ->  e2e/screenshots/out/<view>-<theme>/NN-name.png
promo/render.mjs            ->  promo/build/<scene>.mp4 and the caption PNGs
promo/assemble.py           ->  promo/postern-promo.mp4
```

`build/`, `frames/`, `clips/` and every `.mp4` are ignored by git, so only the scripts and
`compose.html` are committed.

## What you need

- **Go**, to build the Postern binary the screenshots are taken from.
- **Node** and the e2e packages: `cd e2e && npm ci`, then `npx playwright install chromium` once.
  You can skip the browser download and use Edge or Chrome by setting `E2E_CHANNEL=msedge` or
  `E2E_CHANNEL=chrome`. Both `shoot.mjs` and `render.mjs` read it.
- **ffmpeg** on your `PATH`.
- **Python 3**. `assemble.py` uses only the standard library; `frames.py` also needs Pillow.
- The generated clips in `promo/clips/`: `intro-door.mp4`, `outro-door.mp4` and, if you want
  sound, `music.mp3`. These were made in Higgsfield and are not in git. They don't show the UI, so
  you can keep the ones you already have.

Run every command below from the repository root unless it says otherwise. The examples are for
PowerShell. In bash, set variables inline, as in `E2E_CHANNEL=msedge npm run screenshots`.

## 1. Take new screenshots

The screenshots come from the UI that is embedded in the binary, not from `web/`. If you changed any
styles, rebuild the CSS first so the binary picks it up:

```powershell
npm run build:css
```

Then shoot every screen in all four views (desktop and phone, dark and light):

```powershell
cd e2e
npm run screenshots          # with Edge: $env:E2E_CHANNEL = 'msedge'; npm run screenshots
cd ..
```

This builds `./cmd/postern`, starts it on port 18090 with a fresh data file, adds the demo services
and some traffic, and saves each screen as `e2e/screenshots/out/<view>-<theme>/NN-name.png`.

**Check the end of the output.** A screen that fails is listed there, and a picture of the page at
the moment it failed goes to `e2e/screenshots/out/_failed/`. A failed screen keeps the old file from
the previous run, so the video would quietly mix old and new UI. Fix the step in `shoot.mjs` (for
example, a selector that no longer matches after a dialog changed) and shoot again.

To redo only some screens:

```powershell
$env:SHOT_VIEW = 'desktop-dark'          # one view: desktop-dark, desktop-light, mobile-dark, mobile-light
$env:SHOT_ONLY = 'edit-access|palette'   # regex matched against "desktop-dark/17-edit-access"
npm run screenshots
Remove-Item Env:SHOT_VIEW, Env:SHOT_ONLY
```

Change the port with `SHOT_PORT` if 18090 is in use.

### Screens the video uses

`compose.html` loads these files **by name and number**. If you add, remove or reorder a screen in
`shoot.mjs`, the numbers after it change, and you must update the paths in `compose.html` to match.

| Scene | Files |
|---|---|
| dash | `desktop-dark/05-dashboard` |
| palette | `desktop-dark/09-palette`, `desktop-dark/10-palette-search` |
| scope | `desktop-dark/17-edit-access`, `desktop-dark/18-edit-access-scope` |
| requests | `desktop-dark/21-edit-requests` |
| theme | `desktop-light/05-dashboard`, `desktop-dark/05-dashboard` |
| mobile | `mobile-dark/05-dashboard`, `mobile-light/07-palette-search`, `mobile-dark/18-edit-requests` |
| wall | 12, 16, 22, 26, 27, 29, 31, 32, 33, 35, 37, 39 from both `desktop-dark` and `desktop-light` |

## 2. Check the overlays still line up

Some scenes draw on top of the screenshot at positions that were measured by hand. If the layout
moved, these will now point at the wrong place:

- **dash**: the row bands that slide in one by one (`bands` in the script section of
  `compose.html`), measured in pixels on `05-dashboard.png`.
- **scope**: the two green rings `#scope-ring` and `#scope-ring2`, around the method chips and the
  path field.
- **requests**: the two red bars `#req-bar1` and `#req-bar2`, over the refused rows in the log.

Render one frame of a scene to check it:

```powershell
node promo/render.mjs --still scope 4      # writes promo/build/still-scope-4.png
node promo/render.mjs --still requests 4
node promo/render.mjs --still dash 3
```

You can also open `promo/compose.html#scope?t=4` in a browser to see the same frame. Adjust the
`left`/`top`/`width`/`height` on those elements (they are in the screenshot's 1440×900 coordinates)
until they fit, then render the still again.

## 3. Render the scenes

```powershell
node promo/render.mjs
```

This renders every scene to `promo/build/<scene>.mp4` at 1920×1080, 30 fps, plus the transparent
caption cards (`cap-intro.png`, `cap-theme.png`, `cap-mobile.png`). It takes a few minutes because
each frame is a separate screenshot. To redo only some scenes, name them:

```powershell
node promo/render.mjs scope requests
```

Scene names: `title dash palette scope requests theme mobile wall end cap-theme cap-mobile cap-intro`.

## 4. Assemble the video

```powershell
python promo/assemble.py
```

This joins the intro clip, the rendered scenes and the outro clip with crossfades, lays the
`cap-intro` caption over the opening shot, adds `clips/music.mp3` with a fade in and out if the file
is there, and writes `promo/postern-promo.mp4` (about 47.5 seconds). Scene order, lengths and
transitions are in the `SEGMENTS` list at the top of `assemble.py`.

Watch it all the way through before you share it.

## Optional: new stills for Higgsfield

If you want to make new generated clips from the current UI, `frames.py` turns the dashboard
screenshots into card-on-backdrop stills for Higgsfield to animate:

```powershell
python promo/frames.py      # writes promo/frames/{desktop,mobile}-{dark,light}.png
```

Generate the clip in Higgsfield, save it to `promo/clips/`, and add or replace its entry in
`SEGMENTS` in `assemble.py`.

## Quick reference

```powershell
npm run build:css                         # only if styles changed
cd e2e; npm run screenshots; cd ..        # then read the failure list at the end
node promo/render.mjs --still scope 4     # spot-check the hand-placed overlays
node promo/render.mjs
python promo/assemble.py
```
