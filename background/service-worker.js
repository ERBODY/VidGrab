/**
 * VidGrab — Service Worker Entry Point (MV3)
 * Imports all background modules using importScripts (compatible with MV3 service workers).
 */

// Import utility and background modules
// In MV3 service workers, importScripts is available at top level
try {
    importScripts(
        'utils/mime-types.js',
        'utils/filename.js',
        'utils/size-formatter.js',
        'background/stream-handler.js',
        'background/drm-handler.js',
        'background/converter.js',
        'background/background.js'
    );
} catch (e) {
    console.error('[VidGrab] Failed to import scripts:', e);
}
