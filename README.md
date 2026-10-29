# 🎵 Discogs Viewer

A personal vinyl collection viewer that syncs with your Discogs account, displays albums in a responsive grid, and uses AI to recommend albums based on your mood or music preference.

## Features

- **Collection Sync**: Fetch your entire Discogs vinyl collection with ratings
- **Grid Display**: Browse your collection with responsive image grid
- **Album Details**: View tracklists, metadata, and ratings
- **AI Recommendations**: Ask the AI to recommend albums based on mood/preference
- **Last.fm Integration**: Scrobble albums to Last.fm
- **Rating Management**: Rate albums and sync ratings back to Discogs
- **Search**: Filter collection by artist or title

## Tech Stack

- **Backend**: Node.js + Express + SQLite3
- **Frontend**: Vanilla JS + HTML/CSS
- **External APIs**: Discogs API, OpenAI API, Last.fm API
- **Deployment**: Docker, as a service in the NAS compose stack

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 16+
- npm

### Setup

1. **Clone and install dependencies**
   ```bash
   cd discogs-viewer
   npm install
   ```

2. **Configure environment variables**
   Create/update `.env` file:
   ```
   DISCOGS_USERNAME=your_username
   DISCOGS_TOKEN=your_personal_access_token
   LASTFM_API_KEY=your_lastfm_key
   LASTFM_SECRET=your_lastfm_secret
   OPENAI_API_KEY=your_openai_key
   PORT=3000
   ```

3. **Run development server**
   ```bash
   npm run dev
   ```
   Server runs at `http://localhost:3000`

4. **Load your collection**
   - Click "Sync Collection" to fetch from Discogs (one-time or periodic refresh)
   - Click "Load Collection" to view cached albums

---

## Deployment to NAS (Docker)

The app runs as the `discogs-viewer` service in the NAS's main compose stack at
`/volume2/docker/compose/docker-compose.yml`, alongside the other containers. The
service builds from source in `/volume2/docker/discogs-viewer`, and reads its API
keys from the `.env` file in that folder at runtime (they are not baked into the image).

### Deploy code changes (run from your Mac)

```bash
rsync -av --exclude 'node_modules' --exclude '/data/' --exclude '.env' --exclude '.DS_Store' \
  /Users/tomcopple/R/discogs-viewer/ nas:/volume2/docker/discogs-viewer/
ssh nas "cd /volume2/docker/compose && docker compose up -d --build discogs-viewer"
```
- Use the full source path so it works from any folder, and keep the trailing `/`
- `/data/` is excluded so your local `collection.db` doesn't overwrite the one on the NAS
- `.env` is excluded so the NAS keeps its own copy
- `--build` rebuilds the image so it picks up code changes; naming the service leaves the rest of the stack alone
- If rsync reports `0 files` and exits with status 23, it couldn't find the source folder — check the path

Then open `http://192.168.1.99:3000`.

### `.env` on the NAS

`/volume2/docker/discogs-viewer/.env` must exist with:
```bash
DISCOGS_USERNAME=your_username
DISCOGS_TOKEN=your_personal_access_token
LASTFM_API_KEY=your_lastfm_key
LASTFM_SECRET=your_lastfm_secret
OPENAI_API_KEY=your_openai_key
# Optional: defaults to gpt-5.4-mini
# OPENAI_MODEL=gpt-5.4-mini
```
After changing it, recreate the container (no rebuild needed):
`ssh nas "cd /volume2/docker/compose && docker compose up -d discogs-viewer"`

### Managing the Container

Run these from `/volume2/docker/compose` on the NAS:

```bash
docker compose logs -f discogs-viewer   # view logs
docker compose stop discogs-viewer      # stop the app
docker compose ps discogs-viewer        # check status
```

---

## Getting API Credentials

### Discogs API
1. Go to https://www.discogs.com/settings/developers
2. Create a new app (for personal use)
3. Generate a Personal Access Token
4. Add to `.env` as `DISCOGS_TOKEN`

### OpenAI API
1. Go to https://platform.openai.com/api-keys
2. Create new API key
3. Add to `.env` as `OPENAI_API_KEY`
4. Ensure you have billing enabled (gpt-5.4-mini is the default and cheap; override with `OPENAI_MODEL` in `.env`)

### Last.fm API
1. Go to https://www.last.fm/api/account/create
2. Create a new API application
3. Get API Key and Secret
4. Add to `.env` as `LASTFM_API_KEY` and `LASTFM_SECRET`

---

## Usage

### Sync Collection
1. Click "Sync Collection" (first time setup)
2. Data is cached in SQLite database (./data/collection.db)
3. Repeat periodically to update ratings and new additions

### AI Recommendations
1. Load your collection first
2. Click "🤖 AI Recommend" button
3. Describe your mood: *"I want something sad and introspective"*
4. AI returns 3 album recommendations from your collection
5. Click a recommendation to view full details

### Scrobble to Last.fm
1. Click "Connect Last.fm" to authenticate
2. Open an album (click its cover)
3. Click "🎵 Scrobble to Last.fm" to log tracks

### Rate Albums
1. Open an album (click its cover)
2. Click stars to rate (0-5)
3. Ratings sync back to your Discogs account

---

## Troubleshooting

### "OpenAI quota exceeded"
- Check your OpenAI billing in account settings
- Set usage limits if needed to avoid surprises
- Set `OPENAI_MODEL` to a cheaper model (e.g. `gpt-5.4-nano`) for cost efficiency

### "No albums found" after sync
- Verify `DISCOGS_USERNAME` and `DISCOGS_TOKEN` are correct
- Check Discogs has items in your collection folder
- Check server logs: `docker compose logs discogs-viewer` (from `/volume2/docker/compose`)

### Database locked / sync fails
- Stop container: `docker compose stop discogs-viewer` (from `/volume2/docker/compose`)
- Delete old database: `rm /volume2/docker/discogs-viewer/data/collection.db` (this also forgets the Last.fm login)
- Restart: `docker compose up -d discogs-viewer`

### App not accessible on NAS
- Check firewall allows port 3000
- Verify container is running: `docker compose ps discogs-viewer`
- Check logs: `docker compose logs discogs-viewer`

---

## Data

- **Database**: `./data/collection.db` (SQLite)
- **Persistent**: Data survives container restarts
- **Backup**: Copy `data/collection.db` to backup your collection cache

---

## Notes

- ⚠️ Keep `.env` file private (contains API keys)
- 🔄 Collection syncs are one-way (local cache)
- 🎯 AI uses actual collection data (no external lookups)
- 💾 Database is cached locally for fast browsing
