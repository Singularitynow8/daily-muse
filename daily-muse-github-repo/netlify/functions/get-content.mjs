import { getStore } from "@netlify/blobs";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=86400'
};

async function fetchNASAApod(date) {
  try {
    const res = await fetch(`https://api.nasa.gov/planetary/apod?api_key=${NASA_API_KEY}&date=${date}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.media_type !== 'image') return null;
    return {
      title: data.title,
      description: data.explanation ? data.explanation.substring(0, 300) + '...' : '',
      image: data.url,
      credit: data.copyright || 'NASA APOD'
    };
  } catch(e) { return null; }
}

async function generateContent(date) {
  const prompt = `Generate Daily Muse cultural content for ${date}. Return ONLY valid JSON, no markdown fences.

Pick diverse, interesting, educational selections across cultures and time periods. Mix masterpieces with hidden gems.

{
  "date": "${date}",
  "music": { "composer": "Full name", "piece": "Full name with opus", "year": "Year", "spotifyQuery": "search query", "wiki": "Wikipedia URL for composer" },
  "painting": { "title": "Title", "artist": "Artist", "year": "Year", "description": "One sentence", "url": "Wikipedia URL for painting", "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/... 300px URL", "wiki": "Wikipedia URL for artist" },
  "poem": { "title": "Title", "author": "Poet", "text": "First stanza 4-6 lines", "url": "poetryfoundation.org or similar", "wiki": "Wikipedia URL for poet" },
  "sculpture": { "title": "Title", "artist": "Sculptor", "year": "Year", "description": "One sentence", "url": "Wikipedia URL", "image": "wikimedia 300px URL", "wiki": "Wikipedia URL for sculptor" },
  "photography": { "title": "Title", "photographer": "Name", "year": "Year", "description": "One sentence", "url": "Wikipedia URL", "image": "wikimedia 300px URL", "wiki": "Wikipedia URL for photographer" },
  "architecture": { "name": "Building", "architect": "Architect", "year": "Year completed", "location": "City, Country", "description": "One sentence", "url": "Wikipedia URL", "image": "wikimedia 300px URL", "wiki": "Wikipedia URL for architect" },
  "quote": { "text": "Inspiring quote about creativity, art, learning, striving, or living life fully", "author": "Attribution" }
}

Use REAL existing Wikimedia Commons image URLs. Quote MUST be about creativity, arts, learning, or living fully.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err}`);
  }
  const data = await res.json();
  const jsonMatch = data.content[0].text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  return JSON.parse(jsonMatch[0]);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Invalid date. Use YYYY-MM-DD' }), {
      status: 400, headers: HEADERS
    });
  }

  const today = new Date().toISOString().split('T')[0];
  if (date > today) {
    return new Response(JSON.stringify({ error: 'Future dates not available' }), {
      status: 404, headers: HEADERS
    });
  }

  // 1. Try Netlify Blobs (pre-generated content = instant)
  try {
    const store = getStore('daily-content');
    const cached = await store.get(date);
    if (cached) {
      console.log(`Serving cached content for ${date}`);
      return new Response(cached, { headers: HEADERS });
    }
  } catch(e) {
    console.log(`Blobs miss for ${date}: ${e.message}`);
  }

  // 2. Fall back to live generation
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500, headers: HEADERS
    });
  }

  try {
    console.log(`Generating live content for ${date}...`);
    const [content, astronomy] = await Promise.all([
      generateContent(date),
      fetchNASAApod(date)
    ]);

    if (astronomy) content.astronomy = astronomy;
    content.date = date;

    // Store in Blobs for next time
    try {
      const store = getStore('daily-content');
      await store.set(date, JSON.stringify(content));
      console.log(`Cached content for ${date} in Blobs`);
    } catch(e) {
      console.log(`Failed to cache: ${e.message}`);
    }

    return new Response(JSON.stringify(content), { headers: HEADERS });
  } catch (err) {
    console.error(`Failed for ${date}:`, err);
    return new Response(JSON.stringify({ error: 'Failed to generate content', details: err.message }), {
      status: 500, headers: HEADERS
    });
  }
}
