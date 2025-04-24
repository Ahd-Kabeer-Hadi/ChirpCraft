import { twitterClient } from './twitterClient'; // Assuming this is initialized v2 client
import { AIClient } from './aiClient';
import { ETwitterStreamEvent, TweetV2, UserV2 } from 'twitter-api-v2'; // Import necessary types
import { config } from 'dotenv';

config(); // Load .env variables

const ai = new AIClient();

// Tracks how many replies have been sent per tweet ID
// !! Limitation: In-memory state. Bot restarts lose this data. Consider a persistent store (DB, Redis) for production. !!
type ReplyState = Record<string, number>;
const replyState: ReplyState = {};

const BOT_HANDLE = process.env.BOT_HANDLE;
const BOT_USER_ID = process.env.BOT_USER_ID; // Required: Add your Bot's Twitter User ID to .env

if (!BOT_HANDLE) {
  throw new Error("BOT_HANDLE environment variable is not set.");
}
if (!BOT_USER_ID) {
  throw new Error("BOT_USER_ID environment variable is not set. Needed to prevent self-replies.");
}

const BOT_MENTION_RULE = { value: `@${BOT_HANDLE}`, tag: `mention-${BOT_HANDLE}` };
const MAX_REPLIES_PER_TWEET = 15; // Define as a constant
const MAX_TWEET_LENGTH = 280; // Twitter's character limit

async function setupStreamRules() {
  console.log('Setting up stream rules...');
  try {
    // Get existing rules
    const rules = await twitterClient.streamRules();

    // Delete existing rules tagged for this bot (optional, good for clean start)
    if (rules.data?.length) {
      const ruleIdsToDelete = rules.data
        .filter(rule => rule.tag === BOT_MENTION_RULE.tag)
        .map(rule => rule.id);
      if (ruleIdsToDelete.length > 0) {
        console.log(`Deleting existing rules: ${ruleIdsToDelete.join(', ')}`);
        await twitterClient.updateStreamRules({
          delete: { ids: ruleIdsToDelete },
        });
      }
    }

    // Add the rule to track mentions
    console.log(`Adding rule: ${JSON.stringify(BOT_MENTION_RULE)}`);
    await twitterClient.updateStreamRules({
      add: [BOT_MENTION_RULE],
    });
    console.log('Stream rules configured successfully.');

  } catch (error) {
    console.error('Error setting up stream rules:', error);
    throw error; // Rethrow to prevent starting the stream without rules
  }
}

export async function listenAndReply() {
  // 1. Setup rules before connecting
  await setupStreamRules();

  console.log(`Listening for mentions of @${BOT_HANDLE}...`);

  try {
    // 2. Connect to the stream requesting user details (author_id expansion)
    const stream = await twitterClient.searchStream({
      'tweet.fields': ['created_at', 'public_metrics'], // Optional: request useful fields
      expansions: ['author_id'],                       // *** Request author user object ***
      'user.fields': ['username', 'name'],             // *** Request username from user object ***
    });

    // Enable auto-reconnect (built-in feature of the library)
    stream.autoReconnect = true;

    // --- Stream Event Listeners (Optional but Recommended) ---
    stream.on(ETwitterStreamEvent.Connected, () => console.log('Stream connected.'));
    stream.on(ETwitterStreamEvent.ConnectionError, err => console.error('Stream connection error:', err));
    stream.on(ETwitterStreamEvent.ConnectionClosed, () => console.log('Stream connection closed.'));
    stream.on(ETwitterStreamEvent.DataKeepAlive, () => console.log('Stream keep-alive signal received.'));
    // You might want more sophisticated error handling/reconnection logic here

    // 3. Process tweets from the stream
    for await (const { data, includes } of stream) {
      try {
        const tweet: TweetV2 = data;
        const users: UserV2[] | undefined = includes?.users;

        const tweetId = tweet.id;
        const authorId = tweet.author_id;
        const originalTweetText = tweet.text;

        // 4. Prevent self-reply
        if (authorId === BOT_USER_ID) {
          console.log(`Skipping self-mention tweet: ${tweetId}`);
          continue;
        }

        // 5. Find author's username
        const author = users?.find(user => user.id === authorId);
        if (!author || !author.username) {
          console.warn(`Could not find username for author ID: ${authorId} in tweet ${tweetId}. Skipping.`);
          continue;
        }
        const authorUsername = author.username;

        // 6. Manage reply state and limit
        replyState[tweetId] = replyState[tweetId] || 0; // Initialize if not present
        if (replyState[tweetId] >= MAX_REPLIES_PER_TWEET) {
          console.log(`Max replies reached for tweet ${tweetId}. Skipping.`);
          continue;
        }

        // 7. Clean incoming text for the prompt (remove bot's own handle)
        const cleanedMentionText = originalTweetText.replace(`@${BOT_HANDLE}`, '').trim();
        if (!cleanedMentionText) {
          console.log(`Skipping tweet ${tweetId} as it only contained the bot mention.`);
          continue; // Avoid replying to tweets that only mention the bot
        }


        // 8. Build prompt for AI (Improved)
        // Calculate max length for AI, leaving space for "@username " prefix and safety margin
        const prefix = `@${authorUsername} `;
        const maxAIReplyLength = MAX_TWEET_LENGTH - prefix.length - 5; // 5 chars buffer

        const prompt = `You are a helpful, friendly founder (${BOT_HANDLE}) responding on Twitter. `
          + `A user (@${authorUsername}) mentioned you, saying: "${cleanedMentionText}".\n\n`
          + `Your task: Write a concise, empathetic, and clear reply in your authentic voice. `
          + `IMPORTANT: Your entire response MUST be under ${maxAIReplyLength} characters. `
          + `Do NOT include "@${authorUsername}" at the start of your response; it will be added automatically.`;


        // 9. Generate reply
        console.log(`Generating AI reply for tweet ${tweetId} from @${authorUsername}`);
        let replyText = await ai.generateText(prompt); // Assuming AIClient handles its own errors

        // 10. Truncate AI response if needed (as a fallback)
        if (replyText.length > maxAIReplyLength) {
            console.warn(`AI response exceeded ${maxAIReplyLength} chars. Truncating.`);
            replyText = replyText.substring(0, maxAIReplyLength - 3) + '...'; // Add ellipsis
        }
        
        // Ensure replyText is not empty after potential truncation or if AI failed
        if (!replyText.trim()) {
            console.error(`AI generated an empty reply for tweet ${tweetId}. Skipping.`);
            continue;
        }

        // 11. Send reply (inside a try/catch)
        const fullReply = `${prefix}${replyText}`;
        console.log(`Attempting to reply to tweet ${tweetId}: "${fullReply}"`);
        try {
          await twitterClient.tweet(fullReply, {
            reply: { in_reply_to_tweet_id: tweetId },
          });
          console.log(`Successfully replied to tweet ${tweetId}`);
          // 12. Increment count ONLY on successful tweet
          replyState[tweetId]++;
        } catch (tweetError) {
          console.error(`Failed to send reply for tweet ${tweetId}:`, tweetError);
          // Do not increment reply count if tweeting failed
        }

      } catch (innerError) {
          console.error('Error processing individual tweet:', innerError, 'Tweet data:', data);
          // Continue processing next tweet from stream
      }
    } // end for await loop

  } catch (streamError) {
    console.error('Fatal stream error:', streamError);
    // Consider adding retry logic or exiting gracefully
  }
}

// --- Optional: Start the listener ---
/*
listenAndReply().catch(err => {
  console.error("Listener failed to start or crashed:", err);
  process.exit(1); // Exit if setup fails or main loop crashes hard
});
*/