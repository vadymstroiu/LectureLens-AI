/**
 * Minimal MV3 background service worker.
 * Configures the Chrome toolbar action to open the Side Panel directly.
 * All Firebase AI Logic & Gemini Nano calls run strictly in src/sidepanel/
 * because Chrome's Built-in Prompt API requires a window/document context.
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error('[LectureLens] Failed to configure sidePanel behavior:', error);
  });
