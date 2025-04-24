import { TwitterApi } from 'twitter-api-v2';
import { config } from 'dotenv';

config(); // Load .env variables

// Explicitly check for required environment variables
const { TW_APP_KEY, TW_APP_SECRET, TW_ACCESS_TOKEN, TW_ACCESS_SECRET } = process.env;

if (!TW_APP_KEY) {
  throw new Error("Missing required environment variable: TW_APP_KEY");
}
if (!TW_APP_SECRET) {
  throw new Error("Missing required environment variable: TW_APP_SECRET");
}
if (!TW_ACCESS_TOKEN) {
  throw new Error("Missing required environment variable: TW_ACCESS_TOKEN");
}
if (!TW_ACCESS_SECRET) {
  throw new Error("Missing required environment variable: TW_ACCESS_SECRET");
}

// Initialize client with v2 API access and ensure it has read-write capabilities activated
// Use .v2 for API v2 methods like tweet()
export const twitterClient = new TwitterApi({
  appKey: TW_APP_KEY,
  appSecret: TW_APP_SECRET,
  accessToken: TW_ACCESS_TOKEN,
  accessSecret: TW_ACCESS_SECRET,
}).v2; // Use .v2 directly for v2 methods

console.log("🐦 Twitter V2 client initialized.");

// If you needed bearer token for v2 read-only endpoints (like search), you might use:
// const readOnlyClient = new TwitterApi(process.env.TW_BEARER_TOKEN!).v2.readOnly;

// If you needed v1.1 methods (like for media upload):
// const v1Client = new TwitterApi({...}).v1;