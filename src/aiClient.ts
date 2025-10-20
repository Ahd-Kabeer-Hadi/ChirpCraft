// src/aiClient.ts
import { config } from "dotenv";
import {
  GoogleGenerativeAI,
  GenerationConfig,
  HarmCategory,
  HarmBlockThreshold,
  GenerativeModel,
} from "@google/generative-ai";

config(); // Load .env variables

export class AIClient {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel; // Store the model instance for reuse

  constructor(options?: {
    modelName?: string;
    generationConfig?: GenerationConfig;
  }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set.");
    }

    this.client = new GoogleGenerativeAI(apiKey);

    // --- Configuration Defaults ---
    const modelName = options?.modelName ?? "gemini-1.5-flash-latest";
    const generationConfig = options?.generationConfig ?? {
      // Common defaults - adjust as needed
      temperature: 0.8, // Slightly higher for more creative, engaging tweets.
      maxOutputTokens: 280,// Default max output, can be adjusted
      // topK: 40,
      // topP: 0.95,
    };
    const safetySettings = [
      // Default safety settings - adjust if necessary
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ];

    // Initialize the model instance in the constructor for efficiency
    try {
      this.model = this.client.getGenerativeModel({
        model: modelName,
        generationConfig: generationConfig,
        safetySettings: safetySettings,
      });
      console.log(`🤖 AI Client initialized with model: ${modelName}`);
    } catch (error) {
      console.error(
        `❌ Failed to initialize Google Generative AI model (${modelName}):`,
        error
      );
      throw error; // Re-throw initialization error
    }
  }

  /**
   * Generates text using the configured Google Generative AI model.
   * IMPORTANT: This method now PROPAGATES errors (including safety blocks)
   * upwards to the caller for specific handling. It does NOT catch errors itself.
   * @param prompt The input prompt string.
   * @returns The generated text string if successful.
   * @throws {GoogleGenerativeAIResponseError | Error} Propagates errors from the SDK directly.
   */
  async generateText(prompt: string): Promise<string> {
    // Let errors (network, safety blocks, API key issues) propagate up to the caller.

    console.log("   AIClient: Calling Google AI SDK generateContent..."); // Added log
    const result = await this.model.generateContent(prompt);
    const response = result.response;

    // The .text() method itself might throw if the candidate is blocked due to safety.
    // This error will now correctly propagate upwards.
    console.log("   AIClient: Calling response.text()..."); // Added log
    const text = response.text();
    console.log("   AIClient: Received text from SDK."); // Added log

    // Optional: Check for empty response *without* an error (less common)
    if (!text?.trim()) {
      console.warn(
        "⚠️ AIClient: Received empty text response from SDK without explicit error."
      );
      // We return "" here, the caller (safeGenerateText) also checks for empty/falsy values.
      return "";
    }

    return text;
  }
}
