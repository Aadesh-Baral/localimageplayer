# Local Image Player

Organise photos from shared Google Drive folders and local folders into
**projects**, curate them into nested collections, and play them full screen —
as an automatic slideshow or by clicking through. Projects are saved on the
server (Netlify Blobs in production, a local `.data/` folder in dev), so they
survive browser resets and open on any device.

## Projects

```
Project
├─ Google Drive links      (the exact lines you pasted)
├─ Local folder paths      (a path/label you choose)
└─ Collections (nested)
   └─ images
      ├─ gdrive  → { "<drive link>":  [driveFileId, …] }
      └─ local   → { "<folder path>": [fileName, …] }
```

Pick or create a project from the switcher at the top left; the **⋯** menu has
rename, delete, the Google API key, and **Import from browser storage**, which
copies the old browser-only folders and groups into a new project (the old data
is left in place as a backup). Changes save automatically; the indicator next
to the menu shows *Saving… / Saved*, and turns red with a retry if a save fails.

### Export / import

**⋯ → Export project (.json)** saves the project's metadata — Drive links,
local folder paths, and all collections — to a file. **⋯ → Import project…**
(or the link on the welcome screen) turns such a file into a **new** project;
it never overwrites an existing one. Photos themselves aren't in the file,
only references. Local folders have to be chosen again after importing
(**Choose folder…** on each), since folder access is per browser.

## Local folders

**+ Local folder…** uses Chrome/Edge's folder picker. Browsers never expose real
paths, so you're asked for a path or label to store in the project (it defaults
to the folder name). The folder itself is remembered **in this browser only**:

- After a restart the browser may ask again — click **Reconnect** on the section.
- On another computer or browser the folder shows **Not connected** — click
  **Choose folder…** and pick the same folder there. Collections match photos by
  file name, so everything lines up again.
- On phones/Safari/Firefox local folders can't be opened; Drive photos still work.
- Only images directly inside the folder are listed (no subfolders).

## Google sign-in setup (one time)

Sign-in does two jobs: it decides whose projects you see, and Drive requests
go out **as you** (read-only) instead of as an anonymous API key — so
downloads aren't hit by Google's "automated queries" block, and folders shared
only with your account work too.

