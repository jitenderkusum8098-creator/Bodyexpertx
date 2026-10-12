# Firebase customer phone login (separate preview)

This is an isolated login page on the `firebase-customer-login` branch. It does not change `main` or the existing website.

## Finish Firebase setup

1. Open Firebase Console > Project settings > General > Your apps > Bodyexpertx website.
2. Under SDK setup and configuration, select **Config**.
3. Open `firebase-customer-login.html` and replace `PASTE_YOUR_FIREBASE_API_KEY_HERE` with the exact `apiKey` value shown in your Firebase config. Do not paste service-account JSON, private keys, or auth tokens into the browser.
4. In Authentication > Sign-in method, confirm Phone is enabled.
5. In Authentication > Settings > Authorized domains, ensure the actual domain serving this page is listed. `localhost`, `bodyexpertx-44580.firebaseapp.com`, and `bodyexpertx-44580.web.app` are already shown in the project screenshots; add a different preview/production domain only if you will use it.
6. Firebase Phone Auth SMS quotas and billing rules apply. Test with Firebase fictional phone numbers first if configured, or send a real SMS only after reviewing billing/quota.

## What this prototype does

- Sends SMS OTP through Firebase Phone Authentication.
- Verifies the code and displays the signed-in phone number.
- Supports logging out.
- Does not write customer profile data to Supabase or Firebase Database yet.

## Important integration note

The existing customer profile table uses Supabase Auth identity and row-level security. A Firebase user is not automatically a Supabase Auth user. Do not connect this page to the existing profile table or merge this branch into `main` until a deliberate secure identity/data integration is implemented and tested. This page is a separate prototype, not a production deployment.
