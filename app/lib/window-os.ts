// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Runs in <head> before the first paint (WON-232). On macOS it sets
 * `data-os="mac"` on <html>, so the controls in the window's round bottom
 * corners can follow the curve (postal.css, `--window-corner`). iPads report
 * a Mac platform and are left out by their touch points.
 *
 * `data-window` says whether the page reaches those corners: "normal" when it
 * does, "full" in macOS full screen (square corners), and "framed" when the
 * page is more than FRAMED_GAP px narrower than the window, because vertical
 * tabs, a side panel or docked DevTools sit beside it. Zooming in also reads
 * as framed. The corners follow the curve only when it is "normal".
 */
export const FRAMED_GAP = 16;

export const WINDOW_OS_SCRIPT = `(function(){var d=document.documentElement,n=navigator,p=(n.userAgentData&&n.userAgentData.platform)||n.platform||"";if(!/mac/i.test(p)||n.maxTouchPoints>1)return;d.dataset.os="mac";function f(){d.dataset.window=outerWidth>=screen.width&&outerHeight>=screen.height?"full":outerWidth-innerWidth>${FRAMED_GAP}?"framed":"normal"}f();addEventListener("resize",f)})()`;
