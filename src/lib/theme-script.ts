export const THEME_KEY = "slate-theme";

/**
 * Runs in <head> before the first paint so the page never flashes the wrong theme.
 * Kept tiny and dependency-free; it is inlined as a string. No saved choice = follow the OS.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var l=p==="light"||(p==="system"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark";}catch(e){document.documentElement.dataset.theme="dark";}})();`;

/**
 * iPhone and iPad Safari zoom into any text field smaller than 16px when it's tapped, and
 * stay zoomed. `maximum-scale=1` stops that; on iOS people can still pinch to zoom, so it
 * doesn't take zooming away. Only iOS gets it: elsewhere it would block pinch-zoom.
 */
export const viewportScript = `(function(){try{var ios=/iP(hone|ad|od)/.test(navigator.platform)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);if(!ios)return;var fix=function(){document.querySelectorAll('meta[name="viewport"]').forEach(function(m){if(m.content.indexOf("maximum-scale")<0)m.content+=", maximum-scale=1";});};fix();new MutationObserver(fix).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}})();`;
