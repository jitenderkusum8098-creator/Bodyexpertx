# BodyExpertX Android apps — install-and-test plan

## Non-negotiable constraints
- Preserve the current public customer website, therapist panel, Admin Panel, and Supabase project/backend.
- Black + silver + gold branding.
- Build separate Android packages for customers and therapists.
- Start with private test APKs; do not publish to Play Store yet.

## Prototype phase (current branch)
- Customer shell package: com.bodyexpertx.customer
- Therapist shell package: com.bodyexpertx.therapist
- Capacitor Android wrapper opens the existing website/panel. This validates APK installation and existing login/booking flows without duplicating or migrating data.
- GitHub Actions builds separate debug APKs and stores them as workflow artifacts for 14 days.

## Test checklist
1. Install each APK on Android.
2. Confirm app opens the correct existing URL.
3. Customer: sign in/book a test service; verify booking appears in the existing Admin Panel and Supabase data.
4. Therapist: sign in, Duty ON, receive a test job, accept/reject and verify the same booking status is reflected in the existing backend.
5. Check app background/foreground behavior and Android battery/notification permissions.

## Next phase before relying on background job alerts
- Implement native Android push via Firebase Cloud Messaging (FCM) and the existing Supabase therapist-push path, with high-priority notification channel, sound/vibration, and job deep-link/action.
- Verify notification delivery with the app backgrounded and screen locked. Website polling alone is not sufficient.
- Test notification permission on Android 13+, battery saver, logout, duplicate alerts, and accepted/cancelled jobs.

## Release phase
- Create signed release builds only after testing; store signing secrets must never be committed to this repository.
- Play Store publishing is out of scope until the owner approves it.
