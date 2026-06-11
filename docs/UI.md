# Param Agent UI And Mini Apps

This file defines how Param renders generated UI through Telegram.

Param does not need a standalone app. UI exists only when the agent decides a
Telegram conversation needs richer controls than plain chat.

## Goal

Param can talk with plain text, but some interactions need richer UI:

- approval buttons
- status cards
- forms
- settings screens
- image or file pickers
- task progress views
- dashboards
- Telegram Mini Apps

The actor decides when UI would help. The UI system decides how to render it
safely.

## Core Rule

Actors emit structured UI specs.

They do not emit arbitrary frontend code.

```text
actor intent
  -> render_ui output
  -> schema validation
  -> UI Renderer
  -> Channel Adapter
  -> Telegram message, buttons, Mini App, or artifact
```

This keeps generated UI useful without letting a model invent unsafe code paths.

## Preferred Web Renderer

For Telegram Mini App pages, Param should prefer Vercel AI SDK UI's structured
object and generative UI patterns.

Practical meaning:

- Param core emits a JSON UI spec.
- Zod validates the spec.
- The Mini App renderer maps the spec to known React components.
- shadcn/ui provides the default React component system.
- Mini Apps can stream or render structured objects.
- The actor never writes raw JSX, HTML, or browser JavaScript.

When people say "JSON render" in Param docs, it means this pattern:

```text
validated Param UI JSON
  -> Vercel AI SDK UI object/generative UI renderer
  -> repository-owned shadcn/ui React components
```

The Vercel layer is an implementation choice for Telegram Mini App pages. The
Param contract stays channel-neutral so Telegram buttons, plain text fallback,
and future chat channels still work.

## shadcn/ui Component Layer

Param should use shadcn/ui for Telegram Mini App pages.

Why it fits:

- components live as source code in the app
- components are composable
- styling can follow a consistent design system
- forms, cards, dialogs, sheets, buttons, tables, badges, charts, and toasts
  are already covered
- LLM-assisted coding can inspect and modify the actual component code

The actor does not choose arbitrary shadcn components at runtime. The actor
chooses a Param UI schema. The renderer maps that schema to approved shadcn
components.

Example mapping:

```text
param.card
  -> Card, Badge, Button

param.form
  -> Field, Input, Select, Checkbox, Switch, Button

param.action_list
  -> Card, Button, DropdownMenu, AlertDialog

param.status
  -> Card, Progress, Badge, Table

param.settings
  -> Tabs, Field, Switch, Select, Slider

param.media_picker
  -> Dialog or Sheet, ScrollArea, Button, Skeleton
```

shadcn components are added by the project CLI during implementation. Runtime
actors do not install, overwrite, or generate component files without normal
Action Review.

## Agent Theme Tuning

Param can let the actor tune the style of generated UI by changing approved
shadcn theme tokens.

This should be token-based, not CSS-based.

Allowed:

- choose an existing theme profile
- set per-surface theme tokens
- adjust semantic colors
- adjust chart colors
- adjust radius within bounds
- choose light, dark, or automatic mode

Not allowed from actor output:

- raw CSS selectors
- arbitrary `className` strings
- inline styles
- external fonts from unknown URLs
- arbitrary Tailwind utility strings
- editing component source files directly
- changing global CSS files without Action Review

Theme tuning flow:

```text
actor render_ui output
  -> optional theme patch
  -> theme schema validation
  -> contrast/accessibility checks
  -> UI Renderer applies CSS variables to this surface
```

Per-surface theme patches are temporary. They affect only one generated UI
surface.

Persistent theme changes are different. If the actor wants to change the
default Mini App theme or a saved theme profile, it must propose a
state-changing action and go through Action Review.

## Theme Patch Shape

Theme patches use shadcn semantic tokens.

```ts
type UiThemePatch = {
  system: "shadcn-css-variables";
  scope: "surface" | "session" | "profile" | "global";
  mode?: "light" | "dark" | "auto";
  tokens?: Partial<Record<ShadcnThemeToken, string>>;
  radius?: string;
  reason?: string;
};

type ShadcnThemeToken =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5";
```

