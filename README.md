# Bodyexpertx

Website refresh trigger: 2026-10-12. Published site source is maintained in this repository.

Site-wide card refresh trigger: 2026-10-12-compact-gold-cards-final-v2


## BodyExpertX cart standard

All new customer-facing Add to Cart flows must use the shared `bex-cart-system.js` helper and matching `#bex-universal-cart-system` styles. Add the script after the page's cart data and functions are declared, and keep booking/payment validation and backend payloads page-specific. Cart entries use `quantity` (default 1); line totals and booking totals must multiply unit price by quantity. The minus control removes an item when quantity reaches zero. Do not introduce a separate Remove-only cart UI. The female salon PRIME/LUXE v2 pages retain their image-led custom renderer but must preserve the same quantity behavior and compact stepper.
