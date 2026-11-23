# Node-Taiko

This edition removes the original Python/Flask backend, MongoDB, and Redis dependencies. The backend is powered by Node.js and Express, the frontend uses Vue 3 and Vite, data is stored in `data/db.json`, and multiplayer uses the `/p2` WebSocket protocol expected by the original client.

## Requirements

- Node.js 18 or higher (Node.js 20 LTS recommended)
- npm

No Python, MongoDB, or Redis installation is required.

## Installation and Development

From the project root directory:

```bash
npm install
npm run dev
```

- Vite frontend: http://localhost:5173
- Backend/API: http://localhost:34801
- Multiplayer WebSocket: `ws://localhost:34801/p2`

The Vite development server proxies `/api` and `/p2` requests to the Node.js backend.

## Configuration

Before starting the application, make sure that a `config.json` file exists in the project root directory.

Create the file if it does not exist, using the following structure:

```json
{
  "ASSETS_BASEURL": "/assets/",
  "SONGS_BASEURL": "/songs/",
  "EMAIL": null,
  "ACCOUNTS": true,
  "CUSTOM_JS": "",
  "PLUGINS": [],
  "PREVIEW_TYPE": "mp3",
  "SECRET_KEY": "CHANGE-THIS-SECRET-KEY",
  "URL": "https://github.com/bui/taiko-web/",
  "GOOGLE_CREDENTIALS": {
    "gdrive_enabled": false,
    "api_key": "",
    "oauth_client_id": "",
    "project_number": "",
    "min_level": null
  },
  "UPLOAD_PANEL_PASSWORD": "CHANGE-THIS-PASSWORD"
}
```

### Configuration Options

- `ASSETS_BASEURL`: Base URL used to load static assets.
- `SONGS_BASEURL`: Base URL used to load song files.
- `EMAIL`: Email address used by the application, or `null` if not configured.
- `ACCOUNTS`: Enables or disables user accounts.
- `CUSTOM_JS`: Custom JavaScript code or configuration loaded by the client.
- `PLUGINS`: List of plugins enabled by the application.
- `PREVIEW_TYPE`: Audio format used for song previews (e.g. `mp3`).
- `SECRET_KEY`: Secret key used for session security and cryptographic operations.
- `URL`: Project URL or original project reference.
- `GOOGLE_CREDENTIALS`: Google Drive integration settings:
  - `gdrive_enabled`: Enables or disables Google Drive integration.
  - `api_key`: Google API key.
  - `oauth_client_id`: Google OAuth client ID.
  - `project_number`: Google Cloud project number.
  - `min_level`: Minimum permission level required to use Google Drive integration.
- `UPLOAD_PANEL_PASSWORD`: Password required to access the upload panel.

### Important Security Notes

- Replace `SECRET_KEY` with a long, randomly generated secret before deploying the application.
- Change `UPLOAD_PANEL_PASSWORD` to a strong, unique password.
- Keep `config.json` private and never expose it through a public static directory.
- Do not commit production credentials or passwords to a public repository.
- Only configure Google credentials if you intend to use Google Drive integration.
- Make sure the JSON syntax is valid before starting the server.

The application requires a properly configured `config.json` file to run correctly.

## Production

Build the frontend and start the backend:

```bash
npm run build
npm start
```

The Node.js server will then serve the compiled frontend from `dist/`.

## JSON Database

All collections are stored in `data/db.json`:

- `users`
- `songs`
- `scores`
- `categories`
- `makers`
- `song_skins`
- `seq`

Database writes are serialized, and the file is replaced atomically to reduce the risk of data corruption.

### Importing an Existing MongoDB JSON Export

Export your MongoDB collections using `mongoexport` in JSON format (JSON arrays or JSON Lines).

Place the exported files in a directory using the following names:

- `users.json`
- `songs.json`
- `scores.json`
- `categories.json`
- `makers.json`
- `song_skins.json`
- `seq.json` (optional)

Then run:

```bash
npm run import:mongo-json -- ./mongo-export
```

The import script preserves existing collections when no corresponding export file is provided.

It supports common Extended JSON values (`$binary`, `$oid`, `$date`, `$numberInt`, etc.). BSON binary passwords are converted into bcrypt strings.

**Back up `data/db.json` before importing anything.**

Redis sessions are not migrated, so users will need to log in again.

## Adding Songs

Song metadata is stored in `data/db.json` (the `songs` collection).

Audio files and charts must be placed in:

```text
public/songs/<id>/
```

Examples:

```text
main.tja
main.mp3
easy.osu
preview.mp3
```

The original game engine files, images, sounds, and fonts are preserved in `public/src` and `public/assets`.

Add the corresponding song metadata to the `songs` collection in `data/db.json`.

## Available API Routes

- `GET /api/csrftoken`
- `GET /api/config`
- `GET /api/categories`
- `GET /api/songs`
- `GET /api/preview?id=...`
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `POST /api/account/display_name`
- `POST /api/account/don`
- `POST /api/account/password`
- `POST /api/account/remove`
- `GET /api/scores/get`
- `POST /api/scores/save`

Additional JSON administration routes are available under `/api/admin`.

## Migration Notes

The original game's JavaScript engine (located in `public/src`) is preserved and loaded by the Vue component.

Vue manages application mounting, while the legacy code retains its DOM elements and rendering engine to preserve the original gameplay experience.

The original Jinja administration pages have been replaced with a simple Vue-based administration panel and Node.js API routes.

The P2 multiplayer server has been reimplemented in Node.js using `ws`. It preserves the `/p2` endpoint and the JSON message format expected by the legacy client:

```json
{
  "type": "...",
  "value": {}
}
```

Multiplayer functionality should be tested with at least two browsers before deploying the application to production.

The project does not include the original downloadable song database. Add your own chart/audio directories to `public/songs` and their corresponding metadata to `data/db.json`.