const CACHE_NAME = "task-manager-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/idb.js",
  "/icon.png",
  "/manifest.json",
  "https://cdn.tailwindcss.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("Cache opened");
        return cache.addAll(ASSETS);
      })
      .then(() => {
        console.log("Assets cached");
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error("Cache installation failed:", err);
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              console.log("Deleting old cache:", cache);
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => {
        console.log("Service worker activated");
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response if found
      if (cachedResponse) {
        return cachedResponse;
      }

      // Otherwise fetch from network
      return fetch(event.request)
        .then((response) => {
          // Don't cache non-200 responses or opaque responses
          if (
            !response ||
            response.status !== 200 ||
            response.type === "opaque"
          ) {
            return response;
          }

          // Clone the response for caching
          const responseToCache = response.clone();

          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, responseToCache))
            .catch((err) => console.error("Cache put error:", err));

          return response;
        })
        .catch((err) => {
          console.error("Fetch failed; returning offline page:", err);
          // Return a fallback response if both cache and network fail
          return caches.match("/offline.html");
        });
    })
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "check-deadlines") {
    console.log("Sync event triggered for deadlines check");
    event.waitUntil(
      checkDeadlines().catch((err) => {
        console.error("Sync task failed:", err);
        // Retry the sync if it fails
        return new Promise((resolve) => {
          setTimeout(() => {
            checkDeadlines().then(resolve).catch(resolve);
          }, 5000);
        });
      })
    );
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
    let notificationsSent = 0;

    while (cursor) {
      if (!cursor.value.notified) {
        await showNotification(cursor.value);
        await store.put({ ...cursor.value, notified: true });
        notificationsSent++;
      }
      cursor = await cursor.continue();
    }

    await tx.complete;
    console.log(`Sent ${notificationsSent} deadline notifications`);
    return notificationsSent;
  } catch (error) {
    console.error("Deadline check failed:", error);
    throw error;
  }
}

async function showNotification(task) {
  if (Notification.permission !== "granted") {
    console.log("Notification permission not granted");
    return;
  }

  const notificationOptions = {
    body: `${task.title} is due now`,
    icon: "/icon.png",
    badge: "/icon.png",
    vibrate: [200, 100, 200, 100, 200],
    data: {
      taskId: task.id,
      url: "/",
    },
    actions: [
      {
        action: "complete",
        title: "Mark Complete",
        icon: "/icons/check.png",
      },
      {
        action: "snooze",
        title: "Snooze 1 Hour",
        icon: "/icons/snooze.png",
      },
    ],
  };

  try {
    await self.registration.showNotification(
      "⏰ Task Deadline Reached!",
      notificationOptions
    );
    console.log("Notification shown for task:", task.title);
  } catch (err) {
    console.error("Failed to show notification:", err);
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "complete") {
    // Handle mark as complete action
    clients.openWindow("/").then((windowClient) => {
      windowClient.postMessage({
        action: "completeTask",
        taskId: event.notification.data.taskId,
      });
    });
  } else if (event.action === "snooze") {
    // Handle snooze action
    clients.openWindow("/").then((windowClient) => {
      windowClient.postMessage({
        action: "snoozeTask",
        taskId: event.notification.data.taskId,
      });
    });
  } else {
    // Default click behavior
    clients.openWindow(event.notification.data.url);
  }
});

self.addEventListener("message", (event) => {
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
