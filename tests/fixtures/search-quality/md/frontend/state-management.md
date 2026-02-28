---
title: "State Management Guide"
description: "Choosing and using state management in React apps: local state, context, and Zustand."
tags: [react, state, zustand, context, redux, store]
type: guide
category: frontend
---

# State Management Guide

State management controls how data flows and changes in your application.
Choosing the right approach depends on scope and update frequency.

## Local Component State

Use `useState` for UI-only state scoped to a single component:
- Form input values before submission
- Toggle visibility (modal open/closed)
- Loading indicators

```tsx
const [isOpen, setIsOpen] = useState(false);
const [formData, setFormData] = useState({ email: "", password: "" });
```

## React Context for Shared State

Context is suitable for low-frequency global values like theme, locale, or auth user.
Avoid context for high-frequency updates — use a store instead.

```tsx
export const AuthContext = React.createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
```

## Zustand for Application State

Zustand is a lightweight store library that avoids Redux boilerplate while
providing a subscription model that prevents unnecessary re-renders.

```typescript
const useCartStore = create((set, get) => ({
  items: [],
  addItem: (item) => set(state => ({ items: [...state.items, item] })),
  removeItem: (id) => set(state => ({ items: state.items.filter(i => i.id !== id) })),
  total: () => get().items.reduce((sum, i) => sum + i.price * i.qty, 0),
}));
```

## When to Use What

| Scenario | Recommendation |
|---|---|
| Form input state | `useState` |
| Theme / locale | Context |
| Shopping cart, user session | Zustand / Redux |
| Server data with caching | React Query / SWR |
