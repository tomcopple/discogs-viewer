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
- **Deployment**: Docker + docker-compose

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

### Prerequisites
- Docker installed on NAS
- docker-compose installed on NAS
- 1GB+ free storage for database

### Steps

1. **Prepare NAS directory** (create it first and verify permissions)
   ```bash
   ssh username@nas-ip "mkdir -p /volume1/docker/discogs-viewer"
   ```

2. **Copy project to NAS** (using rsync to exclude node_modules)
   ```bash
   rsync -av --exclude 'node_modules' discogs-viewer/ nas:/volume1/docker/discogs-viewer/
   ```
   
   Or if rsync isn't working, use scp then delete node_modules on NAS:
   ```bash
   scp -r discogs-viewer/ username@nas-ip:/volume1/docker/
   ssh username@nas-ip "rm -rf /volume1/docker/discogs-viewer/node_modules"
   ```

3. **SSH into NAS**
   ```bash
   ssh username@nas-ip
   cd /volume1/docker/discogs-viewer
   ```

3. **Create/verify `.env` file** with your credentials:
   ```bash
   cat > .env << 'EOF'
   DISCOGS_USERNAME=your_username
   DISCOGS_TOKEN=your_personal_access_token
   LASTFM_API_KEY=your_lastfm_key
   LASTFM_SECRET=your_lastfm_secret
   OPENAI_API_KEY=your_openai_key
   PORT=3000
   EOF
   ```

4. **Start the container**
   ```bash
   docker-compose up -d
   ```
   - `-d` runs in background
   - Container will restart automatically on reboot

5. **Access the app**
   - Open browser: `http://nas-ip:3000`

### Managing the Container

**View logs**
```bash
docker-compose logs -f
```

**Stop the app**
```bash
docker-compose down
```

**Rebuild after code changes**
```bash
docker-compose up -d --build
```

**Check container status**
```bash
docker-compose ps
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
4. Ensure you have billing enabled (GPT-3.5 Turbo is cheap)

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
- Consider using GPT-3.5 Turbo for cost efficiency

### "No albums found" after sync
- Verify `DISCOGS_USERNAME` and `DISCOGS_TOKEN` are correct
- Check Discogs has items in your collection folder
- Check server logs: `docker-compose logs`

### Database locked / sync fails
- Stop container: `docker-compose down`
- Delete old database: `rm data/collection.db`
- Restart: `docker-compose up -d`

### App not accessible on NAS
- Check firewall allows port 3000
- Verify container is running: `docker-compose ps`
- Check logs: `docker-compose logs`

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
