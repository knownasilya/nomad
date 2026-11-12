// <nomad-genui> by itself, for a nomad:// page that isn't bundled (the home page, ADR-0048).
// scripts/build.js builds it to app/userland/app-stdlib/js/genui.build.js; the page loads that
// with a <script> and uses the element like the AI Sidebar does.

import '../shell-window/genui/index.js';
