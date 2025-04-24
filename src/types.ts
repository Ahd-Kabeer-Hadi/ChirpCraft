export interface FounderProfile {
    name: string;
    title: string;
    bio: string;
    voice: string;
    // Changed from core_values
    coreValues: string[];
}

export interface Audience {
    target: string;
    // Changed from they_seek
    theySeek: string[];
}

export interface ContentPillar {
    name: string;
    themes: string[];
    formats: string[];
}

export interface ThreadStructure {
    title: string;
    format: string[];
}

export interface ContentStrategies {
    // Changed from thread_structures
    threadStructures: ThreadStructure[];
    // Changed from daily_prompts
    dailyPrompts: {
      threads: string[];
      tweets: string[];
    };
}

export interface ExternalSources {
    site: string;
    blog: string;
    about: string;
    // Changed from resource_tools
    resourceTools: string[];
}

export interface ContentGoals {
    // Changed from posting_cadence
    postingCadence: {
        // Changed from tweets_per_day
        tweetsPerDay: number;
        // Changed from threads_per_day
        threadsPerDay: number;
    };
    // Changed from long_term_goals
    longTermGoals: string[];
}

// Main Schema for the contentDB.json file
export interface DBSchema {
    // Changed from founder_profile
    founderProfile: FounderProfile;
    audience: Audience;
    // Changed from content_pillars
    contentPillars: ContentPillar[];
    // Changed from content_strategies
    contentStrategies: ContentStrategies;
    // Changed from external_sources
    externalSources: ExternalSources;
    // Changed from content_goals
    contentGoals: ContentGoals;
}