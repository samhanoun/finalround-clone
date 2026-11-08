import { env, llmProvider } from '@/lib/env';
import { isProviderConfigured, providerForModel, type ChatProvider } from '@/lib/llmRouter';

/** A fast model per provider: the gate answers yes or no in under ~1.5 s. */
const FAST_MODELS: Record<ChatProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-5-5',
};

/**
 * The model behind the live question gate's classifier: COPILOT_GATE_MODEL
 * when its provider has a key, otherwise the fast model of whichever provider
 * has one (LLM_PROVIDER=anthropic tries Anthropic first; anything else tries
 * OpenAI first). Null when no model is set up: the browser's heuristic gate
 * then decides on its own.
 */
export function gateModel(): string | null {
  const usable = (model: string | undefined): string | null => {
    const provider = model ? providerForModel(model) : null;
    return model && provider && isProviderConfigured(provider) ? model : null;
  };
  const order: ChatProvider[] = llmProvider() === 'anthropic' ? ['anthropic', 'openai'] : ['openai', 'anthropic'];
  return usable(env.COPILOT_GATE_MODEL) ?? order.map((provider) => usable(FAST_MODELS[provider])).find(Boolean) ?? null;
}
