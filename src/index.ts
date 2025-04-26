// src/index.ts
import fs from 'fs';
import path from 'path';
import { AIClient } from './aiClient';
// Use the user client specifically for posting, search client for trends
import { userClientV2, twitterSearchClient } from './twitterClient';
import { DBSchema, ContentPillar, ThreadStructure, TrendInfo, ContentGoals } from './types';
import { TweetV2PostTweetResult } from 'twitter-api-v2';
// Import the trend finding function
import { findTwitterTrends } from './trendFinder';

// =============================================================================
// --- Constants & Configuration ---
// =============================================================================

enum PostType { THREAD = 'thread', TWEET = 'tweet' }
const MAX_TWEET_LENGTH = 280;
const CHAR_LIMIT_BUFFER = 10;
const AI_CHAR_LIMIT = MAX_TWEET_LENGTH - CHAR_LIMIT_BUFFER;

// Default Posting Strategy Constants (can be overridden by contentDB.json)
const DEFAULT_MAX_TWEETS_PER_DAY = 5;
const DEFAULT_MAX_THREADS_PER_DAY = 5;
const DEFAULT_ENABLE_TREND_POSTS = true;
const MIN_THREAD_PARTS = 3;
const MAX_THREAD_PARTS = 8;
const MIN_THREAD_PART_DELAY_MS = 5000;  // 5 seconds
const MAX_THREAD_PART_DELAY_MS = 15000; // 15 seconds
const TREND_POST_PROBABILITY = 0.4; // 40% chance to use a trend if available & enabled

// =============================================================================
// --- Initialization ---
// =============================================================================

console.log("🚀 Initializing ChirpCraft...");
const ai = new AIClient();
const BOT_USER_ID = process.env.BOT_USER_ID; // Used for filtering self-mentions in trends

// --- Path Resolution ---
const projectRoot = path.resolve(__dirname, '..'); // Correctly points to project root from src/ or dist/
const dbPath = path.resolve(projectRoot, 'contentDB.json');
const statePath = path.resolve(projectRoot, 'state.json');

// --- Global Variables ---
let db: DBSchema;
let state: Record<string, { threads: number; tweets: number }>;
let availableTrends: TrendInfo[] = []; // Cached trends populated by findTwitterTrends

// --- Load Content DB ---
try {
    console.log(`📚 Loading content DB from: ${dbPath}`);
    const dbRaw = fs.readFileSync(dbPath, 'utf-8');
    db = JSON.parse(dbRaw);

    // Validate and apply defaults
    db.contentGoals = db.contentGoals || {} as ContentGoals;
    db.contentGoals.postingCadence = db.contentGoals.postingCadence || { tweetsPerDay: DEFAULT_MAX_TWEETS_PER_DAY, threadsPerDay: DEFAULT_MAX_THREADS_PER_DAY };
    db.contentGoals.postingCadence.tweetsPerDay = db.contentGoals.postingCadence.tweetsPerDay ?? DEFAULT_MAX_TWEETS_PER_DAY;
    db.contentGoals.postingCadence.threadsPerDay = db.contentGoals.postingCadence.threadsPerDay ?? DEFAULT_MAX_THREADS_PER_DAY;
    db.contentGoals.enableTrendBasedPosts = db.contentGoals.enableTrendBasedPosts ?? DEFAULT_ENABLE_TREND_POSTS;

    if (!db.contentStrategies?.dailyPrompts?.tweets?.length && !db.contentStrategies?.dailyPrompts?.threads?.length) {
        console.warn("⚠️ No daily prompts found in contentDB.json. Prompt-based posting will fail.");
    }
    if (!db.contentPillars || db.contentPillars.length === 0) {
        throw new Error("Missing required 'contentPillars' array in contentDB.json");
    }
    if (!db.contentStrategies?.threadStructures?.length) {
        console.warn("⚠️ No 'threadStructures' found in contentDB.json. Using internal defaults might be needed if generation fails.");
        // Potentially load default structures here if needed as fallback
    }
    console.log("✅ Content DB loaded and validated.");
} catch (error) {
    console.error(`❌ Fatal Error loading or parsing content DB at ${dbPath}:`, error);
    process.exit(1);
}

