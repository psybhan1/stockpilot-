# Modifier-key conventions for recipe composition

This doc is the canonical reference for the string keys that link POS
modifiers (on sale lines) to `RecipeComponent.modifierKey` rows — the
mechanism that lets one recipe deplete different inventory depending on
what the customer ordered.

## Why keys matter

`processSaleEventById` only depletes a component if its `modifierKey`
is either null (always applies) or matches one of the `modifierKeys`
on the POS sale line. Consistent naming between the two sides is the
whole game: an iced latte that arrives as `modifierKeys: ["iced"]`
will not match a recipe component keyed `temp:iced` and the cold cup
won't deplete.

## Shape: `<category>:<value>`

All keys lowercase, kebab-case values, colon separator:

```
<category>:<value>
```

Never punctuation other than `:` and `-`. No spaces, no underscores.

## Standard categories

| Category | Examples | Used for |
|---|---|---|
| `temp` | `temp:hot`, `temp:iced`, `temp:frozen` | Hot vs iced swaps (cup, ice) |
| `milk` | `milk:dairy`, `milk:oat`, `milk:almond`, `milk:soy`, `milk:coconut` | Dairy-alternative ingredient swaps |
| `shot` | `shot:single`, `shot:double`, `shot:extra`, `shot:decaf` | Extra espresso, decaf swaps |
| `size` | `size:small`, `size:medium`, `size:large`, `size:xl` | Cup/lid tier, quantity scaling |
| `syrup` | `syrup:vanilla`, `syrup:caramel`, `syrup:hazelnut`, `syrup:sugar-free` | Optional flavour additions |
| `sweet` | `sweet:honey`, `sweet:stevia`, `sweet:agave` | Sweetener options |
| `topping` | `topping:whip`, `topping:cocoa`, `topping:cinnamon` | Finishers |
| `prep` | `prep:extra-hot`, `prep:half-caf`, `prep:light-ice` | Barista-side adjustments |

## How StockBuddy (AI) uses them

- The chat system prompt instructs Groq to always return keys in this
  format when the manager describes a modifier rule. When the user
  says "when iced, use a cold cup," Groq emits
  `modifierKey: "temp:iced"` on the cold-cup component.
- On initial drafts, Groq leaves `modifierKey: null` on every
  component — modifiers come up during chat edits.

## How to match to your POS

Square, Clover, and Shopify all pass modifier info on each sale line.
To make the POS → recipe link work:

1. In the POS, assign a stable modifier "value" (Square calls it
   `modifier.name` → slugified, e.g. "Oat Milk" → `oat`).
2. Prepend the category and colon: `milk:oat`.
3. Tell StockBuddy the rule in chat: *"when oat milk is selected, swap
   whole milk for oat milk."*
4. On the next sale with the Oat Milk modifier, the oat-milk component
   fires and whole milk stays put.

The webhook normaliser in `src/providers/pos/square.ts` already
lowercases + slugifies Square's modifier names; you only need to
ensure the POS modifier group name maps cleanly to one of the
categories above.

## Edge cases

- **No category match?** Pick the closest one and note it in the
  component's `notes` field so future edits stay consistent.
- **Multiple conditions on one component?** Not supported — split into
  two components with different keys.
- **"Always unless X"?** Model it as two components: one with the
  X-modifier key, one without. At sale time only one will match.

## Adding new categories

Add the row here + update `buildEditSystemPrompt` in
`src/modules/recipes/ai-draft.ts` to mention the new category so the
AI proposes it consistently.
