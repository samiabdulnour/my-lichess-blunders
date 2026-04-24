# iOS build — "My Blunders"

Capacitor wraps the Next.js static export in a native iOS shell. The web
UI runs inside a WebKit view; API calls (`/api/puzzles`, Lichess import,
PGN analysis) go over the network to the Render deployment.

- **Bundle ID**: `com.samiabdulnour.myblunders`
- **App name**: `My Blunders`
- **Backend**: your existing Render deployment — URL lives in
  `NEXT_PUBLIC_API_BASE`
- **iOS project root**: `ios/` (committed)
- **Xcode workspace**: `ios/App/App.xcworkspace`

## One-time setup (first time only)

### 1. Confirm Xcode is installed

```sh
xcode-select -p   # should print a path
```

If not, install Xcode from the Mac App Store, launch it once to accept
the license, then run `sudo xcode-select --install` if it prompts for
command-line tools.

### 2. (Optional) Enroll in the Apple Developer Program

**Only needed when you want to submit to the App Store.** For running on
your own iPhone with a 7-day provisional signature, your regular Apple ID
is enough.

- Go to <https://developer.apple.com/programs/>
- Enroll as Individual — $99/yr, billed to your Apple ID
- Approval typically takes 24–48 hours

### 3. Set `NEXT_PUBLIC_API_BASE` for the iOS build

The static bundle inlines this value at build time, so every subsequent
`npm run ios:sync` needs the env var present.

Easiest: add it to a local `.env.local` (gitignored):

```
NEXT_PUBLIC_API_BASE=https://my-lichess-blunders.onrender.com
```

Or export it in your shell:

```sh
export NEXT_PUBLIC_API_BASE=https://my-lichess-blunders.onrender.com
```

Verify the Render deployment is live and responds at
`${NEXT_PUBLIC_API_BASE}/api/puzzles` — the app bails if that endpoint
is unreachable on first launch.

## Everyday workflow

### Develop (web)

```sh
npm run dev
```

Visit `http://localhost:3000`. This runs the full Next.js server with API
routes — the normal web experience, nothing to do with Capacitor.

### Rebuild the iOS bundle after a code change

```sh
npm run ios:sync
```

What this does:

1. `npm run build:static` → parks `app/api/` out of the way, runs
   `BUILD_TARGET=static next build`, produces `out/`, restores
   `app/api/`.
2. `npx cap sync ios` → copies `out/` into
   `ios/App/App/public/`, regenerates `capacitor.config.json`.

If you only changed native iOS code (rare), skip step 1 and just run
`npx cap sync ios`.

### Open in Xcode

```sh
npm run ios:open
```

This opens `ios/App/App.xcworkspace`. From there:

- **Product → Run** (⌘R) to launch in the simulator.
- To run on your phone: plug it in via USB, pick your phone in the
  device dropdown at the top, then ⌘R. First time, Xcode prompts you to
  set up signing — click "Enable Automatic Signing", pick your team
  (your personal Apple ID works for dev), and it will provision a
  7-day development certificate.

## Refreshing icons or splash

Both sources live in `resources/`:

- `resources/icon.png` — 1024×1024 master icon
- `resources/splash.png` — 2732×2732 master splash

If you edit the SVG source (`resources/icon.svg` / `splash.svg`),
re-rasterize with `sips` (pre-installed on macOS):

```sh
sips --setProperty format png --resampleHeightWidth 1024 1024 \
  resources/icon.svg --out resources/icon.png

sips --setProperty format png --resampleHeightWidth 2732 2732 \
  resources/splash.svg --out resources/splash.png
```

Then push through the asset catalog:

```sh
npx capacitor-assets generate --ios
```

## Shipping to the App Store

1. Have the Developer Program enrolled.
2. In Xcode: **App → Signing & Capabilities** → pick the real
   Developer Team (not personal Apple ID).
3. Bump the version in `ios/App/App.xcodeproj` (Build + Version
   numbers) — TestFlight requires a new build number every upload.
4. **Product → Archive**. Wait for the archive to finish.
5. In the Organizer window: **Distribute App → App Store Connect →
   Upload**.
6. Over at <https://appstoreconnect.apple.com>: create the app listing
   (name, category, description, screenshots for 6.7" + 6.5" iPhones
   plus iPad if you want iPad support), link the uploaded build,
   submit for review.
7. Review typically lands in 1–7 days. Most common rejection is
   guideline 4.2 ("minimum functionality") — our icon, splash,
   offline-capable localStorage and native-feel UI should clear it,
   but if rejected, respond by pointing at those specifically.

## Troubleshooting

- **"fetch failed" on first launch**: `NEXT_PUBLIC_API_BASE` wasn't set
  when you built, or the Render service is cold-starting. Curl the
  endpoint manually to confirm it's live, then re-run
  `npm run ios:sync`.
- **`app/api/` is missing after a failed static build**: the
  park-and-restore script registers SIGINT/SIGTERM handlers, but a
  hard kill (SIGKILL) won't trigger them. Recover by hand:
  `mv .api-parked app/api`.
- **Xcode can't find signing certificate**: Settings → Accounts → add
  your Apple ID → Download Manual Profiles.
- **Black screen in simulator**: the WebView couldn't load `out/` —
  usually means you ran `cap sync` before `build:static`. Run
  `npm run ios:sync` to do both in order.