// --- Derive Daily Limits from DB/Defaults ---
const MAX_TWEETS_PER_DAY = db.contentGoals.postingCadence.tweetsPerDay;
const MAX_THREADS_PER_DAY = db.contentGoals.postingCadence.threadsPerDay;
const MAX_TOTAL_POSTS_PER_DAY = MAX_TWEETS_PER_DAY + MAX_THREADS_PER_DAY;
const ENABLE_TREND_POSTS = db.contentGoals.enableTrendBasedPosts;

// --- Load State ---
try {
    console.log(`📊 Loading state from: ${statePath}`);
    state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf-8')) : {};
    console.log("✅ State loaded/initialized.");
} catch (error) {
    console.error(`❌ Error loading state file at ${statePath}. Initializing empty state.`, error);
    state = {}; // Fallback to empty state on error
}

// --- Initialize/Get Today's State ---
const todayKey = new Date().toISOString().split('T')[0];
if (!state[todayKey]) {
    console.log(`✨ Initializing state for today: ${todayKey}`);
    state[todayKey] = { threads: 0, tweets: 0 };
}
// Ensure counters exist and are numbers
state[todayKey].threads = Number(state[todayKey].threads) || 0;
state[todayKey].tweets = Number(state[todayKey].tweets) || 0;


// =============================================================================
// --- Utility Functions ---
// =============================================================================

function pickRandom<T>(arr: T[]): T {
    if (!arr || arr.length === 0) throw new Error("Attempted to pick random from empty array.");
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
    return text.slice(0, maxLength - 3) + '...';
}

// =============================================================================
// --- Safe AI & Twitter Helpers ---
// =============================================================================

