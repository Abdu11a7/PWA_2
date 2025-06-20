importScripts("idb.js");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("todo-v1").then((cache) => {
      return cache.addAll([
        "/",
        "/index.html",
        "/styles.css",
        "/app.js",
        "/idb.js",
      ]);
    })
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "check-deadlines") {
    event.waitUntil(checkDeadlines());
  }
});

async function checkDeadlines() {
  try {
    const now = Date.now();
    const db = await idb.open("TodoDB", 1);
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    const index = store.index("deadline");

    let cursor = await index.openCursor(IDBKeyRange.upperBound(now));
    while (cursor) {
      if (!cursor.value.notified) {
        await showNotification(cursor.value);
        await store.put({ ...cursor.value, notified: true });
      }
      cursor = await cursor.continue();
    }
    await tx.complete;
  } catch (error) {
    console.error("SW Deadline Check Error:", error);
  }
}

async function showNotification(task) {
  if (Notification.permission === "granted") {
    await self.registration.showNotification("Deadline Passed!", {
      body: `${task.title} is due now`,
      icon: "/icon.png",
      vibrate: [200, 100, 200],
    });
  }
}
