# BodyExpertX Customer System — starter

This is a separate, self-hosted Node.js app. It does not change the live GitHub Pages website and does not use Firebase/Supabase or SMS OTP.

## Features in this first starter
- Customer signup and login with mobile number + password (no phone verification).
- Passwords stored as bcrypt hashes, never readable by admin.
- Admin-only customer search, last login, completed massage count and booking history.
- Admin can mark bookings Booked, Completed or Cancelled.
- Admin can generate a one-time temporary password for a customer who calls after forgetting their password.
- SQLite database for a first trial.

## Important password rule
The admin cannot see the old password (secure systems do not store readable passwords). When a customer forgets it, search their mobile number and use **Reset password**. The temporary password appears once; give it to the caller and ask them to change it after login. Because this project intentionally has no phone verification, someone who knows a customer's number could try to impersonate them. For a safer manual process, ask a customer-specific booking detail before resetting.

## Run locally for a first trial
Requires Node.js 20+ and npm.

1. In this folder run `npm install`.
2. Create a bcrypt hash for your chosen admin password. Example: `node -e "require('bcryptjs').hash('CHOOSE-A-LONG-ADMIN-PASSWORD',12).then(console.log)"`
3. Set environment variables:
   - `ADMIN_USERNAME` — your admin username
   - `ADMIN_PASSWORD_HASH` — hash generated above
   - `SESSION_SECRET` — random secret at least 32 characters
   - `NODE_ENV=development`
4. Run `npm start`.
5. Open `http://localhost:3000` for customers and `http://localhost:3000/admin.html` for admin.

Do not put real customer data or deploy publicly until HTTPS, persistent disk/backups, production session storage, admin access controls, rate limits and hosting have been configured. The default Express session MemoryStore is for local testing only. Production deployment needs an HTTPS reverse proxy and a persistent database volume. This starter is not yet connected to the existing booking system.

## Live site protection
Keep this on its own branch. Do not merge to `main` until it has been tested and you explicitly approve.
