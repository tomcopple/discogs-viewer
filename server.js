require('dotenv').config();
const express = require('express');
const Discogs = require('disconnect').Client;
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

function isCdTrackEntry(track) {
  const position = (track?.position || '').toString().trim();
  const title = (track?.title || '').toString().trim();
  const type = (track?.type_ || '').toString().trim();

  // Discogs CD entries are often encoded as CD1, CD1-1, or heading/title markers.
  const cdPattern = /\bCD\s*\d*\b/i;
  return cdPattern.test(position) || cdPattern.test(title) || cdPattern.test(type);
}

function filterCdTrackEntries(tracklist) {
  return (tracklist || []).filter((track) => !isCdTrackEntry(track));
}

// Last.fm API configuration
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_SECRET = process.env.LASTFM_SECRET;
let lastfmSessionKey = null;

// OpenAI API configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize SQLite database
const db = new sqlite3.Database('./data/collection.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS collection (
    id INTEGER PRIMARY KEY,
    title TEXT,
    artist TEXT,
    year INTEGER,
    thumb TEXT,
    cover_image TEXT,
    format TEXT,
    label TEXT,
    rating INTEGER,
    tracklist TEXT,
    last_synced DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Table for storing app settings like Last.fm session
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  
  // Add missing columns if they don't exist (migration)
  db.run(`ALTER TABLE collection ADD COLUMN rating INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) console.log('Rating column exists');
  });
  db.run(`ALTER TABLE collection ADD COLUMN tracklist TEXT DEFAULT '[]'`, (err) => {
    if (err && !err.message.includes('duplicate column')) console.log('Tracklist column exists');
  });
  
  // Load Last.fm session key from database
  db.get('SELECT value FROM settings WHERE key = ?', ['lastfm_session_key'], (err, row) => {
    if (!err && row) {
      lastfmSessionKey = row.value;
      console.log('Loaded Last.fm session from database');
    }
  });
});

// Initialize Discogs client with Personal Access Token
const dis = new Discogs({
  userToken: process.env.DISCOGS_TOKEN
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/api/collection', async (req, res) => {
  try {
    // First, check if we have cached data
    db.all('SELECT * FROM collection ORDER BY artist, title', (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // If we have data, return it
      if (rows.length > 0) {
        return res.json({ 
          collection: rows,
          cached: true,
          count: rows.length 
        });
      }
      
      // Otherwise, tell user to sync first
      res.json({ 
        collection: [],
        cached: false,
        message: 'No data cached. Please run /api/sync first'
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const username = process.env.DISCOGS_USERNAME;
    
    if (!username) {
      return res.status(400).json({ 
        error: 'DISCOGS_USERNAME not set in .env file' 
      });
    }

    console.log(`Fetching collection for user: ${username}`);
    
    // Get user collection from Discogs (includes ratings)
    dis.user().collection().getReleases(username, 0, { per_page: 500 }, (err, data) => {
      if (err) {
        console.error('Discogs API error:', err);
        return res.status(500).json({ error: err.message });
      }

      // Every row touched by this sync gets the same timestamp, so anything left
      // with an older one has been removed from the Discogs collection.
      const syncTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Upsert so cached tracklists survive a re-sync
        const stmt = db.prepare(`
          INSERT INTO collection (id, title, artist, year, thumb, cover_image, format, label, rating, tracklist, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            year = excluded.year,
            thumb = excluded.thumb,
            cover_image = excluded.cover_image,
            format = excluded.format,
            label = excluded.label,
            rating = excluded.rating,
            last_synced = excluded.last_synced
        `);

        let insertCount = 0;
        const seenIds = new Set();
        data.releases.forEach((release) => {
          // Duplicate copies of the same release are logging mistakes; keep the first
          if (seenIds.has(release.id)) return;
          seenIds.add(release.id);

          const artists = release.basic_information.artists
            .map(a => a.name)
            .join(', ');
          const formats = release.basic_information.formats
            .map(f => f.name)
            .join(', ');
          const labels = release.basic_information.labels
            .map(l => l.name)
            .join(', ');

          stmt.run(
            release.id,
            release.basic_information.title,
            artists,
            release.basic_information.year,
            release.basic_information.thumb,
            release.basic_information.cover_image,
            formats,
            labels,
            release.rating || 0,  // This is YOUR rating from your collection
            syncTime,
            (err) => {
              if (err) console.error(`Error saving release ${release.id}:`, err);
              else insertCount++;
            }
          );
        });

        stmt.finalize();
        db.run('DELETE FROM collection WHERE last_synced != ?', [syncTime]);
        db.run('COMMIT', (err) => {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }
          console.log(`Synced ${insertCount} releases`);
          res.json({
            success: true,
            synced: insertCount,
            total: data.pagination.items
          });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/release/:id', (req, res) => {
  const id = req.params.id;
  
  // First check if we have detailed data in cache
  db.get('SELECT * FROM collection WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Release not found' });
    }
    
    // If we have tracklist data, return from cache
    if (row.tracklist && row.tracklist !== '[]') {
      row.tracklist = JSON.parse(row.tracklist);
      return res.json(row);
    }
    
    // Otherwise, fetch fresh data from Discogs API
    console.log(`Fetching detailed info for release ${id}`);
    dis.database().getRelease(id, (err, data) => {
      if (err) {
        console.error('Error fetching release:', err);
        // Return cached data anyway
        row.tracklist = [];
        return res.json(row);
      }
      
      console.log(`Got release data, tracklist length: ${data.tracklist ? data.tracklist.length : 0}`);
      
      // Update database with full details, excluding CD-only track entries.
      const tracklist = filterCdTrackEntries(data.tracklist || []);
      db.run(
        'UPDATE collection SET tracklist = ? WHERE id = ?',
        [JSON.stringify(tracklist), id],
        (updateErr) => {
          if (updateErr) {
            console.error('Error updating tracklist:', updateErr);
          }
          
          console.log(`Updated database with ${tracklist.length} tracks`);
          row.tracklist = tracklist;
          res.json(row);
        }
      );
    });
  });
});

app.post('/api/release/:id/rate', express.json(), async (req, res) => {
  const id = req.params.id;
  const { rating } = req.body;
  
  if (rating < 0 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 0 and 5' });
  }

  try {
    const username = process.env.DISCOGS_USERNAME;
    
    // Get the instance_id from collection
    dis.user().collection().getReleases(username, 0, { per_page: 500 }, (err, data) => {
      if (err) {
        console.error('Error fetching collection:', err);
        return res.status(500).json({ error: err.message });
      }

      const release = data.releases.find(r => r.id == id);
      if (!release) {
        return res.status(404).json({ error: 'Release not found in collection' });
      }

      const folderId = release.folder_id || 1; // Default folder
      const instanceId = release.instance_id;

      // Update rating on Discogs
      dis.user().collection().editRelease(
        username,
        folderId,
        id,
        instanceId,
        { rating: rating },
        (err, data) => {
          if (err) {
            console.error('Error updating Discogs rating:', err);
            return res.status(500).json({ error: err.message });
          }

          // Update local database
          db.run(
            'UPDATE collection SET rating = ? WHERE id = ?',
            [rating, id],
            (dbErr) => {
              if (dbErr) {
                console.error('Error updating local rating:', dbErr);
                return res.status(500).json({ error: dbErr.message });
              }

              console.log(`Updated rating for release ${id} to ${rating}`);
              res.json({ success: true, rating: rating });
            }
          );
        }
      );
    });
  } catch (error) {
    console.error('Rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Last.fm authentication
app.get('/api/lastfm/auth-url', (req, res) => {
  const authUrl = `http://www.last.fm/api/auth/?api_key=${LASTFM_API_KEY}&cb=${req.protocol}://${req.get('host')}/api/lastfm/callback`;
  res.json({ url: authUrl });
});

app.get('/api/lastfm/callback', async (req, res) => {
  const token = req.query.token;
  
  if (!token) {
    return res.redirect('/?error=no_token');
  }

  try {
    // Get session key from Last.fm
    const params = {
      method: 'auth.getSession',
      api_key: LASTFM_API_KEY,
      token: token
    };
    
    const signature = generateLastfmSignature(params);
    const url = `http://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${LASTFM_API_KEY}&token=${token}&api_sig=${signature}&format=json`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.session) {
      lastfmSessionKey = data.session.key;
      
      // Save session key to database
      db.run(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ['lastfm_session_key', lastfmSessionKey],
        (err) => {
          if (err) {
            console.error('Error saving Last.fm session:', err);
          } else {
            console.log('Last.fm session saved to database');
          }
        }
      );
      
      res.redirect('/?lastfm=connected');
    } else {
      res.redirect('/?error=auth_failed');
    }
  } catch (error) {
    console.error('Last.fm auth error:', error);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/api/lastfm/status', (req, res) => {
  res.json({ connected: !!lastfmSessionKey });
});

app.post('/api/ai/recommend', express.json(), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  const { query } = req.body;
  
  if (!query || query.trim().length === 0) {
    return res.status(400).json({ error: 'Please provide a mood or music preference' });
  }

  try {
    // Get the entire collection from database
    db.all('SELECT * FROM collection ORDER BY artist, title', async (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (rows.length === 0) {
        return res.status(400).json({ error: 'No albums in collection' });
      }

      // Format collection data for the AI
      const collectionText = rows.map(r => 
        `${r.artist} - ${r.title} (${r.year}) [Rating: ${r.rating}/5] [Format: ${r.format}]`
      ).join('\n');

      const systemPrompt = `You are a music recommendation expert. The user has a vinyl collection and you need to recommend exactly 3 albums from their collection based on their mood or preference description.

Return your response as a JSON array with exactly 3 recommendations. Each recommendation should have:
- artist: the artist name
- title: the album title
- reason: a brief explanation (1-2 sentences) why this album matches their request

Example format:
[
  {"artist": "Artist Name", "title": "Album Title", "reason": "This album is perfect because..."},
  {"artist": "Another Artist", "title": "Another Album", "reason": "This one captures..."},
  {"artist": "Third Artist", "title": "Third Album", "reason": "You'll enjoy..."}
]

Recommend from this collection only:
${collectionText}`;

      try {
        const message = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
          temperature: 0.7,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `My mood/preference: ${query}`
            }
          ]
        });

        const responseText = message.choices[0].message.content;
        
        // Parse the JSON response
        const jsonMatch = responseText.match(/\[\s*{[\s\S]*}\s*\]/);
        if (!jsonMatch) {
          console.error('Could not parse AI response:', responseText);
          return res.status(500).json({ error: 'Failed to parse AI recommendations' });
        }

        const recommendations = JSON.parse(jsonMatch[0]);
        
        // Enhance recommendations with full album data from collection
        // No artist-only fallback: that would show a different album alongside the AI's reason
        const enhancedRecommendations = recommendations.map(rec => {
          const album = rec.artist && rec.title && rows.find(r =>
            r.artist.toLowerCase().includes(rec.artist.toLowerCase()) &&
            r.title.toLowerCase().includes(rec.title.toLowerCase())
          );
          
          return {
            ...rec,
            id: album?.id,
            year: album?.year,
            rating: album?.rating,
            thumb: album?.thumb,
            format: album?.format,
            found: !!album  // Track whether we found this album
          };
        }).filter(rec => rec.found);  // Only return recommendations that actually exist in collection
        
        // If too many recommendations were hallucinations, ask AI to try again
        if (enhancedRecommendations.length < 2) {
          return res.status(500).json({ error: 'AI could not find enough valid recommendations in your collection. Try a different search term or reload your collection.' });
        }

        res.json({
          success: true,
          recommendations: enhancedRecommendations,
          query: query
        });
      } catch (aiError) {
        console.error('OpenAI API error:', aiError);
        
        // Provide detailed error messages based on error type
        let errorMessage = 'AI recommendation failed: ' + aiError.message;
        
        if (aiError.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        } else if (aiError.status === 401) {
          errorMessage = 'Invalid OpenAI API key. Please check your configuration.';
        } else if (aiError.status === 403) {
          errorMessage = 'Access forbidden. Check your OpenAI account permissions.';
        } else if (aiError.status === 429 && aiError.error?.error?.type === 'insufficient_quota') {
          errorMessage = 'OpenAI quota exceeded. You may have hit your usage limit or budget.';
        } else if (aiError.message?.includes('timeout')) {
          errorMessage = 'Request timed out. OpenAI service may be slow. Try again in a moment.';
        } else if (aiError.message?.includes('ECONNREFUSED')) {
          errorMessage = 'Cannot reach OpenAI service. Check your internet connection.';
        }
        
        res.status(500).json({ error: errorMessage });
      }
    });
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/lastfm/scrobble', express.json(), async (req, res) => {
  if (!lastfmSessionKey) {
    return res.status(401).json({ error: 'Not authenticated with Last.fm' });
  }

  const { artist, album, tracks } = req.body;
  const filteredTracks = filterCdTrackEntries(tracks || []);
  
  if (filteredTracks.length === 0) {
    return res.status(400).json({ error: 'No tracks to scrobble' });
  }

  try {
    // Convert duration string (MM:SS) to seconds
    function durationToSeconds(duration) {
      if (!duration) return 180; // Default 3 minutes
      const parts = duration.split(':');
      if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
      }
      return 180;
    }
    
    // Calculate timestamps based on actual track durations
    const now = Math.floor(Date.now() / 1000);
    let currentTimestamp = now;
    const scrobbles = {};
    
    // Work backwards from now, using actual track durations
    for (let i = filteredTracks.length - 1; i >= 0 && (filteredTracks.length - i - 1) < 50; i--) {
      const track = filteredTracks[i];
      const duration = durationToSeconds(track.duration);
      currentTimestamp -= duration;
      
      const index = filteredTracks.length - i - 1;
      scrobbles[`artist[${index}]`] = artist;
      scrobbles[`track[${index}]`] = track.title;
      scrobbles[`album[${index}]`] = album;
      scrobbles[`timestamp[${index}]`] = currentTimestamp;
    }
    
    scrobbles.method = 'track.scrobble';
    scrobbles.api_key = LASTFM_API_KEY;
    scrobbles.sk = lastfmSessionKey;
    
    const signature = generateLastfmSignature(scrobbles);
    
    // Build form data
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(scrobbles)) {
      formData.append(key, value);
    }
    formData.append('api_sig', signature);
    formData.append('format', 'json');
    
    const response = await fetch('http://ws.audioscrobbler.com/2.0/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData
    });
    
    const data = await response.json();
    
    if (data.scrobbles) {
      res.json({ 
        success: true, 
        scrobbled: data.scrobbles['@attr'].accepted 
      });
    } else {
      res.status(500).json({ error: data.message || 'Scrobble failed' });
    }
  } catch (error) {
    console.error('Scrobble error:', error);
    res.status(500).json({ error: error.message });
  }
});

function generateLastfmSignature(params) {
  const sortedKeys = Object.keys(params).sort();
  let sig = '';
  
  for (const key of sortedKeys) {
    if (key !== 'format' && key !== 'callback') {
      sig += key + params[key];
    }
  }
  
  sig += LASTFM_SECRET;
  return crypto.createHash('md5').update(sig, 'utf8').digest('hex');
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});