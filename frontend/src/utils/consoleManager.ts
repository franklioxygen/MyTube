
type ConsoleMethod = (...args: unknown[]) => void;

interface ConsoleMethods {
    log: ConsoleMethod;
    info: ConsoleMethod;
    warn: ConsoleMethod;
    error: ConsoleMethod;
    debug: ConsoleMethod;
}

class ConsoleManager {
    private static originalConsole: ConsoleMethods | null = null;
    private static isDebugMode: boolean = false;
    private static readonly LEGACY_DEBUG_MODE_STORAGE_ID = 'mytube_debug_mode';
    private static readonly DEBUG_MODE_STORAGE_ID = 'mytube:debug-mode';

    private static getStoredDebugMode(): string | null {
        return (
            localStorage.getItem(this.DEBUG_MODE_STORAGE_ID) ??
            localStorage.getItem(this.LEGACY_DEBUG_MODE_STORAGE_ID)
        );
    }

    private static persistDebugMode(enabled: boolean) {
        const value = String(enabled);
        localStorage.setItem(this.DEBUG_MODE_STORAGE_ID, value);
        localStorage.setItem(this.LEGACY_DEBUG_MODE_STORAGE_ID, value);
    }

    static init() {
        // Save original methods
        this.originalConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug
        };

        // Load saved preference
        const savedMode = this.getStoredDebugMode();
        // Default to true (showing logs) if not set, or parse the value
        // If the user wants to HIDE logs by default, they can toggle it.
        // But usually "Debug Mode" means SHOWING logs.
        // Wait, the request says "toggle debug mode, that will show/hide all console messages".
        // Usually apps have logs visible by default in dev, but maybe in prod they want them hidden?
        // Or maybe the user wants to hide them to clean up the UI?
        // Let's assume "Debug Mode" = "Show Logs".
        // If Debug Mode is OFF, we hide logs.
        
        // However, standard behavior is logs are visible.
        // So "Debug Mode" might mean "Verbose Logging" or just "Enable Console".
        // Let's stick to:
        // Debug Mode ON = Console works as normal.
        // Debug Mode OFF = Console is silenced.
        
        // Let's default to ON (logs visible) so we don't confuse new users/devs.
        const isDebug = savedMode === null ? true : savedMode === 'true';
        this.setDebugMode(isDebug);
    }

    static setDebugMode(enabled: boolean) {
        this.isDebugMode = enabled;
        this.persistDebugMode(enabled);

        if (enabled) {
            this.restoreConsole();
            console.log('Debug mode enabled');
        } else {
            console.log('Debug mode disabled');
            this.suppressConsole();
        }
    }

    static getDebugMode(): boolean {
        return this.isDebugMode;
    }

    private static suppressConsole() {
        if (!this.originalConsole) return;

        const noop = () => {};

        console.log = noop;
        console.info = noop;
        console.warn = noop;
        console.error = noop;
        console.debug = noop;
    }

    private static restoreConsole() {
        if (!this.originalConsole) return;

        console.log = this.originalConsole.log;
        console.info = this.originalConsole.info;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.debug = this.originalConsole.debug;
    }
}

export default ConsoleManager;
