/* Guard for the single-file build: service workers and the manifest only exist
   on a real server, so skip them quietly when the page runs from file://. */
(() => {
  if (!location.protocol.startsWith("http")) {
    for (const el of document.querySelectorAll('link[rel="manifest"]')) el.remove();
  }
})();
