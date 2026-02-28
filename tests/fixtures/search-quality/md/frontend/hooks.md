---
title: "Custom Hooks Reference"
description: "Reference for common React custom hooks: data fetching, debounce, local storage, and intersection observer."
tags: [react, hooks, useEffect, custom-hooks, useFetch, debounce]
type: reference
category: frontend
---

# Custom Hooks Reference

Custom hooks encapsulate reusable stateful logic. By convention they start with `use`.

## useFetch — Data Fetching

Wraps fetch with loading and error state management:

```typescript
function useFetch(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(res => res.json())
      .then(json => { if (!cancelled) setData(json); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading, error };
}
```

## useDebounce — Debounced Value

Delays propagating a value until the user stops changing it:

```typescript
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
```

## useLocalStorage — Persistent State

Syncs state to localStorage for persistence across page reloads:

```typescript
function useLocalStorage(key, initialValue) {
  const [stored, setStored] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value) => {
    setStored(value);
    window.localStorage.setItem(key, JSON.stringify(value));
  };

  return [stored, setValue];
}
```

## useIntersectionObserver — Lazy Loading

Detects when an element enters the viewport for lazy loading or infinite scroll:

```typescript
function useIntersectionObserver(ref, options) {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      options
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, options]);
  return isVisible;
}
```
