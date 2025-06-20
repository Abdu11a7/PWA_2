/**
 * Enhanced IndexedDB Wrapper
 * @version 2.0
 * @license Apache-2.0
 */
"use strict";

(function () {
  // Utility functions
  const toArray = (arr) => Array.prototype.slice.call(arr);

  const isObject = (val) => val !== null && typeof val === "object";

  const createError = (message, error) => {
    const err = new Error(message);
    if (error) {
      err.stack = error.stack;
      err.originalError = error;
    }
    return err;
  };

  // Enhanced promisification
  const promisifyRequest = (request) => {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        const error = createError(
          `IDBRequest failed: ${request.error?.message || "Unknown error"}`,
          request.error
        );
        reject(error);
      };

      request.onblocked = () => {
        reject(createError("Database operation blocked"));
      };
    });
  };

  const promisifyRequestCall = (obj, method, args) => {
    let request;
    const p = new Promise((resolve, reject) => {
      try {
        request = obj[method].apply(obj, args);
        promisifyRequest(request).then(resolve, reject);
      } catch (err) {
        reject(
          createError(`IDB operation threw synchronously: ${err.message}`, err)
        );
      }
    });

    p.request = request;
    return p;
  };

  const promisifyCursorRequestCall = (obj, method, args) => {
    const p = promisifyRequestCall(obj, method, args);
    return p.then((value) => {
      if (!value) return null;
      return new Cursor(value, p.request);
    });
  };

  // Proxy utilities
  const proxyProperties = (ProxyClass, targetProp, properties) => {
    properties.forEach((prop) => {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get() {
          return this[targetProp][prop];
        },
        enumerable: true,
        configurable: true,
      });
    });
  };

  const proxyRequestMethods = (
    ProxyClass,
    targetProp,
    Constructor,
    properties
  ) => {
    properties.forEach((prop) => {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function (...args) {
        return promisifyRequestCall(this[targetProp], prop, args);
      };
    });
  };

  const proxyMethods = (ProxyClass, targetProp, Constructor, properties) => {
    properties.forEach((prop) => {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function (...args) {
        return this[targetProp][prop].apply(this[targetProp], args);
      };
    });
  };

  const proxyCursorRequestMethods = (
    ProxyClass,
    targetProp,
    Constructor,
    properties
  ) => {
    properties.forEach((prop) => {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function (...args) {
        return promisifyCursorRequestCall(this[targetProp], prop, args);
      };
    });
  };

  // Enhanced Index class
  class Index {
    constructor(index) {
      this._index = index;
    }

    // Add bulk operations
    bulkGet(keys) {
      if (!Array.isArray(keys)) {
        return Promise.reject(createError("Keys must be an array"));
      }

      return Promise.all(keys.map((key) => this.get(key)));
    }
  }

  proxyProperties(Index, "_index", ["name", "keyPath", "multiEntry", "unique"]);
  proxyRequestMethods(Index, "_index", IDBIndex, [
    "get",
    "getKey",
    "getAll",
    "getAllKeys",
    "count",
  ]);
  proxyCursorRequestMethods(Index, "_index", IDBIndex, [
    "openCursor",
    "openKeyCursor",
  ]);

  // Enhanced Cursor class
  class Cursor {
    constructor(cursor, request) {
      this._cursor = cursor;
      this._request = request;
    }

    // Add iteration helpers
    async *[Symbol.asyncIterator]() {
      let cursor = this;
      while (cursor) {
        yield cursor;
        cursor = await cursor.continue();
      }
    }

    // Add batch processing
    async processBatch(batchSize, processor) {
      let cursor = this;
      let processed = 0;

      while (cursor) {
        await processor(cursor.value, cursor.key, cursor);
        processed++;

        if (batchSize && processed >= batchSize) {
          break;
        }

        cursor = await cursor.continue();
      }

      return processed;
    }
  }

  proxyProperties(Cursor, "_cursor", [
    "direction",
    "key",
    "primaryKey",
    "value",
  ]);
  proxyRequestMethods(Cursor, "_cursor", IDBCursor, ["update", "delete"]);

  // Add cursor movement methods
  ["advance", "continue", "continuePrimaryKey"].forEach((methodName) => {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function (...args) {
      return Promise.resolve().then(() => {
        this._cursor[methodName].apply(this._cursor, args);
        return promisifyRequest(this._request).then((value) => {
          if (!value) return null;
          return new Cursor(value, this._request);
        });
      });
    };
  });

  // Enhanced ObjectStore class
  class ObjectStore {
    constructor(store) {
      this._store = store;
    }

    createIndex(...args) {
      return new Index(this._store.createIndex.apply(this._store, args));
    }

    index(...args) {
      return new Index(this._store.index.apply(this._store, args));
    }

    // Add bulk operations
    async bulkAdd(items) {
      if (!Array.isArray(items)) {
        throw createError("Items must be an array");
      }

      const tx = this._store.transaction;
      const results = [];

      for (const item of items) {
        try {
          results.push(await this.add(item));
        } catch (err) {
          if (tx.mode !== "readwrite") {
            throw createError(
              "Bulk operations require a readwrite transaction"
            );
          }
          throw err;
        }
      }

      return results;
    }

    async bulkPut(items) {
      if (!Array.isArray(items)) {
        throw createError("Items must be an array");
      }

      const tx = this._store.transaction;
      const results = [];

      for (const item of items) {
        try {
          results.push(await this.put(item));
        } catch (err) {
          if (tx.mode !== "readwrite") {
            throw createError(
              "Bulk operations require a readwrite transaction"
            );
          }
          throw err;
        }
      }

      return results;
    }
  }

  proxyProperties(ObjectStore, "_store", [
    "name",
    "keyPath",
    "indexNames",
    "autoIncrement",
  ]);
  proxyRequestMethods(ObjectStore, "_store", IDBObjectStore, [
    "put",
    "add",
    "delete",
    "clear",
    "get",
    "getAll",
    "getAllKeys",
    "count",
  ]);
  proxyCursorRequestMethods(ObjectStore, "_store", IDBObjectStore, [
    "openCursor",
    "openKeyCursor",
  ]);
  proxyMethods(ObjectStore, "_store", IDBObjectStore, ["deleteIndex"]);

  // Enhanced Transaction class
  class Transaction {
    constructor(idbTransaction) {
      this._tx = idbTransaction;
      this._aborted = false;

      this.complete = new Promise((resolve, reject) => {
        idbTransaction.oncomplete = () => resolve();
        idbTransaction.onabort = () => {
          this._aborted = true;
          reject(createError("Transaction was aborted", idbTransaction.error));
        };
        idbTransaction.onerror = () => {
          reject(
            createError(
              "Transaction encountered an error",
              idbTransaction.error
            )
          );
        };
      });
    }

    objectStore(...args) {
      if (this._aborted) {
        throw createError("Cannot use objectStore on aborted transaction");
      }
      return new ObjectStore(this._tx.objectStore.apply(this._tx, args));
    }

    // Add timeout functionality
    withTimeout(timeout) {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
      }

      return new Promise((resolve, reject) => {
        this._timeoutId = setTimeout(() => {
          this.abort();
          reject(createError(`Transaction timed out after ${timeout}ms`));
        }, timeout);

        this.complete
          .then((result) => {
            clearTimeout(this._timeoutId);
            resolve(result);
          })
          .catch(reject);
      });
    }
  }

  proxyProperties(Transaction, "_tx", ["objectStoreNames", "mode"]);
  proxyMethods(Transaction, "_tx", IDBTransaction, ["abort"]);

  // Enhanced UpgradeDB class
  class UpgradeDB {
    constructor(db, oldVersion, transaction) {
      this._db = db;
      this.oldVersion = oldVersion;
      this.transaction = new Transaction(transaction);
      this._migrationHandlers = new Map();
    }

    createObjectStore(...args) {
      return new ObjectStore(this._db.createObjectStore.apply(this._db, args));
    }

    // Add migration helpers
    onVersionChange(fromVersion, toVersion, handler) {
      if (this.oldVersion >= fromVersion && this.oldVersion < toVersion) {
        this._migrationHandlers.set(fromVersion, handler);
      }
      return this;
    }

    runMigrations() {
      const migrations = Array.from(this._migrationHandlers.entries()).sort(
        ([a], [b]) => a - b
      );

      return migrations.reduce((chain, [version, handler]) => {
        return chain.then(() => handler(this));
      }, Promise.resolve());
    }
  }

  proxyProperties(UpgradeDB, "_db", ["name", "version", "objectStoreNames"]);
  proxyMethods(UpgradeDB, "_db", IDBDatabase, ["deleteObjectStore", "close"]);

  // Enhanced DB class
  class DB {
    constructor(db) {
      this._db = db;
      this._listeners = new Map();

      db.onversionchange = () => {
        this._emit("versionchange");
      };

      db.onclose = () => {
        this._emit("close");
      };
    }

    transaction(...args) {
      return new Transaction(this._db.transaction.apply(this._db, args));
    }

    // Add event emitter functionality
    on(event, listener) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, new Set());
      }
      this._listeners.get(event).add(listener);
      return this;
    }

    off(event, listener) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).delete(listener);
      }
      return this;
    }

    _emit(event, ...args) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).forEach((listener) => {
          try {
            listener(...args);
          } catch (err) {
            console.error(`Error in ${event} listener:`, err);
          }
        });
      }
    }
  }

  proxyProperties(DB, "_db", ["name", "version", "objectStoreNames"]);
  proxyMethods(DB, "_db", IDBDatabase, ["close"]);

  // Add cursor iterators
  ["openCursor", "openKeyCursor"].forEach((funcName) => {
    [ObjectStore, Index].forEach((Constructor) => {
      const iteratorName = funcName.replace("open", "iterate");
      Constructor.prototype[iteratorName] = function (...args) {
        const callback = args[args.length - 1];
        const request = (this._store || this._index)[funcName].apply(
          this._store || this._index,
          args.slice(0, -1)
        );
        request.onsuccess = () => callback(request.result);
      };
    });
  });

  // Enhanced getAll polyfill with better type checking
  [Index, ObjectStore].forEach((Constructor) => {
    if (Constructor.prototype.getAll) return;

    Constructor.prototype.getAll = function (query, count) {
      const instance = this;
      const items = [];

      return new Promise((resolve, reject) => {
        if (count !== undefined && (typeof count !== "number" || count < 0)) {
          reject(createError("Count must be a non-negative number"));
          return;
        }

        instance.iterateCursor(query, (cursor) => {
          if (!cursor) {
            resolve(items);
            return;
          }

          items.push(cursor.value);

          if (count !== undefined && items.length >= count) {
            resolve(items);
            return;
          }

          cursor.continue();
        });
      });
    };
  });

  // Enhanced exports with additional utilities
  const exp = {
    open(name, version, upgradeCallback) {
      const p = promisifyRequestCall(indexedDB, "open", [name, version]);
      const request = p.request;

      request.onupgradeneeded = (event) => {
        if (upgradeCallback) {
          const upgradeDB = new UpgradeDB(
            request.result,
            event.oldVersion,
            request.transaction
          );
          upgradeCallback(upgradeDB);

          // Run migrations if any were registered
          if (upgradeDB._migrationHandlers.size > 0) {
            upgradeDB.runMigrations().catch((err) => {
              console.error("Migration failed:", err);
              request.transaction.abort();
            });
          }
        }
      };

      request.onblocked = () => {
        console.warn(`Database ${name} is blocked from version ${version}`);
      };

      return p.then((db) => new DB(db));
    },

    delete(name) {
      return promisifyRequestCall(indexedDB, "deleteDatabase", [name]);
    },

    // Database existence check
    exists(name) {
      return new Promise((resolve) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => {
          req.result.close();
          resolve(true);
        };
        req.onerror = () => resolve(false);
      });
    },

    // Database version check
    getVersion(name) {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => {
          const version = req.result.version;
          req.result.close();
          resolve(version);
        };
        req.onerror = () => reject(req.error);
      });
    },

    // Utility for clearing all object stores
    async clearDatabase(name) {
      const db = await this.open(name);
      try {
        const tx = db.transaction(db.objectStoreNames, "readwrite");
        await Promise.all(
          Array.from(db.objectStoreNames).map((name) =>
            tx.objectStore(name).clear()
          )
        );
        await tx.complete;
      } finally {
        db.close();
      }
    },
  };

  // Export based on environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exp;
  } else if (typeof define === "function" && define.amd) {
    define([], () => exp);
  } else {
    self.idb = exp;
  }
})();
