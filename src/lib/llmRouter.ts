/**
 * LLM Router - Multi-provider AI model routing with cost/latency optimization
 * 
 * Features:
 * - Multi-provider support (OpenAI, Anthropic, Google Gemini)
 * - Cost optimization (route to cheaper models when appropriate)
 * - Latency optimization (faster models for simple tasks)
 * - User preference storage
 * - Automatic fallback chain
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createAdminClient } from './supabase/admin';

// Model configurations
export interface ModelConfig {
  id: string;
  provider: 'openai' | 'anthropic' | 'google';
  name: string;
  contextWindow: number;
  costPer1kInput: number;  // in cents
  costPer1kOutput: number; // in cents
  avgLatencyMs: number;
  strengths: string[];
  bestFor: string[];
}

// Available models
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // OpenAI models
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    contextWindow: 128000,
    costPer1kInput: 2.5,
    costPer1kOutput: 10,
    avgLatencyMs: 1500,
    strengths: ['reasoning', 'coding', 'multimodal'],
    bestFor: ['complex reasoning', 'coding tasks', 'analysis'],
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    contextWindow: 128000,
    costPer1kInput: 0.15,
    costPer1kOutput: 0.6,
    avgLatencyMs: 800,
    strengths: ['speed', 'cost efficiency', 'reasoning'],
    bestFor: ['simple tasks', 'quick responses', 'high volume'],
  },
  'gpt-4-turbo': {
    id: 'gpt-4-turbo',
    provider: 'openai',
    name: 'GPT-4 Turbo',
    contextWindow: 128000,
    costPer1kInput: 10,
    costPer1kOutput: 30,
    avgLatencyMs: 2000,
    strengths: ['reasoning', 'coding', 'up-to-date'],
    bestFor: ['complex tasks', 'coding', 'analysis'],
  },
  
  // Anthropic models
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    name: 'Claude 4 Sonnet',
    contextWindow: 200000,
    costPer1kInput: 3,
    costPer1kOutput: 15,
    avgLatencyMs: 1800,
    strengths: ['reasoning', 'coding', 'long context', 'safety'],
    bestFor: ['complex reasoning', 'coding', 'analysis'],
  },
  'claude-haiku-3-5': {
    id: 'claude-haiku-3-5',
    provider: 'anthropic',
    name: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    costPer1kInput: 0.8,
    costPer1kOutput: 4,
    avgLatencyMs: 700,
    strengths: ['speed', 'cost efficiency', 'reasoning'],
    bestFor: ['simple tasks', 'quick responses', 'high volume'],
  },
  'claude-opus-4-5-20250501': {
    id: 'claude-opus-4-5-20250501',
    provider: 'anthropic',
    name: 'Claude 4 Opus',
    contextWindow: 200000,
    costPer1kInput: 15,
    costPer1kOutput: 75,
    avgLatencyMs: 2500,
    strengths: ['reasoning', 'coding', 'creative writing', 'analysis'],
    bestFor: ['most complex tasks', 'deep analysis', 'writing'],
  },
  
  // Google Gemini models
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    provider: 'google',
    name: 'Gemini 2.0 Flash',
    contextWindow: 1000000,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    avgLatencyMs: 600,
    strengths: ['speed', 'multimodal', 'long context', 'free tier'],
    bestFor: ['fast responses', 'multimodal tasks', 'high volume'],
  },
  'gemini-2.0-pro': {
    id: 'gemini-2.0-pro',
    provider: 'google',
    name: 'Gemini 2.0 Pro',
    contextWindow: 1000000,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    avgLatencyMs: 1200,
    strengths: ['reasoning', 'multimodal', 'long context'],
    bestFor: ['complex reasoning', 'analysis', 'multimodal'],
  },
};

// Task types for routing
export type TaskType = 
  | 'simple_qa'      // Simple questions, quick responses
  | 'coding'         // Code generation, debugging
  | 'analysis'       // Data analysis, reasoning
  | 'writing'        // Content generation, summarization
  | 'conversation'   // Chat, follow-up responses
  | 'complex';       // Complex reasoning, multi-step tasks

// Routing options
export interface RoutingOptions {
  taskType?: TaskType;
  preferSpeed?: boolean;    // Prioritize latency over cost
  preferCost?: boolean;     // Prioritize cost over speed
  preferQuality?: boolean;  // Prioritize quality over speed/cost
  maxLatencyMs?: number;    // Maximum acceptable latency
  maxCost?: number;         // Maximum cost in cents
  userPreference?: string; // User's preferred model
  useFallback?: boolean;   // Enable fallback chain
}

// User preferences
export interface UserLLMPreferences {
  user_id: string;
  preferred_provider?: string;
  preferred_model?: string;
  temperature?: number;
  max_tokens?: number;
  auto_optimize?: boolean;  // Let system optimize model selection
}

// Fallback chain
export interface FallbackConfig {
  primary: string;
  fallbacks: string[];  // Model IDs in order of preference
}

// Default fallback chains by task type
export const FALLBACK_CHAINS: Record<TaskType, FallbackConfig> = {
  simple_qa: {
    primary: 'gpt-4o-mini',
    fallbacks: ['claude-haiku-3-5', 'gemini-2.0-flash'],
  },
  coding: {
    primary: 'gpt-4o',
    fallbacks: ['claude-sonnet-4-20250514', 'gpt-4o-mini'],
  },
  analysis: {
    primary: 'claude-sonnet-4-20250514',
    fallbacks: ['gpt-4o', 'gemini-2.0-pro'],
  },
  writing: {
    primary: 'claude-sonnet-4-20250514',
    fallbacks: ['gpt-4o', 'gemini-2.0-pro'],
  },
  conversation: {
    primary: 'gpt-4o-mini',
    fallbacks: ['claude-haiku-3-5', 'gemini-2.0-flash'],
  },
  complex: {
    primary: 'claude-opus-4-5-20250501',
    fallbacks: ['gpt-4o', 'claude-sonnet-4-20250514'],
  },
};

/**
 * Determine the best model based on task type and optimization preferences
 */