async function safeGenerateText(prompt: string, maxLength = AI_CHAR_LIMIT): Promise<string | null> {
    const humanizingInstructions = `Write this in a natural, authentic conversational style, like thinking out loud or sharing directly. Avoid overly polished or marketing language. Focus on clarity and conveying the core idea genuinely. It's okay if phrasing isn't perfect, prioritize authenticity. Ensure factual information is accurate.`;
    const fullPrompt = `${prompt}\n\n**Style Guide:** ${humanizingInstructions}\n\n(Constraint: Entire response under ${maxLength} characters.)`;
    try {
        console.log(`🧠 Generating AI text (max ${maxLength} chars, natural style)...`);
        const generatedText = await ai.generateText(fullPrompt); // Assumes aiClient propagates errors
        if (!generatedText?.trim()) {
            console.warn(`⚠️ AI returned empty text.`);
            return null;
        }
        let cleanedText = generatedText.trim().replace(/^["']|["']$/g, ''); // Remove leading/trailing quotes
        const checkedText = cleanedText.length > maxLength ? truncateText(cleanedText, maxLength) : cleanedText;
        console.log(`   AI Text generated successfully.`);
        return checkedText;
    } catch (error: any) {
        console.error(`❌ Error generating AI text:`, error.message || error);
        if (error.message?.includes('SAFETY')) {
            console.warn("   ⚠️ Generation blocked due to SAFETY filter.");
            // Log carefully only the start of the prompt
            console.warn(`   Prompt start potentially causing block: ${prompt.substring(0,150)}...`);
        }
        return null; // Consistent null return on ANY failure
    }
}

async function safePostTweet(text: string, options?: { reply?: { in_reply_to_tweet_id: string } }): Promise<TweetV2PostTweetResult | null> {
    const textToPost = truncateText(text); // Ensure length limit one last time
    try {
        console.log(`🐦 Posting tweet (length ${textToPost.length})...`);
        // Use the userClientV2 specifically for posting actions
        const result = await userClientV2.tweet(textToPost, options);
        console.log(`✅ Tweet posted successfully: ID ${result.data.id}`);
        return result;
    } catch (error: any) {
        console.error(`❌ Error posting tweet: "${textToPost.substring(0,100)}..."`);
        const statusCode = error.code || error.status; // Handle different error structures
        if (statusCode === 429) {
            console.error(`   RATE LIMIT HIT (429). Check frequency/limits.`);
        } else if (statusCode === 403) {
             console.error(`   FORBIDDEN (403). Check API key permissions or content rules (e.g., duplicate tweet).`);
        } else if (statusCode) {
            console.error(`   Twitter API Error Code: ${statusCode}, Message: ${error.message || 'No message'}`);
        } else {
            console.error('   Unknown Error details:', error);
        }
        return null; // Consistent null return
    }
}

// =============================================================================
// --- Content Generation Logic ---
// =============================================================================

/** Generates the text for a single tweet based on a prompt or trend. */
async function generateSingleTweetText(trend?: TrendInfo): Promise<string | null> {
    let prompt = "";
    try {
        if (trend) {
            const authorInfo = trend.authorUsername ? ` by @${trend.authorUsername}` : '';
            prompt = `You are ${db.founderProfile.name}, ${db.founderProfile.voice}. React to a recent tweet on '${trend.relevantPillar}': "${trend.text}"${authorInfo}. Write a short, insightful tweet adding your unique perspective for ${db.audience.target}.`;
        } else {
            const prompts = db.contentStrategies.dailyPrompts.tweets;
            if (!prompts?.length) { console.warn("⚠️ No daily tweet prompts found."); return null; }
            const promptSeed = pickRandom(prompts);
            prompt = `You are ${db.founderProfile.name} (${db.founderProfile.title}), voice: ${db.founderProfile.voice}. Draft a single tweet for ${db.audience.target} based on this idea: "${promptSeed}"`;
        }
        return await safeGenerateText(prompt);
    } catch (error) {
        console.error('❌ Unexpected error during generateSingleTweetText:', error);
        return null;
    }
}

/** Generates an array of raw text parts for a thread based on structure, pillar, prompt/trend. Cleans AI prefixes. */
async function generateThreadParts(pillar: ContentPillar, seedPrompt: string, trend?: TrendInfo): Promise<string[] | null> {
    try {
        const structures = db.contentStrategies.threadStructures;
        if (!structures?.length) { console.warn("⚠️ No thread structures in contentDB.json."); return null; }
        const structure = pickRandom(structures);

        let threadCoreIdea = seedPrompt;
        let generationContext = `on '${pillar.name}' (Core Idea: '${seedPrompt}')`;
        if (trend) {
            const authorInfo = trend.authorUsername ? ` from @${trend.authorUsername}` : '';
            threadCoreIdea = `Reacting to this tweet${authorInfo}: "${trend.text}"`;
            generationContext = `reacting to a recent tweet related to '${trend.relevantPillar}'`;
            console.log(`🧵 Generating thread parts for "${structure.title}" ${generationContext}...`);
        } else {
            console.log(`🧵 Generating thread parts for "${structure.title}" on "${pillar.name}"...`);
        }

        const parts: string[] = [];
        for (const [index, section] of structure.format.entries()) {
            const partPrompt = `You are ${db.founderProfile.name}, voice: ${db.founderProfile.voice}. Writing part ${index + 1}/${structure.format.length} of a Twitter thread ${generationContext}. Overall idea: "${threadCoreIdea}". This part focus: '${section}'. Audience: ${db.audience.target}.`;
            const partText = await safeGenerateText(partPrompt);
            if (!partText) { // Handle AI failure for a part
                console.error(`❌ Failed to generate part ${index + 1} for section "${section}". Aborting thread generation.`);
                return null; // Abort if any part fails
            }
            // Clean potential "X/Y " prefix from AI output
            const cleanedPartText = partText.replace(/^\d+\s*\/\s*\d+\s*/, '');
            if (cleanedPartText.length < partText.length) {
                console.log(`   ✨ Cleaned AI numbering prefix from part ${index + 1}.`);
            }
            parts.push(cleanedPartText); // Push the *cleaned* text
        }
        console.log(`✅ Generated ${parts.length} raw, cleaned thread parts.`);
        return parts;
    } catch (error) {
        console.error(`❌ Error generating thread parts:`, error);
        return null;
    }
}

// =============================================================================
// --- Posting Execution Logic ---
// =============================================================================

/** Posts a single tweet based on generated text or a trend. */
async function postTweet(trend?: TrendInfo): Promise<boolean> {
    console.log(`--- Attempting to Post Tweet ${trend ? '(Trend-Based)' : '(Prompt-Based)'} ---`);
    const text = await generateSingleTweetText(trend);
    if (!text) {
        console.error("❌ Failed to generate AI text for tweet.");
        return false;
    }
    const postResult = await safePostTweet(text);
    return !!postResult; // Return true if postResult is not null
}

/** Generates and posts a complete thread based on prompt or trend. */
async function postThread(trend?: TrendInfo): Promise<boolean> {
    console.log(`--- Attempting to Post Thread ${trend ? '(Trend-Based)' : '(Prompt-Based)'} ---`);
    try {
        let pillar: ContentPillar;
        let seedPrompt: string;
        let generatedParts: string[] | null;

        // Determine pillar and seed based on trend or prompt
        if (trend) {
            pillar = db.contentPillars.find(p => p.name === trend.relevantPillar) || pickRandom(db.contentPillars);
            seedPrompt = trend.text; // Use trend text as the seed/context
            generatedParts = await generateThreadParts(pillar, seedPrompt, trend);
        } else {
            const pillars = db.contentPillars;
            const prompts = db.contentStrategies.dailyPrompts.threads;
            if (!pillars?.length) { console.warn("⚠️ No content pillars found. Cannot post thread."); return false; }
            if (!prompts?.length) { console.warn("⚠️ No daily thread prompts found. Cannot post thread."); return false; }
            pillar = pickRandom(pillars);
            seedPrompt = pickRandom(prompts);
            generatedParts = await generateThreadParts(pillar, seedPrompt);
        }

        // Validate generated parts
        if (!generatedParts || generatedParts.length < MIN_THREAD_PARTS) {
            console.error("❌ Thread generation failed or produced too few parts.");
            return false;
        }

        // Determine final thread length and select parts
        const threadLength = getRandomInt(MIN_THREAD_PARTS, Math.min(MAX_THREAD_PARTS, generatedParts.length));
        const partsToPostRaw = generatedParts.slice(0, threadLength);

        // Add numbering (1/N, 2/N, etc.) to the *final selected* parts
        const finalPartsToPost = partsToPostRaw.map((part, index) => `${index + 1}/${threadLength} ${part}`);
        console.log(`🐦 Posting thread with ${finalPartsToPost.length} parts (random length)...`);

        // Post the first part
        let firstTweetResult = await safePostTweet(finalPartsToPost[0]);
        if (!firstTweetResult) { console.error("❌ Failed to post first part of thread. Aborting."); return false; }
        let previousTweetId = firstTweetResult.data.id;

        // Post subsequent parts with delays
        for (let i = 1; i < finalPartsToPost.length; i++) {
            const partDelay = getRandomInt(MIN_THREAD_PART_DELAY_MS, MAX_THREAD_PART_DELAY_MS);
            console.log(`   ...waiting ${partDelay}ms before posting part ${i + 1}/${finalPartsToPost.length}...`);
            await new Promise(resolve => setTimeout(resolve, partDelay)); // Asynchronous delay

            const replyResult = await safePostTweet(finalPartsToPost[i], { reply: { in_reply_to_tweet_id: previousTweetId } });
            if (!replyResult) {
                console.error(`❌ Failed to post part ${i + 1}. Thread incomplete.`);
                return false; // Stop and mark as failure
            }
            previousTweetId = replyResult.data.id;
        }

        console.log("✅ Thread posted successfully.");
        return true; // Entire selected thread posted
    } catch (error) {
        console.error('❌ Unexpected error during postThread:', error);
        return false;
    }
}


// =============================================================================
// --- Main Task Runner ---
// =============================================================================

async function runTask() {
    console.log(`\n🚀 Starting content task check for ${todayKey}...`);
    const counters = state[todayKey];
    const totalPostsToday = counters.threads + counters.tweets;

    console.log(`📊 Daily Stats: ${totalPostsToday}/${MAX_TOTAL_POSTS_PER_DAY} total. Threads: ${counters.threads}/${MAX_THREADS_PER_DAY}, Tweets: ${counters.tweets}/${MAX_TWEETS_PER_DAY}.`);

    // 1. Check if daily quota is already met
    if (totalPostsToday >= MAX_TOTAL_POSTS_PER_DAY) {
        console.log("✅ Maximum total posts for today reached. Exiting task.");
        return;
    }

    // 2. Fetch/Check Trends (uses internal caching)
    if (ENABLE_TREND_POSTS) {
        console.log("⏳ Checking for relevant trends...");
        availableTrends = await findTwitterTrends(db.contentPillars, BOT_USER_ID);
    } else {
        console.log("ℹ️ Trend-based posts disabled in config.");
        availableTrends = [];
    }

    // 3. Decide if posting THIS RUN based on probability
    const remainingPosts = MAX_TOTAL_POSTS_PER_DAY - totalPostsToday;
    const currentHour = new Date().getUTCHours(); // Use UTC for consistency across environments
    const remainingRunsToday = Math.max(1, 24 - currentHour); // Approx runs left if workflow is hourly
    const probability = remainingPosts / remainingRunsToday;
    console.log(`🎲 Calculated probability to post this run: ${probability.toFixed(2)} (Posts Left: ${remainingPosts}, Approx Runs Left: ${remainingRunsToday})`);

    if (Math.random() > probability) {
        console.log("📉 Random check failed. Skipping post this run to ensure random distribution over time.");
        return;
    }

    console.log("📈 Random check passed! Proceeding to attempt posting.");

    // 4. Decide Post Type (Tweet/Thread) and Source (Trend/Prompt)
    let postTypeAttempted: PostType | null = null;
    let useThisTrend: TrendInfo | undefined = undefined;
    const canPostThread = counters.threads < MAX_THREADS_PER_DAY;
    const canPostTweet = counters.tweets < MAX_TWEETS_PER_DAY;

    // Determine if attempting a trend-based post
    const attemptTrendPost = ENABLE_TREND_POSTS && availableTrends.length > 0 && Math.random() < TREND_POST_PROBABILITY;

    if (attemptTrendPost) {
        console.log(`💡 Attempting TREND-BASED post (Prob: ${TREND_POST_PROBABILITY}).`);
        // Randomly decide if trend becomes tweet or thread (if limits allow)
        if (canPostThread && (!canPostTweet || Math.random() < 0.5)) {
            postTypeAttempted = PostType.THREAD;
        } else if (canPostTweet) {
            postTypeAttempted = PostType.TWEET;
        }
        // If a valid type was chosen, pick a trend
        if (postTypeAttempted) {
            useThisTrend = pickRandom(availableTrends);
            console.log(`   Selected trend for ${postTypeAttempted}: "${useThisTrend.text.substring(0,50)}..."`);
        } else {
             console.log("   ⚠️ Limits reached, cannot use trend for either type right now.");
        }
    }

    // If not attempting a trend post, attempt a prompt-based one
    if (!postTypeAttempted) {
        console.log("💡 Attempting PROMPT-BASED post.");
        if (canPostThread && (!canPostTweet || Math.random() < 0.5)) {
            postTypeAttempted = PostType.THREAD;
        } else if (canPostTweet) {
            postTypeAttempted = PostType.TWEET;
        }
    }

    // Ensure a post type is actually selected before proceeding
    if (!postTypeAttempted) {
        console.log("❓ No post type could be selected within limits. Exiting task.");
        return;
    }

    // 5. Execute the Posting Action
    let postedSuccessfully = false;
    console.log(`🚀 Executing: Post ${postTypeAttempted} ${useThisTrend ? '(Trend-Based)' : '(Prompt-Based)'}`);

    if (postTypeAttempted === PostType.THREAD) {
        postedSuccessfully = await postThread(useThisTrend); // Pass undefined if not using trend
        if (postedSuccessfully) counters.threads++;
    } else { // Must be TWEET
        postedSuccessfully = await postTweet(useThisTrend); // Pass undefined if not using trend
        if (postedSuccessfully) counters.tweets++;
    }

    // 6. Update State File (only if successful)
    if (postedSuccessfully) {
        console.log(`✅ Post successful. New counts: Threads ${counters.threads}, Tweets ${counters.tweets}`);
        console.log(`💾 Updating state file: ${statePath}`);
        try {
            // Write the entire state object back
            fs.writeFileSync(statePath, JSON.stringify(state, null, 2)); // Pretty print state
            console.log(`✅ State successfully saved.`);
        } catch (error) {
            console.error(`❌ CRITICAL ERROR: Failed to write state file!`, error);
            // Consider alerting mechanisms here
        }
    } else {
        console.log(`📉 ${postTypeAttempted} posting was attempted but failed. State not updated.`);
    }

    console.log(`🏁 Content task check finished for this run.`);
}

// =============================================================================
// --- Script Execution ---
// =============================================================================

(async () => {
    // Check if the script is being run directly
    if (require.main === module) {
        await runTask();
        console.log("👋 ChirpCraft task handler complete.");
    }
})().catch(error => {
    console.error("❌ Unhandled exception in main execution scope:", error);
    process.exit(1); // Exit with error code for CI/CD failure
});