Token values should support safe color formats such as `oklch(...)` and hex.
The validator should reject invalid CSS, URLs, functions other than approved
color syntax, and suspicious strings.

Radius must be bounded.

Example:

```json
{
  "system": "shadcn-css-variables",
  "scope": "surface",
  "mode": "dark",
  "tokens": {
    "background": "oklch(0.16 0.02 245)",
    "foreground": "oklch(0.98 0.01 240)",
    "primary": "oklch(0.72 0.16 210)",
    "primary-foreground": "oklch(0.12 0.02 240)",
    "card": "oklch(0.2 0.025 245)",
    "card-foreground": "oklch(0.98 0.01 240)"
  },
  "radius": "0.75rem",
  "reason": "match the generated dashboard mood without changing global theme"
}
```

## Theme Profiles

Theme profiles are named presets stored in the database or config.

Examples:

```text
default
compact
playful
terminal
high-contrast
image-gallery
approval-review
```

The actor can choose a profile for a generated surface if the profile is
enabled for that channel.

Creating, editing, or deleting a shared profile is a state-changing action.
That requires Action Review.

## Surfaces

Param supports several UI surfaces.

Text message:
  normal chat output

Reaction:
  one platform reaction on a specific message

Inline buttons:
  compact actions under a chat message

Card-like message:
  structured text with buttons, status, metadata, or links

Form:
  structured input rendered as a Telegram Mini App

Mini App:
  richer web surface launched inside Telegram

Artifact:
  generated file, image, report, or page linked from chat

## UI Renderer

The UI Renderer is deterministic code.

It owns:

- UI schema validation
- per-schema limits
- platform mapping
- callback metadata
- callback expiry
- Mini App page selection
- safe fallback rendering
- audit records for generated surfaces

It does not decide the social meaning of a message. The Session Actor decides
whether a UI is appropriate.

## Render Flow

1. Actor emits `render_ui`.
2. Validator checks the output shape.
3. UI Renderer validates `schema`, `specVersion`, `target`, and `spec`.
4. UI Renderer stores a `ui_surface` record.
5. UI Renderer stores callback records with session, actor run, expiry, and
   original intent.
6. Channel Adapter renders the safest available platform surface.
7. User interaction becomes a new event.
8. Orchestrator routes the event to the right session.
9. Actor sees the event in context and decides what it means.
10. Consequential callback actions go through Action Review.

## UI Specs

Initial schemas:

```text
param.card
  short structured message with optional fields and buttons

param.form
  validated input form

param.action_list
  list of possible actions, each with callback metadata

param.status
  task or system status view

param.media_picker
  image/file selection surface

param.settings
  configurable settings surface

param.mini_app
  launch or update a Mini App surface

param.theme_patch
  optional shadcn CSS variable override for one UI surface
```

Every schema needs a Zod validator.

Schema validators should enforce:

- max JSON size
- allowed component types
- required labels
- max label length
- max buttons per row
- max rows
- callback count
- callback expiry
- target session
- whether the surface can appear in a group
- allowed theme tokens
- color value validity
- contrast minimums for foreground/background token pairs
- radius bounds

## Generative UI Pattern

Param should treat generative UI as tool/data driven UI.

The model chooses a UI tool and fills a structured spec. Deterministic code
renders that spec.

This matches the useful part of Vercel AI SDK generative UI: the model calls
tools, and UI is connected to tool results. Param adapts that idea to messaging
channels by using JSON specs and channel renderers instead of model-generated
JSX.

For Mini Apps, the renderer can also use AI SDK UI object generation patterns:
stream a structured object, validate it with Zod, and render partial state with
known components.

## Telegram Mini Apps

Telegram Mini Apps are web pages launched inside Telegram.

Use Mini Apps when chat buttons are too small:

- multi-step forms
- generated controls
- media browsing
- task dashboards
- approval detail views
- structured settings
- shared group surfaces

Do not use Mini Apps for simple yes/no approvals or tiny actions. Inline
buttons are better for those.

Mini Apps require a public HTTPS web surface. Telegram polling can still be the
bot update transport while Mini Apps use HTTPS for the web page.

## Mini App Launch Modes

Param should support these modes over time:

Inline button:
  launch a Mini App from a message button

