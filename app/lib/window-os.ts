/**
 * Runs in <head> before the first paint (WON-232). On macOS it sets
 * `data-os="mac"` on <html>, so the controls in the window's round bottom
 * corners can follow the curve (postal.css, `--window-corner`). iPads report
 * a Mac platform and are left out by their touch points. `data-window="full"`
 * marks macOS full screen, where the corners are square.
 */
export const WINDOW_OS_SCRIPT = `(function(){var d=document.documentElement,n=navigator,p=(n.userAgentData&&n.userAgentData.platform)||n.platform||"";if(!/mac/i.test(p)||n.maxTouchPoints>1)return;d.dataset.os="mac";function f(){d.dataset.window=outerWidth>=screen.width&&outerHeight>=screen.height?"full":"normal"}f();addEventListener("resize",f)})()`;
