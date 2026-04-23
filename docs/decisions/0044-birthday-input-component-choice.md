# 0044. Birthday Input Component Choice

- Status: accepted
- Date: 2026-04-22
- Deciders: PO, Dev Team

## Context and Problem Statement

The child creation and editing forms use a native `<input type="date">` for birthday entry. This presents several UX and design consistency issues:
1.  **Default Focus**: The date picker defaults to the current date, forcing users to navigate back in time, which is a poor user experience as most children's birthdays are in the past.
2.  **UI Inconsistency**: The appearance of the date picker varies significantly across different browsers (Chrome, Firefox, Safari) and operating systems, undermining the application's consistent brand identity.
3.  **Poor UX Flow**: The typical flow (e.g., in Chrome) requires users to first change the year through a dropdown, then select the month and day. This is not an intuitive or efficient way to enter a birthdate.

We need a solution that provides a consistent, branded, and user-friendly experience for entering a birthdate across all platforms.

## Decision Drivers

- **UX Improvement**: The new component should guide the user to enter the year first and not default to the current date.
- **Design Consistency**: The component must use the project's design system primitives and look the same in all supported browsers.
- **Scope Management (Pre-PMF)**: Avoid introducing new, large third-party libraries if a simpler solution with existing primitives is feasible (ADR-0010).
- **Maintainability**: The solution should be easy to understand and maintain.

## Considered Options

1.  **Three NativeSelects**: Create a `BirthdayInput.svelte` wrapper component composed of three separate `<NativeSelect>` primitives for year, month, and day.
2.  **Ark UI DatePicker**: Utilize the DatePicker primitive from Ark UI, which is already a dependency.
3.  **Third-party Library**: Integrate a dedicated Svelte date picker library like `date-picker-svelte`.

### Option 1: Three NativeSelects
- **Pros**:
    - Excellent cross-browser consistency as it uses existing, styled primitives.
    - Full control over the UX flow (year-first selection).
    - No new dependencies.
- **Cons**:
    - Requires manual implementation of date logic (e.g., days in month, leap years).

### Option 2: Ark UI DatePicker
- **Pros**:
    - Consistent with other Ark UI components in the project.
- **Cons**:
    - The current version of Ark UI's DatePicker does not easily support customizing the year navigation to be the primary interaction. The calendar view is always central, which doesn't fully solve the UX problem of navigating back from the current date.

### Option 3: Third-party Library
- **Pros**:
    - Likely feature-rich.
- **Cons**:
    - Adds a new dependency to the project, increasing bundle size and maintenance overhead.
    - Svelte 5 compatibility is not always guaranteed.
    - May not perfectly match the project's design system.

## Decision Outcome

Chosen option: **"Option 1: Three NativeSelects"**, because it provides the best balance of UX control, design consistency, and scope management.

By creating a dedicated `BirthdayInput.svelte` component, we solve the immediate UX problems and maintain full control over the component's appearance and behavior. While it requires some manual date logic, this logic is well-defined and can be thoroughly tested.

This approach aligns with our Pre-PMF strategy of preferring simple, custom solutions built from our existing primitives over introducing new, complex dependencies. If a more advanced, fully-featured date picker becomes necessary post-PMF, we can revisit this decision and potentially replace this component with a more robust primitive (like an improved Ark UI DatePicker).

### Implementation Sketch

```svelte
<!-- src/lib/ui/primitives/BirthdayInput.svelte -->
<script lang="ts">
  // Component logic with three NativeSelects for year, month, and day.
  // It will handle leap years and the number of days in a month.
  // It will expose a bindable `value` prop (YYYY-MM-DD string).
</script>

<div class="birthday-input-wrapper">
  <NativeSelect label="Year" ... />
  <NativeSelect label="Month" ... />
  <NativeSelect label="Day" ... />
</div>
```