1. [Google Cloud Console](https://console.cloud.google.com/) → your project →
   *APIs & Services → Library*: make sure **Google Drive API** is enabled.
2. *OAuth consent screen* (Google Auth Platform → Branding/Audience):
   - User type **External**, publishing status **Testing**.
   - Add yourself (and anyone else who'll use it) under **Test users**.
   - Data access / scopes: add `.../auth/drive.readonly`, `openid`, `email`,
     `profile`.
3. *Credentials → Create credentials → OAuth client ID → Web application*.
   **Authorised JavaScript origins**: `http://localhost:5173` and your Netlify
   URL (e.g. `https://your-site.netlify.app`). No redirect URIs needed.
4. Copy the client ID into `.env.local` as `VITE_GOOGLE_CLIENT_ID=…`
   (see `.env.example`), optionally set `ALLOWED_EMAILS`, and restart `pnpm dev`.

Google shows an "unverified app" warning while the app is in Testing — that's
expected for a personal app; choose *Continue*. Access tokens last about an
hour; when one runs out a bar appears at the top with **Continue** (one click,
no password). Nothing is lost meanwhile — saves wait and retry.

## Deploy to Netlify

1. Run `pnpm install` once locally (adds `@netlify/blobs` and updates the
   lockfile), then commit and push.
2. Create the site from the repo — `netlify.toml` already sets the build
   (`pnpm build` → `dist`) and the `/api/projects` function.
3. Site settings → Environment variables: `VITE_GOOGLE_CLIENT_ID` (same value
   as locally) and `ALLOWED_EMAILS` (**required** — comma-separated; with it
   unset the deployed API refuses everyone. `ALLOW_ANY_GOOGLE_ACCOUNT=true`
   overrides that on purpose). Redeploy after changing them — the client ID is
   baked into the build.
4. Add the Netlify URL to the OAuth client's JavaScript origins (step 3 above).
5. After the first deploy, open the site with DevTools → Console and sign in,
   load a Drive folder, open the viewer and run a download: there should be no
   "Content Security Policy" errors. `netlify.toml` sets the CSP and other
   security headers; if Google changes a host, add it there.

### Security notes

- Every `/api/projects` call needs a Google access token issued to *this*
  OAuth client; projects are stored per Google account ID and other accounts
  can't list, read, overwrite or delete them. Max 200 projects × 4 MB each.
- The Google token (Drive read-only) lives in `sessionStorage` for the tab and
  expires after ~1 hour. Revoked tokens may keep working against the API for
  up to 5 minutes (verification cache).
- Run `pnpm audit` before deploying and after dependency updates.

Projects are stored in the `imageplayer-projects` blob store under each
account's Google ID, so accounts never see each other's projects. Data saved
while running `pnpm dev` stays in `.data/projects/<googleId>/` and isn't
uploaded; projects created before sign-in existed are adopted by the first
account that signs in locally.

## Run it

```bash
cd ~/Documents/personal/projects/imageplayer
pnpm install
pnpm dev
```

Opens at http://localhost:5173.

## Optional: API key (when not signed in)

The app reads public Drive folders through the Drive API, which needs an API key
(no sign-in, no OAuth consent screen).

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create or select a project.
2. **APIs & Services → Library** → search for **Google Drive API** → **Enable**.
3. **APIs & Services → Credentials** → **Create credentials → API key** → copy it.
4. Recommended: click the new key and restrict it —
   - *API restrictions* → Google Drive API only
   - *Application restrictions* → HTTP referrers → `http://localhost:5173/*`
5. In Google Drive, right-click the folder → **Share** → **Anyone with the
   link** → **Viewer**.

*(Optional since sign-in.)* Paste the key into the app once; it's saved in your browser's localStorage. If
you'd rather bake it in, copy `.env.example` to `.env.local`, set
`VITE_GOOGLE_API_KEY`, and restart the dev server.

## Using it

Paste your folder links — one per line — hit **Load photos**, then click any
thumbnail (or **Play all**). The workspace has two tabs: **Library** (everything
you've loaded) and **Collections** (your own groups).

### Multiple folders

Each folder becomes its own collapsible section, labelled with its real Drive
name. Per section you get **Select all**, **Play**, reload (↻) and remove (×);
the header row has **Collapse all** and **Play all**. Add more folders any time
with the **Add another Drive folder link…** box at the top of the Library.

Collapse state is remembered per folder, and the folder list itself is saved, so
reopening the app restores the same sections. The photo listings are always
re-fetched rather than cached, so you never see a stale folder.

A few behaviours worth knowing:

- **Play all** plays every section end to end, in the order the folders are
  listed. Clicking a thumbnail also plays the whole library from that point, so
  a slideshow started in one folder rolls on into the next. **Play** on a
  section stays within that folder.
- **Selection spans sections.** Shift-click ranges work across a folder
  boundary, because the underlying list is the flattened view of all folders.
  Section **Select all** adds to the current selection rather than replacing it,
  so you can build one group from several folders.
- If the same file somehow appears in two folders, it's listed once.

### Selecting photos

Hover a thumbnail and click the circle to select it. Shift-click another circle
to select the range between them; ⌘/Ctrl-click the image itself toggles
selection without opening the viewer. A bar appears at the bottom with **Add to
group**, **Play selection**, **Download ZIP**, **Select all** and **Clear**.

Clicking a photo opens the viewer on that photo. If the photo is part of your
current selection, the slideshow plays just the selected photos, starting there.

### Groups

Groups nest to any depth and behave like albums, not folders — the same photo
can sit in as many groups as you like, and removing it from one leaves the
others alone. A single group can mix photos from different Drive folders; hover
a thumbnail to see which folder it came from. Nothing here touches Google Drive
or your disk; collections are just references saved in the project.

In the Collections tab you can:

- **Create** a group with **+ New**, or a subgroup with the **+** on any row
- **Rename** by double-clicking the name (or the ✎ button)
- **Delete** with ×, which also deletes everything nested under it
- **Re-nest** by dragging a group onto another; dragging onto blank space in the
  sidebar moves it back to the top level. Dropping a group into its own subtree
  is rejected, so you can't create a loop
- **Add photos** by dragging a selection onto a group row
- **Add the photo you're viewing** with **Add to group** in the viewer's top bar
  (or `G`). Groups it's already in are ticked; click one again to remove it
- **Remove from group** via the selection bar
- Toggle **Include subgroups** to see a group's own photos only, or everything
  beneath it too

The count on each row is the total including subgroups; hover it for the direct
count.

### Downloading

**Download ZIP** fetches the selected files through the Drive API and bundles
them in the browser — nothing is uploaded anywhere. Files are stored rather than
deflated, since JPEGs don't compress further. Downloads run one at a time to
stay clear of Drive's rate limits, so a large selection takes a while; there's a
progress bar and a cancel button.

If individual files fail (deleted, or no longer shared) the zip still builds and
you get a note listing what was skipped.

| Control | Does |
| --- | --- |
| `←` `→` | Previous / next |
| `Space` | Play / pause slideshow |
| `F` | Toggle full screen (or double-click the image) |
| `S` | Shuffle |
| `L` | Loop |
| `W` | Keep the display awake |
| `G` | Add the current photo to a group (also the **Add to group** button, top right) |
| `Home` / `End` | First / last image |
| `?` | Shortcut cheat sheet |
| `Esc` | Leave full screen, then back to the library |

On-screen: arrows on either side, a bottom bar with play/pause, slide interval
(2–30s), shuffle, loop, keep-awake, and full screen. Everything fades out after
~2.5s of no input and comes back the moment you move the mouse. The left and
right thirds of the screen are also click targets for prev/next.

## Keeping the screen on

The viewer holds a [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
while it's open, so the display won't dim or sleep during a slideshow. It's on
by default; toggle it with the **Keep awake** chip or `W`.

Caveats worth knowing:

- Requires a **secure context**. `localhost` qualifies, so `npm run dev` is
  fine — but serving the built files from a LAN IP over plain `http://` will
  not work. Use `https://` or localhost.
- The browser drops the lock any time the page isn't visible (tab switch,
  minimise). The app re-requests it automatically when you come back.
- It prevents the *display* from sleeping. It does not stop a manual lock
  (Ctrl+Cmd+Q), and some machines refuse the lock while in battery-saver mode —
  the chip won't light up if that happens, and `?` explains why.
- Unsupported browsers simply hide the chip; everything else still works.

## How it works

- `src/drive.js` — parses any Drive URL shape into an ID, lists images in a
  folder via Drive API v3 (paginated, natural name order), and builds display
  URLs. Images are served from `lh3.googleusercontent.com/d/<id>=s<size>`, which
  has friendlier CORS than the classic `uc?export=view` redirect; if that fails
  for a file, it falls back to `drive.google.com/thumbnail`.
- `src/Viewer.jsx` — playback state, keyboard handling, neighbour preloading.
- `src/Slide.jsx` — one crossfade layer, with load/error handling.
- `src/useIdle.js` — the auto-hide timer.
- `src/useWakeLock.js` — screen wake lock, re-acquired on visibility change.
- `src/googleAuth.js` — Google Identity Services sign-in (token model); keeps
  the access token that `api.js` and the Drive helpers attach as `Bearer`.
- `api/auth.js` — server-side check of that token via Google's tokeninfo
  (right OAuth client, verified email, optional `ALLOWED_EMAILS`).
- `src/project.js` — the project document, photo keys
  (`["gdrive"|"local", linkOrPath, fileIdOrName]`), and conversion between saved
  collections and the in-memory group tree.
- `src/useProjects.js` + `src/api.js` — list/open/create/delete projects,
  debounced autosave, and the import from old browser storage.
- `api/projects-core.js` — the `/api/projects` handler, shared by
  `netlify/functions/projects.mjs` (Netlify Blobs) and `api/dev-store.js`
  (Vite dev middleware writing `.data/projects/*.json`).
- `src/localFolders.js` — folder picker, permission checks, and folder handles
  kept in IndexedDB per project.
- `src/media.js` — thumbnail/display/original-bytes for either vendor.
- `src/useSources.js` — a project's Drive links and local folders. Persists only
  the source list; images are re-read each session.
- `src/groups.js` — the group tree. Stored flat as `{ id: { parentId, photoIds } }`
  and shaped into a tree on read, so re-parenting is one field write instead of
  a splice in two places. Includes the cycle check that makes arbitrary nesting
  safe, plus a one-time migration from the older per-folder stores.
- `src/useGroups.js` — immutable mutators over the group tree; every change is
  handed to the project for saving.
- `src/useSelection.js` — multi-select with shift-click ranges, rebased on
  whatever list is currently visible.
- `src/download.js` — ZIP building via JSZip, fetching bytes from the Drive
  `alt=media` endpoint (the display CDN doesn't allow cross-origin reads).

## Known limits

- Only images directly inside each folder are listed; subfolders aren't walked.
  Add a subfolder as its own link if you want it.
- Collections reference photos by vendor + link/path + file ID/name, so a photo
  whose source isn't loaded or connected shows up as an "unavailable" count
  rather than a broken tile — reload or reconnect that source and it reappears.
- Renaming a local file breaks its reference (the name is the identifier).
- Saving is last-write-wins: editing the same project in two tabs at once can
  overwrite one tab's changes.
- Every folder needs to be link-shared and readable by the same API key.
- The folder must be link-shared. Private folders would need OAuth instead of an
  API key.
- An API key in a client-side app is visible to anyone using the page. Keep the
  referrer restriction on it, and don't deploy this publicly with your key
  embedded.

## Build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the built files
```

### Downloads

**Download ZIP** (selection) and **Download group** add a job to the
**Downloads** tab. Jobs run one at a time and always fetch the original files —
never resized copies. Rate-limit and server errors are retried automatically.

Choose how jobs are saved at the top of the Downloads tab:

- **Save to folder** (Chrome/Edge, default): you pick a destination when you
  start a job; each photo is written into `<destination>/<job name> <date>/`
  the moment it arrives, so jobs of any size work and only one photo is ever
  held in memory.
- **ZIP files**: bundled into parts of at most ~500 MB
  (`<name> part 1.zip`, `part 2`, …) in your browser's Downloads folder. One
  multi-gigabyte zip would exceed what a browser tab may allocate.

Each job lists Google's reason for any failed photo. **Retry N failed**
fetches only those photos again — into the same folder, or as a
`(retry N)` zip. The list is kept in memory, so it clears on reload.
