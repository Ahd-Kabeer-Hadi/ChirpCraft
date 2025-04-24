import fs from 'fs';
import path from 'path';
import { AIClient } from './aiClient';
import { twitterClient } from './twitterClient';
import { DBSchema, ContentPillar } from './types'; // Uses camelCase types
import { TweetV2PostTweetResult } from 'twitter-api-v2';

enum PostType { THREAD = 'thread', TWEET = 'tweet' }
const MAX_TWEET_LENGTH = 280;
const CHAR_LIMIT_BUFFER = 10;
const AI_CHAR_LIMIT = MAX_TWEET_LENGTH - CHAR_LIMIT_BUFFER;

// --- Configuration & Initialization ---
const ai = new AIClient();
const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.resolve(projectRoot, 'contentDB.json');
const statePath = path.resolve(projectRoot, 'state.json');
let db: DBSchema;
let state: Record<string, { threads: number; tweets: number }>;

try {
  // Reads the JSON with camelCase keys now
  db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
} catch (error) {
  console.error(`❌ Fatal Error: Could not read or parse content DB at ${dbPath}`, error);
  process.exit(1);
}

try {
  state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    : {};
} catch (error) {
  console.error(`⚠️ Error reading or parsing state file at ${statePath}. Starting with empty state.`, error);
  state = {};
}

const todayKey = new Date().toISOString().split('T')[0];

if (!state[todayKey]) {
  state[todayKey] = { threads: 0, tweets: 0 };
}
state[todayKey].threads = state[todayKey].threads || 0;
state[todayKey].tweets = state[todayKey].tweets || 0;


// --- Utility Functions ---
function pickRandom<T>(arr: T[]): T {
  if (!arr || arr.length === 0) {
    console.error("Attempted to pick random element from empty or undefined array.");
    throw new Error("Cannot pick random element from empty or undefined array.");
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

// Uses reverted constant name
function truncateText(text: string, maxLength = MAX_TWEET_LENGTH): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength - 3) + '...';
}

// Uses reverted constant name
async function safeGenerateText(prompt: string, maxLength = AI_CHAR_LIMIT): Promise<string | null> {
    try {
        const fullPrompt = `${prompt} \n\n(Important: Respond concisely. Ensure the entire response is under ${maxLength} characters.)`;
        console.log(`🧠 Generating AI text (max ${maxLength} chars)...`);
        const generatedText = await ai.generateText(fullPrompt);

        if (!generatedText || generatedText.trim().length === 0) {
             console.warn(`⚠️ AI returned empty text for prompt: "${prompt.substring(0, 100)}..."`);
             return null;
        }

        // Uses reverted constant name
        if (generatedText.length > maxLength) {
             console.warn(`⚠️ AI response exceeded ${maxLength} chars. Truncating.`);
             return truncateText(generatedText, maxLength); // Calls truncateText which uses MAX_TWEET_LENGTH implicitly if maxLength is AI_CHAR_LIMIT
        }
        console.log(`   AI Text generated: "${generatedText.substring(0, 60)}..."`);
        return generatedText;

    } catch (error) {
        console.error(`❌ Error generating AI text:`, error);
        return null;
    }
}

async function safePostTweet(text: string, options?: { reply?: { in_reply_to_tweet_id: string } }): Promise<TweetV2PostTweetResult | null> {
    // Uses reverted constant name via truncateText call
    const textToPost = truncateText(text);

    try {
        console.log(`🐦 Posting tweet (length ${textToPost.length}): "${textToPost.substring(0, 60)}..."`);
        const result = await twitterClient.tweet(textToPost, options);
        console.log(`✅ Tweet posted successfully: ID ${result.data.id}`);
        return result;
    } catch (error: any) {
        console.error(`❌ Error posting tweet: "${textToPost.substring(0,100)}..."`);
        if (error.code) {
             console.error(`   Twitter API Error Code: ${error.code}, Message: ${error.message || 'No message'}`);
        } else {
            console.error('   Error details:', error);
        }
        return null;
    }
}

// --- Core Posting Logic ---
async function postTweet(): Promise<boolean> {
  console.log('\n--- Attempting to Post Tweet ---');
  try {
    // Uses camelCase accessors for db object
    const promptSeed = pickRandom(db.contentStrategies.dailyPrompts.tweets);
    const fullPrompt = `You are ${db.founderProfile.name} (${db.founderProfile.title}), known for being ${db.founderProfile.voice}. `
        + `Write a short, engaging tweet based on this idea for an audience of ${db.audience.target}: "${promptSeed}"`;

    const text = await safeGenerateText(fullPrompt); // safeGenerateText uses AI_CHAR_LIMIT
    if (!text) return false;

    const postResult = await safePostTweet(text); // safePostTweet uses MAX_TWEET_LENGTH via truncateText
    return !!postResult;

  } catch (error) {
      console.error('❌ Unexpected error during postTweet:', error);
      return false;
  }
}

