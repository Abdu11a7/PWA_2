// Modified to work with new Tailwind classes
Notification.requestPermission().then((permission) => {
  if (permission !== "granted") {
    console.warn("Notification permission not granted.");
  } else {
    console.log("Notification permission granted.");
  }
});

const dbPromise = idb.open("TodoDB", 1, (upgradeDb) => {
  if (!upgradeDb.objectStoreNames.contains("tasks")) {
    const store = upgradeDb.createObjectStore("tasks", {
      keyPath: "id",
      autoIncrement: true,
    });
    store.createIndex("deadline", "deadline");
    store.createIndex("notified", "notified");
  }
});

document.getElementById("todoForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const task = {
    title: document.getElementById("title").value,
    hours: document.getElementById("hours").value,
    minutes: document.getElementById("minutes").value,
    day: document.getElementById("day").value,
    month: document.getElementById("month").value,
    year: document.getElementById("year").value,
    deadline: getDeadlineTimestamp(),
    notified: false,
    completed: false,
  };

  try {
    const db = await dbPromise;
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    await store.add(task);
    await tx.complete;
    document.getElementById("todoForm").reset();
    loadTasks();
  } catch (error) {
    console.error("Error adding task:", error);
  }
});

function getDeadlineTimestamp() {
  return new Date(
    document.getElementById("year").value,
    document.getElementById("month").value - 1,
    document.getElementById("day").value,
    document.getElementById("hours").value,
    document.getElementById("minutes").value
  ).getTime();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((registration) => {
    console.log("Service Worker registered");
    setInterval(() => {
      registration.sync.register("check-deadlines");
    }, 60000);
  });
}
Notification.requestPermission();

async function toggleTask(id) {
  const db = await dbPromise;
  const tx = db.transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");
  const task = await store.get(id);
  await store.put({ ...task, completed: !task.completed });
  await tx.complete;
  loadTasks();
}

async function deleteTask(id) {
  const db = await dbPromise;
  const tx = db.transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");
  await store.delete(id);
  await tx.complete;
  loadTasks();
}

async function loadTasks() {
  try {
    const db = await dbPromise;
    const tx = db.transaction("tasks", "readonly");
    const store = tx.objectStore("tasks");
    const tasks = await store.getAll();
    const list = document.getElementById("todoList");
    list.innerHTML = tasks
      .map(
        (task) => `
      <li class="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg shadow-sm ${
        task.completed ? "opacity-70" : ""
      }">
        <div class="flex-1">
          <span class="${
            task.completed ? "line-through text-gray-500" : "text-gray-800"
          }">${task.title}</span>
          <span class="block text-sm text-gray-500 mt-1">${new Date(
            task.deadline
          ).toLocaleString()}</span>
        </div>
        <div class="flex space-x-2">
          <button onclick="toggleTask(${
            task.id
          })" class="p-2 text-secondary-500 hover:text-secondary-600 rounded-full hover:bg-gray-100">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button onclick="deleteTask(${
            task.id
          })" class="p-2 text-danger-500 hover:text-danger-600 rounded-full hover:bg-gray-100">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </li>
    `
      )
      .join("");
    checkDeadlines();
  } catch (error) {
    console.error("Error loading tasks:", error);
  }
}
setInterval(loadTasks, 5000);

async function checkDeadlines() {
  const now = Date.now();
  try {
    const db = await dbPromise;
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    const index = store.index("deadline");
    let cursor = await index.openCursor(IDBKeyRange.upperBound(now));
    while (cursor) {
      if (!cursor.value.notified) {
        showNotification(cursor.value);
        await store.put({ ...cursor.value, notified: true });
      }
      cursor = await cursor.continue();
    }
  } catch (error) {
    console.error("Deadline check failed:", error);
  }
}

function showNotification(task) {
  if (Notification.permission === "granted") {
    new Notification("Task Deadline Reached!", {
      body: `${task.title} is due now`,
      icon: "/icon.png",
    });
  }
}

window.onload = loadTasks;
