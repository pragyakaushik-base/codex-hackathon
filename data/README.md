# Mock Commerce Data

This directory contains structured dummy data for the Shopee shopping agent.

- `products.json`: Catalog items with searchable keywords, seller references, delivery speed, stock, product attributes, reasoning hints, compatibility, and bundle relationships.
- `sellers.json`: Seller quality signals for ranking and tradeoff explanations.
- `vouchers.json`: Category-aware discounts for checkout preview and savings tools.
- `users.json`: Demo users with preferences, household context, order history, and reorder signals.

The data is intentionally richer than the minimum schema in `docs/build-from-scratch.md` so commerce tools can answer with grounded reasoning:

- Search can match `keywords`, `description`, `attributes`, and `bestFor`.
- Ranking can use `rating`, `reviewCount`, `delivery`, `stock`, seller quality, and user preferences.
- Bundling can follow `bundleItems` and `compatibility.worksWith`.
- Product comparison can explain `bestFor` and `tradeoffs`.
- Reorder logic can use `users[].order_history` for beauty and grocery replenishment scenarios.
