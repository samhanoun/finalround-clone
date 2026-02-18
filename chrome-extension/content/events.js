/**
 * FinalRound Copilot - Event Emitter
 * Simple event emitter for component communication
 */
class EventEmitter {
    constructor() {
        this.events = new Map();
    }
    /**
     * Subscribe to an event
     */
    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
    }
    /**
     * Unsubscribe from an event
     */
    off(event, callback) {
        const callbacks = this.events.get(event);
        if (!callbacks)
            return;
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }
    /**
     * Emit an event
     */
    emit(event, ...args) {
        const callbacks = this.events.get(event);
        if (!callbacks)
            return;
        callbacks.forEach(callback => {
            try {
                callback(...args);
            }
            catch (error) {
                console.error(`[EventEmitter] Error in event "${event}":`, error);
            }
        });
    }
    /**
     * Subscribe to an event once
     */
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        this.on(event, wrapper);
    }
    /**
     * Remove all listeners for an event
     */
    removeAllListeners(event) {
        if (event) {
            this.events.delete(event);
        }
        else {
            this.events.clear();
        }
    }
}
export { EventEmitter };
