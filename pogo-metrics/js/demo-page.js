/* demo-page.js — marks demo.html as the Live Example before app.js runs.
 *
 * This was an inline <script>window.DEMO_PAGE = true;</script>. As a file it
 * lets the Content-Security-Policy allow scripts from 'self' only, with no
 * 'unsafe-inline'. demo.html loads it with `defer` ahead of app.js, and
 * deferred scripts run in document order, so app.js still sees the flag set
 * before its first line runs. */
window.DEMO_PAGE = true;
