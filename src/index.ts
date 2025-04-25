// src/index.ts
import fs from "fs";
import path from "path";
import { AIClient } from "./aiClient";
import { twitterClient } from "./twitterClient";
import { DBSchema, ContentPillar, ThreadStructure } from "./types";
import { TweetV2PostTweetResult } from "twitter-api-v2";

// --- Constants ---
enum PostType {
  THREAD = "thread",
  TWEET = "tweet",
}
const MAX_TWEET_LENGTH = 280;
const CHAR_LIMIT_BUFFER = 10;
const AI_CHAR_LIMIT = MAX_TWEET_LENGTH - CHAR_LIMIT_BUFFER;

// Posting Strategy Constants
const MAX_TOTAL_POSTS_PER_DAY = 10;
const MAX_TWEETS_PER_DAY = 5;
const MAX_THREADS_PER_DAY = 5;
const MIN_THREAD_PARTS = 3;
const MAX_THREAD_PARTS = 8;
// SHORT delay BETWEEN parts of a single thread
const MIN_THREAD_PART_DELAY_MS = 5000; // 5 seconds
const MAX_THREAD_PART_DELAY_MS = 15000; // 15 seconds

// --- Configuration & Initialization ---
console.log("🚀 Initializing ChirpCraft...");
const ai = new AIClient();

const projectRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(projectRoot, "contentDB.json");
const statePath = path.resolve(projectRoot, "state.json");
let db: DBSchema;
let state: Record<string, { threads: number; tweets: number }>;

// --- Load Content DB ---
try {
  console.log(`📚 Loading content DB from: ${dbPath}`);
  db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
  if (!db.contentGoals?.postingCadence)
    console.warn(
      "⚠️ 'contentGoals.postingCadence' missing in DB, using defaults."
    );
  if (!db.contentStrategies?.dailyPrompts)
    throw new Error("Missing required 'contentStrategies.dailyPrompts'");
  console.log("✅ Content DB loaded.");
} catch (error) {
  console.error(`❌ Fatal Error loading content DB:`, error);
  process.exit(1);
}

// --- Load State ---
try {
  console.log(`📊 Loading state from: ${statePath}`);
  state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf-8"))
    : {};
  console.log("✅ State loaded/initialized.");
} catch (error) {
  console.error(
    `❌ Error loading state file, initializing empty state.`,
    error
  );
  state = {};
}

// --- Initialize/Get Today's State ---
const todayKey = new Date().toISOString().split("T")[0];
if (!state[todayKey]) {
  console.log(`✨ Initializing state for today: ${todayKey}`);
  state[todayKey] = { threads: 0, tweets: 0 };
}
state[todayKey].threads = state[todayKey].threads || 0;
state[todayKey].tweets = state[todayKey].tweets || 0;

