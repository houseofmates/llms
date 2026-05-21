/**
 * Telemetry module for LLMs Aggregator
 * Minimal telemetry for tracking offline Llama usage and diagnostics
 */

const telemetry = {
    // Configuration
    config: {
        enabled: true,
        endpoint: null, // Set to your telemetry endpoint if desired
        maxEvents: 100, // Max events to store locally
        flushInterval: 60000, // 1 minute
    },

    // Event queue
    events: [],

    // Initialize telemetry
    init() {
        // Load any stored events
        const stored = localStorage.getItem('llms_telemetry_events');
        if (stored) {
            try {
                this.events = JSON.parse(stored);
            } catch (e) {
                console.warn('failed to load telemetry events', e);
            }
        }

        // Periodic flush
        setInterval(() => this.flush(), this.config.flushInterval);

        // Flush on page unload
        window.addEventListener('beforeunload', () => this.flush());
    },

    // Track an event
    track(eventName, properties = {}) {
        if (!this.config.enabled) return;

        const event = {
            name: eventName,
            timestamp: Date.now(),
            properties: {
                ...properties,
                userAgent: navigator.userAgent.substring(0, 100),
                platform: this.getPlatform(),
                online: navigator.onLine,
            }
        };

        this.events.push(event);

        // Trim if exceeding max
        if (this.events.length > this.config.maxEvents) {
            this.events = this.events.slice(-this.config.maxEvents);
        }

        // Store locally
        this.persist();

        // Log for debugging
        if (typeof dlog !== 'undefined') {
            dlog.log('[telemetry]', eventName, properties);
        }
    },

    // Get platform info
    getPlatform() {
        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
            return 'android';
        }
        if (window.electronAPI) {
            return 'electron';
        }
        return 'web';
    },

    // Persist events to localStorage
    persist() {
        try {
            localStorage.setItem('llms_telemetry_events', JSON.stringify(this.events));
        } catch (e) {
            // Storage might be full
            console.warn('failed to persist telemetry', e);
        }
    },

    // Flush events to endpoint if configured
    async flush() {
        if (!this.config.endpoint || this.events.length === 0) return;

        const eventsToSend = [...this.events];
        this.events = [];
        this.persist();

        try {
            await fetch(this.config.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events: eventsToSend }),
                keepalive: true,
            });
        } catch (e) {
            // Put events back on failure
            this.events = [...eventsToSend, ...this.events].slice(-this.config.maxEvents);
            this.persist();
        }
    },

    // Get stored events (for debugging)
    getEvents() {
        return [...this.events];
    },

    // Clear all events
    clear() {
        this.events = [];
        localStorage.removeItem('llms_telemetry_events');
    },

    // Export events as JSON
    export() {
        return JSON.stringify(this.events, null, 2);
    }
};

// Auto-initialize
telemetry.init();
