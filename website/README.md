# SuperPoE2 Website

The public-facing SuperPoE2 website is a static Vite site. It is intentionally
kept separate from the Electron renderer so the desktop application's build
and runtime entrypoints remain unchanged.

## Local preview

From the repository root:

```powershell
npm run dev:website
```

Open <http://127.0.0.1:4173> in a browser.

## Production build

```powershell
npm run build:website
```

The site is static and does not require an API, authentication, or a database.
The GitHub Pages workflow publishes the `website/` directory when changes are
pushed to the default branch, or when the workflow is run manually.
