# Opening the Mars globe

Double-click **Open Mars Globe.cmd** to start the standalone local server and open the globe in your browser:

http://127.0.0.1:8765/

This launcher uses Node.js (installed on this computer) and runs independently of Freebuff. You can close Freebuff and continue using the globe. The server listens only on this computer; it does not publish the website online. Launching again reuses the running server. After restarting Windows, double-click the launcher again.

The server runs in the background until Windows shuts down. Closing the browser does not stop it. The **Open Mars Globe.url** shortcut opens the same address but does not start the server; use the **.cmd** launcher when the server is stopped.

Opening index.html directly from File Explorer uses the file:// protocol. Browser security restrictions can prevent Cesium's resources from loading. Cesium recommends serving the application over HTTP instead:

https://github.com/CesiumGS/cesium/blob/main/Documentation/OfflineGuide/README.md

Keep the launcher, local-server.cjs, index.html, style.css, app.js, data-services.js, weather.js, solar-system.js, media-library.js, and data folder together. Internet access is required for Cesium, remote imagery, and NASA media search. Source changes appear when you refresh the browser.

The Freebuff preview uses preview.html, which embeds the source CSS and JavaScript because the built-in single-HTML preview does not serve sibling assets. Run `node scripts/build-preview.cjs` to rebuild that preview after changing the source files; a normal static server can serve index.html and its sibling files directly.

After updating the local server itself, restart its Node process so new asset routes are available. Other source changes only need a browser refresh.