Keyboard button:
  launch a Mini App from a custom keyboard button

Bot menu button:
  launch a configured app from the Telegram menu

Direct link:
  launch from a `t.me` link with a start parameter

Main Mini App:
  launch from the bot profile

Attachment menu:
  future mode for media-heavy workflows

Inline mode:
  future mode for creating content and sending it to a selected chat

Initial implementation can focus on inline buttons and direct links.

## Mini App Auth

Mini App input is untrusted until validated.

The Telegram channel adapter must:

- validate Telegram init data server-side
- verify the hash with the bot token or supported third-party validation method
- bind the Mini App request to a known `surfaceId`
- bind the user to a platform user id
- bind the result to the original session when Telegram provides chat context
- reject expired or unknown surfaces
- reject callback replay

The actor should never receive raw unvalidated Mini App data.

## Callbacks

Callbacks are events, not direct function calls.

Callback event shape:

```text
callback id
surface id
session id
platform user id
original actor run id
callback value
created at
expires at
```

When a user clicks a button:

1. Channel Adapter receives the platform callback.
2. UI Renderer loads the stored callback metadata.
3. Validator checks expiry, identity, target session, and payload shape.
4. Orchestrator creates a `chat.callback` or `chat.mini_app.result` event.
5. Actor interprets the callback in session context.
6. Action Review gates consequential effects.

## Approvals

Approval UI is just one kind of UI.

Approval buttons can make the interaction nicer, but the reply text path must
also work:

```text
approve
deny
ignore
```

Action Review owns approval truth. UI callbacks only carry the user's response.

## Safety Rules

UI specs are untrusted actor output until validated.

Rules:

- no arbitrary JavaScript from actors
- no arbitrary HTML from actors
- no raw SQL or shell commands in UI specs
- no secret values in UI specs
- callbacks expire
- callback payloads are small
- callback actions are rechecked at click time
- Mini App result payloads are validated before actor context
- group surfaces include exact session and actor-run provenance

## Fallbacks

Every UI schema should have a text fallback.

Examples:

- a card can render as a formatted chat message
- an action list can render as numbered choices
- a form can ask for fields one message at a time
- a Mini App launch can fall back to a public artifact link or plain prompt

Fallbacks matter because not every channel supports buttons, callbacks, or
Mini Apps.

## Config

UI config belongs in typed config.

```ts
type UiConfig = {
  renderer: {
    maxSpecBytes: number;
    allowedSchemas: string[];
    callbackTtlSeconds: number;
    maxCallbacksPerSurface: number;
    webRenderer: "vercel-ai-sdk-ui";
    componentSystem: "shadcn-ui";
    allowThemePatches: boolean;
    allowedThemeScopes: ("surface" | "session" | "profile" | "global")[];
    allowedThemeTokens: ShadcnThemeToken[];
    maxThemePatchBytes: number;
  };
  miniApps: {
    enabled: boolean;
    requirePublicHttps: boolean;
    publicBaseUrl?: string | { env: string };
    defaultTtlSeconds: number;
  };
};
```

Secrets stay in `.env`. Public URLs and feature flags can live in typed config.

## Tests

UI tests should cover:

- valid specs render on supported channels
- invalid specs are rejected
- oversized specs are rejected
- callbacks expire
- callback replay fails
- callback user identity is checked
- Mini App init data is validated
- consequential callbacks require Action Review
- text fallback exists for every schema
- actor cannot inject arbitrary code through UI specs
- actor can tune approved shadcn tokens for one surface
- actor cannot inject raw CSS or arbitrary classes through theme tuning
- invalid theme values are rejected
- low-contrast token pairs are rejected or repaired
- persistent theme changes require Action Review

## References

- Telegram Mini Apps: `https://core.telegram.org/bots/webapps`
- Telegram Bot API: `https://core.telegram.org/bots/api`
- AI SDK generative UI: `https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces`
- AI SDK object generation: `https://ai-sdk.dev/docs/ai-sdk-ui/object-generation`
- shadcn/ui docs: `https://ui.shadcn.com/docs`
- shadcn/ui theming: `https://ui.shadcn.com/docs/theming`