export function selectModel(options: RoutingOptions = {}): string {
  const {
    taskType = 'conversation',
    preferSpeed = false,
    preferCost = false,
    preferQuality = false,
    maxLatencyMs,
    maxCost,
    userPreference,
  } = options;

  // If user has a preference, always use it (user choice takes priority)
  if (userPreference && MODEL_CONFIGS[userPreference]) {
    return userPreference;
  }

  // Get models that match task type
  let candidateModels = Object.values(MODEL_CONFIGS);

  // Apply task type preference (soft filter - prioritize but don't exclude)
  if (taskType !== 'conversation') {
    candidateModels = candidateModels.sort((a, b) => {
      const aMatches = a.bestFor.some((bf) => {
        switch (taskType) {
          case 'coding':
            return bf.includes('code') || bf.includes('analysis');
          case 'analysis':
            return bf.includes('analysis') || bf.includes('reasoning');
          case 'writing':
            return bf.includes('writing') || bf.includes('analysis');
          case 'complex':
            return bf.includes('complex') || bf.includes('analysis');
          case 'simple_qa':
            return bf.includes('simple') || bf.includes('quick') || bf.includes('high volume');
          default:
            return false;
        }
      });
      const bMatches = b.bestFor.some((bf) => {
        switch (taskType) {
          case 'coding':
            return bf.includes('code') || bf.includes('analysis');
          case 'analysis':
            return bf.includes('analysis') || bf.includes('reasoning');
          case 'writing':
            return bf.includes('writing') || bf.includes('analysis');
          case 'complex':
            return bf.includes('complex') || bf.includes('analysis');
          case 'simple_qa':
            return bf.includes('simple') || bf.includes('quick') || bf.includes('high volume');
          default:
            return false;
        }
      });
      // Prefer matching models
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });
  }

  // Apply optimization strategy
  let selectedModel: ModelConfig | null = null;

  if (preferQuality) {
    // Sort by quality (inverse of latency as proxy), take best
    selectedModel = candidateModels.sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)[0] ?? null;
  } else if (preferSpeed || taskType === 'simple_qa') {
    // Sort by latency (fastest first)
    selectedModel = candidateModels.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0] ?? null;
  } else if (preferCost) {
    // Sort by total cost (input + output)
    selectedModel = candidateModels.sort(
      (a, b) => a.costPer1kInput + a.costPer1kOutput - (b.costPer1kInput + b.costPer1kOutput)
    )[0] ?? null;
  } else {
    // Default: balance of speed and cost (prefer mini/fast models)
    selectedModel = candidateModels.find((m) => m.id.includes('mini') || m.id.includes('haiku') || m.id.includes('flash')) 
      ?? candidateModels[0] 
      ?? null;
  }

  // Apply constraints
  if (maxLatencyMs && selectedModel && selectedModel.avgLatencyMs > maxLatencyMs) {
    selectedModel = candidateModels
      .filter((m) => m.avgLatencyMs <= maxLatencyMs)
      .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0] ?? null;
  }

  if (maxCost && selectedModel) {
    const maxTotalCost = maxCost * 2; // rough estimate
    if (selectedModel.costPer1kInput + selectedModel.costPer1kOutput > maxTotalCost) {
      selectedModel = candidateModels
        .filter((m) => m.costPer1kInput + m.costPer1kOutput <= maxTotalCost)
        .sort((a, b) => (a.costPer1kInput + a.costPer1kOutput) - (b.costPer1kInput + b.costPer1kOutput))[0] ?? null;
    }
  }

  return selectedModel?.id ?? 'gpt-4o-mini'; // Safe default
}

