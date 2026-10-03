# Opening the Mars globe

Double-click **Open Mars Globe.url** to open the current local preview in your browser:

http://127.0.0.1:4835/preview.html

This shortcut requires the current Freebuff local preview to be running. It is not an independent server or an offline application.

Opening index.html directly from File Explorer uses the file:// protocol. Browser security restrictions can prevent Cesium's resources from loading. Cesium recommends serving the application over HTTP instead:

https://github.com/CesiumGS/cesium/blob/main/Documentation/OfflineGuide/README.md

For use independently of Freebuff, serve this folder with a static web server (for example, an editor's Live Server feature) and open its HTTP address. Keep index.html, style.css, and app.js together. Internet access is required for Cesium and remote imagery.

The Freebuff preview uses preview.html, which embeds the source CSS and JavaScript because the built-in single-HTML preview does not serve sibling assets. Rebuild that preview after changing the source files; a normal static server can serve index.html and its sibling files directly.
