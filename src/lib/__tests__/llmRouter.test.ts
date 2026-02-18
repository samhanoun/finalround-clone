import {
  selectModel,
  getFallbackChain,
  detectTaskType,
  MODEL_CONFIGS,
  FALLBACK_CHAINS,
} from '../llmRouter';

describe('llmRouter', () => {
  describe('selectModel', () => {
    it('should return default model when no options provided', () => {
      const model = selectModel();
      expect(model).toBeDefined();
      expect(MODEL_CONFIGS[model]).toBeDefined();
    });

    it('should respect user preference when provided', () => {
      const model = selectModel({ userPreference: 'gpt-4o' });
      expect(model).toBe('gpt-4o');
    });

    it('should return user preference even if it exceeds constraints (with warning)', () => {
      // Should still return user preference even if exceeds maxLatencyMs
      // (the warning is logged but preference is respected)
      const model = selectModel({
        userPreference: 'claude-opus-4-5-20250501',
        maxLatencyMs: 100, // Very low, but should still return preference
      });
      expect(model).toBe('claude-opus-4-5-20250501');
    });

    it('should prioritize speed when preferSpeed is true', () => {
      const model = selectModel({ preferSpeed: true, taskType: 'coding' });
      // Should return one of the fastest models (gemini-2.0-flash is fastest at 600ms)
      const expected = 'gemini-2.0-flash';
      expect(model).toBe(expected);
    });

    it('should prioritize cost when preferCost is true', () => {
      const model = selectModel({ preferCost: true });
      expect(model).toBeDefined();
      // Should return one of the cheaper models
      const cheapModels = ['gpt-4o-mini', 'claude-haiku-3-5', 'gemini-2.0-flash'];
      expect(cheapModels).toContain(model);
    });

    it('should prioritize quality when preferQuality is true', () => {
      const model = selectModel({ preferQuality: true });
      // Should return a high-quality model (slower = more capable)
      const expected = 'claude-opus-4-5-20250501';
      expect(model).toBe(expected);
    });

    it('should apply maxLatencyMs constraint', () => {
      const model = selectModel({ maxLatencyMs: 800 });
      const config = MODEL_CONFIGS[model];
      expect(config.avgLatencyMs).toBeLessThanOrEqual(800);
    });

    it('should apply maxCost constraint', () => {
      const model = selectModel({ maxCost: 1 }); // Very low cost
      expect(model).toBeDefined();
      // Should return a cheap model
      const cheapModels = ['gpt-4o-mini', 'claude-haiku-3-5', 'gemini-2.0-flash'];
      expect(cheapModels).toContain(model);
    });

    it('should select appropriate model for coding tasks', () => {
      const model = selectModel({ taskType: 'coding' });
      expect(model).toBeDefined();
      const config = MODEL_CONFIGS[model];
      expect(config.bestFor.some((bf) => bf.includes('code') || bf.includes('analysis'))).toBe(
        true
      );
    });

    it('should select appropriate model for analysis tasks', () => {
      const model = selectModel({ taskType: 'analysis' });
      expect(model).toBeDefined();
      const config = MODEL_CONFIGS[model];
      expect(config.bestFor.some((bf) => bf.includes('analysis') || bf.includes('reasoning'))).toBe(
        true
      );
    });

    it('should select fast model for simple_qa tasks', () => {
      const model = selectModel({ taskType: 'simple_qa' });
      const config = MODEL_CONFIGS[model];
      // Should be one of the faster models
      const fastModels = ['gpt-4o-mini', 'claude-haiku-3-5', 'gemini-2.0-flash'];
      expect(fastModels).toContain(model);
    });

    it('should select fast model for conversation tasks', () => {
      const model = selectModel({ taskType: 'conversation' });
      const config = MODEL_CONFIGS[model];
      // Should be one of the faster models by default
      expect(config.avgLatencyMs).toBeLessThan(1500);
    });
  });

  describe('getFallbackChain', () => {
    it('should return fallback chain for simple_qa', () => {
      const chain = getFallbackChain('simple_qa');
      expect(chain).toContain('gpt-4o-mini');
      expect(chain.length).toBeGreaterThan(1);
    });

    it('should return fallback chain for coding', () => {
      const chain = getFallbackChain('coding');
      expect(chain).toContain('gpt-4o');
      expect(chain.length).toBeGreaterThan(1);
    });

    it('should return fallback chain for analysis', () => {
      const chain = getFallbackChain('analysis');
      expect(chain).toContain('claude-sonnet-4-20250514');
      expect(chain.length).toBeGreaterThan(1);
    });

    it('should include user model as first priority when specified', () => {
      const chain = getFallbackChain('conversation', 'claude-opus-4-5-20250501');
      expect(chain[0]).toBe('claude-opus-4-5-20250501');
    });

    it('should have primary model as first element by default', () => {
      for (const taskType of Object.keys(FALLBACK_CHAINS) as Array<keyof typeof FALLBACK_CHAINS>) {
        const chain = getFallbackChain(taskType);
        expect(chain[0]).toBe(FALLBACK_CHAINS[taskType].primary);
      }
    });
  });

  describe('detectTaskType', () => {
    it('should detect coding tasks', () => {
      const messages = [
        { role: 'user', content: 'Write a function to implement binary search' },
      ];
      expect(detectTaskType(messages)).toBe('coding');
    });

    it('should detect analysis tasks', () => {
      const messages = [
        { role: 'user', content: 'Analyze the performance differences between these approaches' },
      ];
      expect(detectTaskType(messages)).toBe('analysis');
    });

    it('should detect writing tasks', () => {
      const messages = [
        { role: 'user', content: 'Write a summary of the main points from this article' },
      ];
      expect(detectTaskType(messages)).toBe('writing');
    });

    it('should detect complex tasks for long prompts', () => {
      const longContent = 'A'.repeat(600);
      const messages = [{ role: 'user', content: longContent }];
      expect(detectTaskType(messages)).toBe('complex');
    });

    it('should detect simple_qa for short prompts with question mark', () => {
      const messages = [{ role: 'user', content: 'Hello?' }];
      expect(detectTaskType(messages)).toBe('simple_qa');
    });

    it('should default to conversation for moderate length', () => {
      const messages = [
        { role: 'user', content: 'Can you help me prepare for my upcoming interview' },
      ];
      expect(detectTaskType(messages)).toBe('conversation');
    });
  });

  describe('MODEL_CONFIGS', () => {
    it('should have valid model configurations', () => {
      for (const [id, config] of Object.entries(MODEL_CONFIGS)) {
        expect(config.id).toBe(id);
        expect(config.provider).toMatch(/^(openai|anthropic|google)$/);
        expect(config.contextWindow).toBeGreaterThan(0);
        expect(config.costPer1kInput).toBeGreaterThanOrEqual(0);
        expect(config.costPer1kOutput).toBeGreaterThanOrEqual(0);
        expect(config.avgLatencyMs).toBeGreaterThan(0);
        expect(config.strengths).toBeDefined();
        expect(config.bestFor).toBeDefined();
      }
    });

    it('should have at least one model per provider', () => {
      const providers = new Set(Object.values(MODEL_CONFIGS).map((m) => m.provider));
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('anthropic')).toBe(true);
      expect(providers.has('google')).toBe(true);
    });
  });
});
