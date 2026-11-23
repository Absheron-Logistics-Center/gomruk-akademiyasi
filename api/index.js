// Vercel runs this file for every /api/... request (see vercel.json).
// Lessons and test banks are kept in Upstash Redis, files in Vercel Blob
// (connect both in Vercel → Storage; the keys are added automatically).
import app from '../server/app.js';

export default function handler(req, res) {
  return app(req, res);
}
