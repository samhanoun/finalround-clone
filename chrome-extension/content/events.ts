/**
 * FinalRound Copilot - Event Emitter
 * Simple event emitter for component communication
 */

type EventCallback = (...args: unknown[]) => void;

class EventEmitter {
  private events: Map<string, EventCallback[]> = new Map();
  
  /**
   * Subscribe to an event
   */
  on(event: string, callback: EventCallback): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(callback);
  }
  
  /**
   * Unsubscribe from an event
   */
  off(event: string, callback: EventCallback): void {
    const callbacks = this.events.get(event);
    if (!callbacks) return;
    
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }
  
  /**
   * Emit an event
   */
  emit(event: string, ...args: unknown[]): void {
    const callbacks = this.events.get(event);
    if (!callbacks) return;
    
    callbacks.forEach(callback => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[EventEmitter] Error in event "${event}":`, error);
      }
    });
  }
  
  /**
   * Subscribe to an event once
   */
  once(event: string, callback: EventCallback): void {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      callback(...args);
    };
    this.on(event, wrapper);
  }
  
  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}

export { EventEmitter };
