import time

class SimpleCache:
    def __init__(self, ttl=300):
        self.store = {}
        self.ttl = ttl

    def get(self, key):
        item = self.store.get(key)
        if not item:
            return None
        value, expiry = item
        if time.time() > expiry:
            del self.store[key]
            return None
        return value

    def set(self, key, value):
        self.store[key] = (value, time.time() + self.ttl)

cache = SimpleCache()