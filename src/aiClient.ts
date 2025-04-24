import { config } from 'dotenv';
import { GoogleGenerativeAI, GenerationConfig, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

config(); // Load .env variables

export class AIClient {
  private client: GoogleGenerativeAI;
  private modelName: string;
  private generationConfig: GenerationConfig;
  // Define safety settings if needed - example below blocks potentially harmful content
  private safetySettings = [
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

  constructor(options?: { modelName?: string; generationConfig?: GenerationConfig }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set.");
    }

    // 1. Initialize the main client with the API key
    this.client = new GoogleGenerativeAI(apiKey);

    // 2. Set model name - use provided or a default (e.g., gemini-1.5-flash)
    this.modelName = options?.modelName ?? 'gemini-1.5-flash'; // Use gemini-1.5-flash as a common default

    // 3. Set generation config - use provided or defaults
    this.generationConfig = options?.generationConfig ?? {
    //   temperature: 0.9, // Example: uncomment to add temperature
    //   topK: 1,          // Example: uncomment for top-k sampling
    //   topP: 1,          // Example: uncomment for top-p sampling
      maxOutputTokens: 400, // Set default max output tokens
    };
  }

  async generateText(prompt: string): Promise<string> {
    try {
      // 4. Get the specific generative model instance with its configuration
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        generationConfig: this.generationConfig,
        safetySettings: this.safetySettings, // Apply safety settings
      });

      // 5. Call generateContent with the prompt
      const result = await model.generateContent(prompt);

      // 6. Access the response object from the result
      const response = result.response;

      // 7. Extract the text content using the text() method
      const text = response.text();
      return text;

    } catch (error) {
      console.error("Error generating text with Google AI:", error);
      // Handle potential errors, like blocked content due to safety settings
      if (error instanceof Error && error.message.includes('SAFETY')) {
         // You might want to check result.response.promptFeedback?.blockReason here if available
         return "The response was blocked due to safety settings.";
      }
      // Rethrow or return a generic error message
      throw new Error(`Failed to generate text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
