(function (root) {
  'use strict';
  const memory = new Map();
  root.WordWorkshopWebStorage = {
    async get(key) {
      try { const value = localStorage.getItem('wordworkshop:' + key); return { [key]: value ? JSON.parse(value) : memory.get(key) }; }
      catch { return { [key]: memory.get(key) }; }
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        memory.set(key, value);
        try { localStorage.setItem('wordworkshop:' + key, JSON.stringify(value)); } catch { /* Continue with session memory when storage is full or unavailable. */ }
      }
    },
  };
})(globalThis);
