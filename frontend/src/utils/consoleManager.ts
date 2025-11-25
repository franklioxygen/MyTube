
type ConsoleMethod = (...args: any[]) => void;

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
    private static readonly STORAGE_KEY = 'mytube_debug_mode';

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
        const savedMode = localStorage.getItem(this.STORAGE_KEY);
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
        localStorage.setItem(this.STORAGE_KEY, String(enabled));

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
