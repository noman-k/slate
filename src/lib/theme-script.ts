export const THEME_KEY = "slate-theme";

/**
 * Runs in <head> before the first paint so the page never flashes the wrong theme.
 * Kept tiny and dependency-free; it is inlined as a string. No saved choice = follow the OS.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var l=p==="light"||(p==="system"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark";}catch(e){document.documentElement.dataset.theme="dark";}})();`;
