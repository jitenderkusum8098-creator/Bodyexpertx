# Free test deployment (not for real customer data)

This is a separate demo deployment. It does not publish to or change the existing live website.

## Deploy
1. Sign in to Render and choose **New + → Blueprint**.
2. Connect the GitHub repository `jitenderkusum8098-creator/Bodyexpertx`.
3. Choose branch `custom-mobile-password-admin` if asked.
4. Render should detect `customer-system/render.yaml`. Review the service name and create it.
5. When prompted for `ADMIN_USERNAME`, enter a private admin username.
6. For `ADMIN_PASSWORD_HASH`, generate a bcrypt hash locally after installing dependencies:
   `node -e "require('bcryptjs').hash('YOUR-STRONG-ADMIN-PASSWORD',12).then(console.log)"`
   Put the resulting hash in the environment variable, never the plain password.
7. Render generates `SESSION_SECRET` from the blueprint. Keep it private.
8. Wait for deployment. Customer page is the service root URL; admin is `/admin.html`.

## Critical limitations
- Render free web services use an ephemeral filesystem. This blueprint stores SQLite under `/tmp`, so customer accounts and booking history can be lost when the service restarts/redeploys or sleeps. This is ONLY for trying the screens and basic flow; do not use real customer records.
- Free service availability/sleep behavior can change. A persistent disk generally requires a paid plan. Before taking real bookings, migrate the database to a persistent hosted PostgreSQL service and configure production-grade persistent sessions, backups, HTTPS, rate limiting and recovery.
- There is no SMS/phone verification by design. A mobile number is not proof of identity. For manual forgotten-password reset, verify the caller using a known booking detail before sharing a temporary password.
- This project is not connected to the existing website's booking form. Test bookings created here are only in this separate demo.
- Never commit admin passwords, hashes for a password you use elsewhere, database files, or session secrets to GitHub.