// --- Utility Functions ---
function pickRandom<T>(arr: T[]): T {
  if (!arr || arr.length === 0)
    throw new Error("Cannot pick random from empty array.");
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function truncateText(text: string, maxLength = MAX_TWEET_LENGTH): string {
  if (text.length <= maxLength) return text;
  console.warn(`✂️ Truncating text exceeding ${maxLength} chars.`);
  return text.slice(0, maxLength - 3) + "...";
}

// REMOVED randomDelay function as it's not used before posting anymore.

async function safeGenerateText(
  prompt: string,
  maxLength = AI_CHAR_LIMIT
): Promise<string | null> {
  // Enhanced prompt for more human-like, less perfect text
  const humanizingInstructions = `Write this in a natural, authentic conversational style, like you're thinking out loud or sharing directly with a peer. Avoid overly polished or marketing language. Focus on clarity and conveying the core idea genuinely. It's okay if the phrasing isn't perfect, prioritize authenticity. However, ensure any factual information mentioned is accurate.`;
  const fullPrompt = `${prompt}\n\n**Style Guide:** ${humanizingInstructions}\n\n(Constraint: Ensure the entire response is under ${maxLength} characters.)`;

  try {
    console.log(
      `🧠 Generating AI text (max ${maxLength} chars, aiming for natural style)...`
    );
    const generatedText = await ai.generateText(fullPrompt);

    if (!generatedText || generatedText.trim().length === 0) {
      console.warn(`⚠️ AI returned empty text.`);
      return null;
    }
    // Remove potential leading/trailing quotes sometimes added by AI
    let cleanedText = generatedText.trim().replace(/^["']|["']$/g, "");

    const checkedText =
      cleanedText.length > maxLength
        ? truncateText(cleanedText, maxLength)
        : cleanedText;
    console.log(`   AI Text generated successfully.`);
    return checkedText;
  } catch (error: any) {
    console.error(`❌ Error generating AI text:`, error.message || error);
    if (error.message?.includes("SAFETY")) {
      console.warn("   ⚠️ Generation blocked due to SAFETY filter.");
      console.warn(
        `   Prompt start that may have caused block: ${prompt.substring(
          0,
          150
        )}...`
      );
    }
    return null;
  }
}

async function safePostTweet(
  text: string,
  options?: { reply?: { in_reply_to_tweet_id: string } }
): Promise<TweetV2PostTweetResult | null> {
  const textToPost = truncateText(text);
  try {
    console.log(`🐦 Posting tweet (length ${textToPost.length})...`);
    const result = await twitterClient.tweet(textToPost, options);
    console.log(`✅ Tweet posted successfully: ID ${result.data.id}`);
    return result;
  } catch (error: any) {
    console.error(
      `❌ Error posting tweet: "${textToPost.substring(0, 100)}..."`
    );
    if (error.code === 429) {
      console.error(
        `   RATE LIMIT HIT (429). Need to run less frequently or post less.`
      );
    } else if (error.code) {
      console.error(
        `   Twitter API Error Code: ${error.code}, Message: ${
          error.message || "No message"
        }`
      );
    } else {
      console.error("   Error details:", error);
    }
    return null;
  }
}

// --- Core Posting Logic ---
async function postTweet(): Promise<boolean> {
  console.log("--- Attempting to Post Tweet ---");
  try {
    const prompts = db.contentStrategies.dailyPrompts.tweets;
    if (!prompts?.length) {
      console.warn("⚠️ No daily tweet prompts. Skipping.");
      return false;
    }
    const promptSeed = pickRandom(prompts);
    // Updated prompt for human-like style
    const fullPrompt = `You are ${db.founderProfile.name} (${db.founderProfile.title}), with a voice that is ${db.founderProfile.voice}. Draft a single tweet for an audience of ${db.audience.target}, based on this core idea: "${promptSeed}"`;
    const text = await safeGenerateText(fullPrompt);
    if (!text) {
      console.error("❌ Failed to generate AI text for tweet.");
      return false;
    }
    const postResult = await safePostTweet(text);
    return !!postResult;
  } catch (error) {
    console.error("❌ Unexpected error during postTweet:", error);
    return false;
  }
}

async function generateThreadParts(
  pillar: ContentPillar,
  seedPrompt: string
): Promise<string[] | null> {
  try {
    const structures = db.contentStrategies.threadStructures;
    if (!structures?.length) {
      console.warn("⚠️ No thread structures in DB.");
      return null;
    }
    const structure = pickRandom(structures);
    console.log(
      `🧵 Generating thread parts for "${structure.title}" on "${pillar.name}"...`
    );
    const parts: string[] = [];
    // Add prefix for the first part only later
    // Generate raw content for each part
    for (const [index, section] of structure.format.entries()) {
      // Updated prompt for human-like style
      const partPrompt = `You are ${db.founderProfile.name}, voice: ${
        db.founderProfile.voice
      }. Writing part ${index + 1}/${
        structure.format.length
      } of a Twitter thread on '${
        pillar.name
      }' (Idea: '${seedPrompt}'). Focus this part on: '${section}'. Target audience: ${
        db.audience.target
      }.`;
      const partText = await safeGenerateText(partPrompt);
      if (!partText) {
        console.error(
          `❌ Failed to generate part ${index + 1}. Aborting thread generation.`
        );
        return null;
      }
      parts.push(partText); // Generate raw parts first
    }
    console.log(`✅ Generated ${parts.length} raw thread parts.`);
    return parts; // Return raw parts without numbering initially
  } catch (error) {
    console.error(`❌ Error generating thread parts:`, error);
    return null;
  }
}

async function postThread(): Promise<boolean> {
  console.log("--- Attempting to Post Thread ---");
  try {
    const pillars = db.contentPillars;
    const prompts = db.contentStrategies.dailyPrompts.threads;
    if (!pillars?.length) {
      console.warn("⚠️ No content pillars. Skipping.");
      return false;
    }
    if (!prompts?.length) {
      console.warn("⚠️ No daily thread prompts. Skipping.");
      return false;
    }

    const pillar = pickRandom(pillars);
    const seedPrompt = pickRandom(prompts);
    const generatedParts = await generateThreadParts(pillar, seedPrompt);
    if (!generatedParts || generatedParts.length < MIN_THREAD_PARTS) {
      console.error(
        "❌ Thread generation failed or produced too few raw parts."
      );
      return false;
    }

    const threadLength = getRandomInt(
      MIN_THREAD_PARTS,
      Math.min(MAX_THREAD_PARTS, generatedParts.length)
    );
    const partsToPostRaw = generatedParts.slice(0, threadLength);

    // Add numbering (1/N, 2/N, etc.) before posting
    const finalPartsToPost = partsToPostRaw.map((part, index) => {
      // Add numbering like "1/5" or "2/5" to the start of each part
      return `${index + 1}/${threadLength} ${part}`;
    });

    console.log(
      `🐦 Posting thread with ${finalPartsToPost.length} parts (randomly selected length)...`
    );

    // Post first part
    let firstTweetResult = await safePostTweet(finalPartsToPost[0]);
    if (!firstTweetResult) {
      console.error("❌ Failed to post first tweet. Aborting.");
      return false;
    }
    let previousTweetId = firstTweetResult.data.id;

    // Post remaining parts with SHORT random delay
    for (let i = 1; i < finalPartsToPost.length; i++) {
      const partDelay = getRandomInt(
        MIN_THREAD_PART_DELAY_MS,
        MAX_THREAD_PART_DELAY_MS
      );
      console.log(
        `   ...waiting ${partDelay}ms before posting part ${i + 1}...`
      );
      await new Promise((resolve) => setTimeout(resolve, partDelay));
      const replyResult = await safePostTweet(finalPartsToPost[i], {
        reply: { in_reply_to_tweet_id: previousTweetId },
      });
      if (!replyResult) {
        console.error(`❌ Failed to post part ${i + 1}. Thread incomplete.`);
        return false;
      }
      previousTweetId = replyResult.data.id;
    }
    console.log("✅ Thread posted successfully.");
    return true;
  } catch (error) {
    console.error("❌ Unexpected error during postThread:", error);
    return false;
  }
}

// --- Main Task Runner ---
async function runTask() {
  console.log(`\n🚀 Starting content task check for ${todayKey}...`);
  const counters = state[todayKey];
  const totalPostsToday = counters.threads + counters.tweets;

  console.log(
    `📊 Daily Stats: ${totalPostsToday}/${MAX_TOTAL_POSTS_PER_DAY} total. Threads: ${counters.threads}/${MAX_THREADS_PER_DAY}, Tweets: ${counters.tweets}/${MAX_TWEETS_PER_DAY}.`
  );

  // --- Decision Logic: Should we post now? ---
  if (totalPostsToday >= MAX_TOTAL_POSTS_PER_DAY) {
    console.log("✅ Maximum total posts for today reached. Exiting task.");
    return;
  }

  const remainingPosts = MAX_TOTAL_POSTS_PER_DAY - totalPostsToday;
  const currentHour = new Date().getUTCHours();
  const remainingRunsToday = Math.max(1, 24 - currentHour); // Approx runs left if workflow is hourly
  const probability = remainingPosts / remainingRunsToday;

  console.log(
    `🎲 Calculated probability to post this run: ${probability.toFixed(
      2
    )} (Remaining: ${remainingPosts}, Approx Runs Left: ${remainingRunsToday})`
  );

  if (Math.random() > probability) {
    console.log(
      "📉 Random check failed. Skipping post this run to ensure random distribution over time."
    );
    return;
  }

  console.log("📈 Random check passed! Proceeding to attempt posting.");

  // --- Decide Post Type (Random if both possible) & Execute ---
  let postedSuccessfully = false;
  let postTypeAttempted: PostType | null = null;
  const canPostThread = counters.threads < MAX_THREADS_PER_DAY;
  const canPostTweet = counters.tweets < MAX_TWEETS_PER_DAY;

  if (canPostThread && canPostTweet) {
    // Both possible, choose randomly
    postTypeAttempted = Math.random() < 0.5 ? PostType.THREAD : PostType.TWEET;
    console.log(
      `💡 Both types possible, randomly chose: ${postTypeAttempted}.`
    );
  } else if (canPostThread) {
    postTypeAttempted = PostType.THREAD;
    console.log(`💡 Only threads possible within limit. Attempting thread.`);
  } else if (canPostTweet) {
    postTypeAttempted = PostType.TWEET;
    console.log(`💡 Only tweets possible within limit. Attempting tweet.`);
  } else {
    // Should be caught by totalPostsToday check, but safe fallback
    console.log("❓ No post type possible within limits. Exiting task.");
    return;
  }

  // Execute the chosen post type
  if (postTypeAttempted === PostType.THREAD) {
    postedSuccessfully = await postThread();
    if (postedSuccessfully) counters.threads++;
  } else {
    // Must be TWEET
    postedSuccessfully = await postTweet();
    if (postedSuccessfully) counters.tweets++;
  }

  // --- Update State ---
  if (postedSuccessfully && postTypeAttempted) {
    console.log(
      `✅ ${postTypeAttempted} posted. New counts: Threads ${counters.threads}, Tweets ${counters.tweets}`
    );
    console.log(`💾 Updating state file: ${statePath}`);
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      console.log(`✅ State successfully saved.`);
    } catch (error) {
      console.error(`❌ CRITICAL ERROR: Failed to write state file!`, error);
    }
  } else if (postTypeAttempted) {
    console.log(
      `📉 ${postTypeAttempted} posting was attempted but failed. State not updated.`
    );
  }

  console.log(`🏁 Content task check finished for this run.`);
}

// --- Script Execution ---
(async () => {
  if (require.main === module) {
    await runTask();
    console.log("👋 ChirpCraft task handler complete.");
  }
})().catch((error) => {
  console.error("❌ Unhandled exception in main execution:", error);
  process.exit(1);
});