async function generateThreadParts(pillar: ContentPillar, seedPrompt: string): Promise<string[] | null> {
    try {
        // Uses camelCase accessors for db object
        const structure = pickRandom(db.contentStrategies.threadStructures);
        console.log(`🧵 Generating thread parts for structure "${structure.title}" on pillar "${pillar.name}"...`);
        const parts: string[] = [];

        for (const [index, section] of structure.format.entries()) {
            const partPrompt = `You are ${db.founderProfile.name} (${db.founderProfile.title}), known for being ${db.founderProfile.voice}. `
                + `You're writing part ${index + 1}/${structure.format.length} of a Twitter thread about '${pillar.name}', based on the core idea: '${seedPrompt}'. `
                + `This specific part should focus on: '${section}'. Address an audience of ${db.audience.target}. Keep it concise and engaging.`;

            const partText = await safeGenerateText(partPrompt); // safeGenerateText uses AI_CHAR_LIMIT

            if (!partText) {
                console.error(`❌ Failed to generate part ${index + 1} for section "${section}". Aborting thread generation.`);
                return null;
            }
            parts.push(partText);
        }
        console.log(`✅ Generated ${parts.length} thread parts.`);
        return parts;
    } catch (error) {
        console.error(`❌ Error generating thread parts:`, error);
        return null;
    }
}

async function postThread(): Promise<boolean> {
    console.log('\n--- Attempting to Post Thread ---');
    try {
        // Uses camelCase accessors for db object
        const pillar = pickRandom(db.contentPillars);
        const seedPrompt = pickRandom(db.contentStrategies.dailyPrompts.threads);

        const parts = await generateThreadParts(pillar, seedPrompt);
        if (!parts || parts.length === 0) {
            console.error("❌ Thread generation failed or produced no parts.");
            return false;
        }

        console.log(`🐦 Posting thread with ${parts.length} parts...`);
        let firstTweetResult = await safePostTweet(parts[0]); // Uses MAX_TWEET_LENGTH via truncateText
        if (!firstTweetResult) {
             console.error("❌ Failed to post the first tweet of the thread. Aborting.");
             return false;
        }
        let previousTweetId = firstTweetResult.data.id;

        for (let i = 1; i < parts.length; i++) {
            console.log(`   Posting part ${i + 1}/${parts.length}...`);
            const replyResult = await safePostTweet(parts[i], { reply: { in_reply_to_tweet_id: previousTweetId } }); // Uses MAX_TWEET_LENGTH via truncateText
            if (!replyResult) {
                console.error(`❌ Failed to post part ${i + 1} of the thread. Thread incomplete.`);
                return false;
            }
            previousTweetId = replyResult.data.id;
        }

        console.log("✅ Thread posted successfully.");
        return true;

    } catch (error) {
        console.error('❌ Unexpected error during postThread:', error);
        return false;
    }
}

// --- Main Task Runner ---
async function runTask() {
  console.log(`\n🚀 Starting content task for ${todayKey}...`);
  // Uses camelCase accessors for db object
  const { threadsPerDay = 5, tweetsPerDay = 5 } = db.contentGoals?.postingCadence || {};
  const counters = state[todayKey];

  console.log(`📊 Daily Quota: ${threadsPerDay} threads, ${tweetsPerDay} tweets.`);
  console.log(`📈 Current Count: ${counters.threads} threads, ${counters.tweets} tweets.`);

  let postedSuccessfully = false;
  let postTypeAttempted: PostType | null = null;

  if (counters.threads < threadsPerDay) {
    postTypeAttempted = PostType.THREAD;
    postedSuccessfully = await postThread();
    if (postedSuccessfully) {
      counters.threads++;
    }
  } else if (counters.tweets < tweetsPerDay) {
    postTypeAttempted = PostType.TWEET;
    postedSuccessfully = await postTweet();
    if (postedSuccessfully) {
      counters.tweets++;
    }
  } else {
    console.log("✅ Daily posting quota reached. No action needed.");
    return;
  }

  if (postedSuccessfully && postTypeAttempted) {
    console.log(`💾 Updating state: ${JSON.stringify(state[todayKey])}`);
    try {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        console.log(`✅ State successfully saved to ${statePath}`);
    } catch (error) {
        console.error(`❌ CRITICAL ERROR: Failed to write state file to ${statePath}`, error);
    }
  } else if (postTypeAttempted) {
       console.log(`📉 ${postTypeAttempted} posting was attempted but failed. State not updated.`);
  } else {
       console.log(`❓ No posting type was determined or attempted (check quota logic).`);
  }
   console.log(`🏁 Content task finished for ${todayKey}.`);
}

// --- Script Execution ---
(async () => {
    if (require.main === module) {
        await runTask();
    }
})().catch(error => {
    console.error("❌ Unhandled exception in main execution:", error);
    process.exit(1);
});