# my-notebook

Private notes app: static HTML/CSS/JS + Supabase JS v2 (CDN). No build step.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: Project URL + **publishable** key only (never a secret key)
- `setup.sql`: `public.notes` table + owner-only RLS

## Setup
1. Review `setup.sql`, then paste it into Supabase dashboard → SQL Editor → Run.
2. Serve the folder locally, e.g. `python3 -m http.server 8000`, and open http://localhost:8000.

## How to test
1. Sign up with user A → confirm email if required → sign in. Status shows "Signed in as …".
2. Create, edit, delete notes. Try a note containing `<img src=x onerror=alert(1)>`: it must show as plain text.
3. Sign out → status shows "Signed out"; the notes disappear.
4. Sign up/in as user B → user A's notes must not appear.
5. Error check: stop your network or break the URL in `config.js` → a red error box appears.
