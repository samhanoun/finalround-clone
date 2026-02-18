/**
 * Chrome Extension API Type Definitions
 */

interface ChromeRuntime {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: {
    addListener(callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void): void;
  };
}

interface ChromeTabs {
  query(query: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number; url?: string }>>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  onUpdated: {
    addListener(callback: (tabId: number, changeInfo: unknown, tab: { id?: number; url?: string }) => void): void;
  };
}

interface ChromeScripting {
  executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown>;
}

interface ChromeCommands {
  onCommand: {
    addListener(callback: (command: string) => void): void;
  };
}

interface ChromeStorage {
  local: {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    clear(): Promise<void>;
  };
}

interface Chrome {
  runtime: ChromeRuntime;
  tabs: ChromeTabs;
  scripting: ChromeScripting;
  commands: ChromeCommands;
  storage: ChromeStorage;
}

declare const chrome: Chrome;
