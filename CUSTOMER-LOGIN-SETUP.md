# BodyExpertX Customer Login Setup

This is an isolated login addition on the `customer-login-setup` branch. The existing `main` branch and its website files have not been changed.

## Included

- `customer-login.html`: mobile number +91 OTP login page.
- Supabase Auth session persistence.
- A `customer_profiles` table with row-level security so each signed-in customer can access only their own profile.
- After OTP verification, the page returns the customer to `index.html?customer=1`.
- A guest-booking link remains available.

## Supabase project

The frontend uses the project's URL and public publishable key. A publishable key is designed to be visible in browser code; never put a Supabase service-role/secret key in this page.

## Required one-time phone OTP setup

Phone OTP cannot send real SMS until the Supabase project has phone authentication and an SMS provider configured.

1. Open the Supabase dashboard for project `myjstwbpmbrhaiwytpnq`.
2. Go to **Authentication → Sign In / Providers** (the exact label may vary).
3. Enable **Phone** sign-in and phone signups.
4. Configure an SMS provider such as Twilio, Twilio Verify, Vonage, or another provider supported by Supabase. Provider credentials are secret and must only be entered in Supabase settings, never committed to this repository.
5. In **Authentication → URL Configuration**, allow the website URL `https://jitenderkusum8098-creator.github.io` and the redirect path used by this project.
6. Test with a real phone number you control. SMS provider costs/rate limits may apply.

If phone auth/SMS is not configured, the login page will show a setup message instead of pretending login succeeded.

## Preview and publishing

The page is committed on `customer-login-setup`, not `main`. It is not live on the public website until a deployment/Pages source is configured. Keep `main` selected for production until you have reviewed and tested this branch.

## Next integration step

After the OTP flow is tested, add a small account/login control to the existing website navigation so that a successful login returns to the same website with customer options. This step has deliberately not modified `index.html` yet, to protect the current live site.