/**
 * Get the fallback chain for a task
 */
export function getFallbackChain(taskType: TaskType = 'conversation', primaryModel?: string): string[] {
  const chain = FALLBACK_CHAINS[taskType];
  if (!chain) return ['gpt-4o-mini'];
  
  if (primaryModel && primaryModel !== chain.primary) {
    return [primaryModel, ...chain.fallbacks];
  }
  
  return [chain.primary, ...chain.fallbacks];
}

/**
 * Get user's LLM preferences from database
 */
export async function getUserPreferences(userId: string): Promise<UserLLMPreferences | null> {
  const admin = createAdminClient();
  
  const { data, error } = await admin
    .from('llm_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  
  if (error || !data) {
    return null;
  }
  
  return {
    user_id: data.user_id,
    preferred_provider: data.provider,
    preferred_model: data.model,
    temperature: data.temperature,
    max_tokens: data.max_tokens,
    auto_optimize: data.auto_optimize ?? true,
  };
}

/**
 * Save user's LLM preferences to database
 */
export async function saveUserPreferences(prefs: UserLLMPreferences): Promise<UserLLMPreferences> {
  const admin = createAdminClient();
  
  const { data, error } = await admin
    .from('llm_settings')
    .upsert(
      {
        user_id: prefs.user_id,
        provider: prefs.preferred_provider,
        model: prefs.preferred_model,
        temperature: prefs.temperature,
        max_tokens: prefs.max_tokens,
        auto_optimize: prefs.auto_optimize ?? true,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();
  
  if (error) {
    console.error('Failed to save LLM preferences:', error);
    throw new Error('Failed to save preferences');
  }
  
  return {
    user_id: data.user_id,
    preferred_provider: data.provider,
    preferred_model: data.model,
    temperature: data.temperature,
    max_tokens: data.max_tokens,
    auto_optimize: data.auto_optimize ?? true,
  };
}

/**
 * Unified LLM client that handles all providers
 */
export class LLMClient {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private google: GoogleGenerativeAI | null = null;
  
  constructor() {
    // Initialize clients based on available API keys
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      this.google = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    }
  }
  
  /**
   * Check if a provider is available
   */
  isProviderAvailable(provider: string): boolean {
    switch (provider) {
      case 'openai':
        return this.openai !== null;
      case 'anthropic':
        return this.anthropic !== null;
      case 'google':
        return this.google !== null;
      default:
        return false;
    }
  }
  
  /**
   * Execute completion with fallback chain
   */
  async complete(
    messages: Array<{ role: string; content: string }>,
    options: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
      fallbackChain?: string[];
    } = {}
  ): Promise<{ text: string; model: string; provider: string; raw: unknown }> {
    const { 
      model: requestedModel, 
      temperature = 0.7, 
      max_tokens = 4096,
      fallbackChain 
    } = options;
    
    const modelsToTry = fallbackChain ?? [requestedModel ?? selectModel()];
    
    let lastError: Error | null = null;
    
    for (const modelId of modelsToTry) {
      const config = MODEL_CONFIGS[modelId];
      if (!config) {
        console.warn(`Unknown model: ${modelId}, skipping`);
        continue;
      }
      
      if (!this.isProviderAvailable(config.provider)) {
        console.warn(`Provider ${config.provider} not available, skipping ${modelId}`);
        continue;
      }
      
      try {
        const result = await this.executeCompletion(config, messages, { temperature, max_tokens });
        return {
          ...result,
          model: modelId,
          provider: config.provider,
        };
      } catch (error) {
        console.error(`Model ${modelId} failed:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        // Continue to next fallback
      }
    }
    
    // All fallbacks exhausted
    throw lastError ?? new Error('All model fallbacks exhausted');
  }
  
  private async executeCompletion(
    config: ModelConfig,
    messages: Array<{ role: string; content: string }>,
    options: { temperature: number; max_tokens: number }
  ): Promise<{ text: string; raw: unknown }> {
    switch (config.provider) {
      case 'openai':
        return this.executeOpenAI(config.id, messages, options);
      case 'anthropic':
        return this.executeAnthropic(config.id, messages, options);
      case 'google':
        return this.executeGoogle(config.id, messages, options);
      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }
  }
  
  private async executeOpenAI(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: { temperature: number; max_tokens: number }
  ): Promise<{ text: string; raw: unknown }> {
    if (!this.openai) throw new Error('OpenAI not initialized');
    
    const completion = await this.openai.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    });
    
    const text = completion.choices[0]?.message?.content ?? '';
    return { text, raw: completion };
  }
  
  private async executeAnthropic(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: { temperature: number; max_tokens: number }
  ): Promise<{ text: string; raw: unknown }> {
    if (!this.anthropic) throw new Error('Anthropic not initialized');
    
    // Convert messages to Anthropic format
    const systemMessage = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    
    const completion = await this.anthropic.messages.create({
      model,
      system: systemMessage?.content,
      messages: nonSystemMessages as Anthropic.Messages.MessageParam[],
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    });
    
    const text = completion.content[0]?.type === 'text' 
      ? completion.content[0].text 
      : '';
    return { text, raw: completion };
  }
  
  private async executeGoogle(
    model: string,
    messages: Array<{ role: string; content: string }>,
    _options: { temperature: number; max_tokens: number }
  ): Promise<{ text: string; raw: unknown }> {
    if (!this.google) throw new Error('Google Generative AI not initialized');
    
    // Use the gemini-2.0-flash or gemini-pro model
    const geminiModel = this.google.getGenerativeModel({ 
      model: model.includes('flash') ? 'gemini-2.0-flash' : 'gemini-2.0-pro' 
    });
    
    // Convert messages to Google format
    const prompt = messages
      .map((m) => `${m.role === 'system' ? '' : `${m.role}: `}${m.content}`)
      .join('\n');
    
    const result = await geminiModel.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    return { text, raw: response };
  }
}

/**
 * Estimate cost for a request
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): { inputCost: number; outputCost: number; totalCost: number } {
  const config = MODEL_CONFIGS[modelId];
  if (!config) {
    return { inputCost: 0, outputCost: 0, totalCost: 0 };
  }
  
  const inputCost = (inputTokens / 1000) * config.costPer1kInput;
  const outputCost = (outputTokens / 1000) * config.costPer1kOutput;
  
  return {
    inputCost: Math.round(inputCost * 100) / 100, // round to cents
    outputCost: Math.round(outputCost * 100) / 100,
    totalCost: Math.round((inputCost + outputCost) * 100) / 100,
  };
}

/**
 * Detect task type from messages (simple heuristic)
 */
export function detectTaskType(
  messages: Array<{ role: string; content: string }>
): TaskType {
  const lastMessage = messages[messages.length - 1]?.content.toLowerCase() ?? '';
  
  // Coding indicators
  if (
    lastMessage.includes('function') ||
    lastMessage.includes('code') ||
    lastMessage.includes('implement') ||
    lastMessage.includes('debug') ||
    lastMessage.includes('algorithm')
  ) {
    return 'coding';
  }
  
  // Analysis indicators
  if (
    lastMessage.includes('analyze') ||
    lastMessage.includes('compare') ||
    lastMessage.includes('evaluate') ||
    lastMessage.includes('explain why')
  ) {
    return 'analysis';
  }
  
  // Writing indicators
  if (
    lastMessage.includes('write') ||
    lastMessage.includes('summarize') ||
    lastMessage.includes('create') ||
    lastMessage.includes('generate') ||
    lastMessage.includes('essay')
  ) {
    return 'writing';
  }
  
  // Complex indicators
  if (
    lastMessage.includes('strategy') ||
    lastMessage.includes('plan') ||
    lastMessage.includes('design') ||
    lastMessage.length > 500
  ) {
    return 'complex';
  }
  
  // Simple QA - short direct questions
  if (lastMessage.length < 50 && lastMessage.includes('?')) {
    return 'simple_qa';
  }
  
  // Default to conversation for most messages
  return 'conversation';
}

// Singleton instance
let llmClient: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  return llmClient;
}
