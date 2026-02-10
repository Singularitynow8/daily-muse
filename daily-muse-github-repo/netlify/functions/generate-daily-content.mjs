import { getStore } from "@netlify/blobs";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

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

Pick diverse, interesting, educational selections across cultures and time periods. Mix masterpieces with hidden gems. Ensure variety - never repeat the same artists across different days.

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

// Scheduled function: runs daily at 5 AM UTC
export default async function handler(req) {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return new Response('Missing API key', { status: 500 });
  }

  const today = new Date().toISOString().split('T')[0];
  console.log(`Generating content for ${today}...`);

  try {
    const store = getStore('daily-content');
    
    // Check if already generated
    try {
      const existing = await store.get(today);
      if (existing) {
        console.log(`Content for ${today} already exists, skipping.`);
        return new Response('Already generated', { status: 200 });
      }
    } catch(e) { /* key doesn't exist, proceed */ }

    const [content, astronomy] = await Promise.all([
      generateContent(today),
      fetchNASAApod(today)
    ]);

    if (astronomy) content.astronomy = astronomy;
    content.date = today;

    await store.set(today, JSON.stringify(content));
    console.log(`Successfully generated and stored content for ${today}`);

    return new Response(`Generated content for ${today}`, { status: 200 });
  } catch (err) {
    console.error(`Failed to generate for ${today}:`, err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
}

export const config = {
  schedule: "0 5 * * *"
};
