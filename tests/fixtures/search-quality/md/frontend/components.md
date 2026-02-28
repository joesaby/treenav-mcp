---
title: "Component Architecture"
description: "Design principles for reusable UI components using React."
tags: [react, components, props, composition, ui]
type: guide
category: frontend
---

# Component Architecture

A component-based UI architecture breaks the interface into isolated, reusable units.
Each component manages its own rendering logic and exposes a well-defined props API.

## Component Types

### Presentational Components

Presentational components focus purely on rendering. They receive all data via props
and emit events via callback props. They have no direct access to application state.

```tsx
interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick: () => void;
}

export function Button({ label, variant = "primary", disabled, onClick }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
```

### Container Components

Container components fetch data, manage local state, and pass data down to presentational
components. They are the boundary between the data layer and the UI layer.

### Compound Components

Compound components use React context to share state across related sub-components
without prop drilling:

```tsx
const TabContext = React.createContext(null);

export function Tabs({ children, defaultTab }) {
  const [active, setActive] = React.useState(defaultTab);
  return (
    <TabContext.Provider value={{ active, setActive }}>
      {children}
    </TabContext.Provider>
  );
}
```

## Props Design

- **Prefer composition over configuration** — instead of a 20-prop modal, use children.
- **Use discriminated unions for variant props** — `type: "success" | "error" | "warning"`.
- **Callback naming** — prefix with `on`: `onSubmit`, `onChange`, `onClose`.

## Component Lifecycle and Cleanup

Components that subscribe to external data sources must clean up their subscriptions
in the `useEffect` cleanup function to prevent memory leaks.
