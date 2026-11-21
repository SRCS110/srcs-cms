# One-time setup

Already done: Supabase project `srcs-cms` (ref `jhlnvcpfldlnraaoyhkz`, org Sync Race Studios, us-west-1) with tables, security and the `site-assets` bucket.

## 1. GitHub App (5 minutes)

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**

- Name: `SRCS CMS`
- Homepage URL: `https://cms.srcs.online`
- Webhook: uncheck **Active**
- Repository permissions:
  - Contents: **Read and write**
  - Commit statuses: **Read-only**
  - Deployments: **Read-only**
  - Metadata: **Read-only** (automatic)
- Where can this app be installed: **Only on this account**

Then:

1. Note the **App ID** at the top of the app page.
2. **Generate a private key** and keep the downloaded `.pem` file.
3. **Install App** → SRCS110 → **Only select repositories** → pick client site repos. The URL afterwards ends in `/installations/<number>`: that number is the **installation ID**.

Adding a new client site later = Install App → Configure → add that repo.

## 2. Vercel environment variables

I set the non-secret ones. You paste the two secrets in the `srcs-cms` project → Settings → Environment Variables (Production), type **Sensitive**:

- `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → secret key
- `GITHUB_APP_PRIVATE_KEY`: the full contents of the `.pem` file, including the BEGIN/END lines

Redeploy after adding them. `https://cms.srcs.online/api/health` shows `true` for both once configured.

## 3. Domain

Cloudflare DNS for `srcs.online`: add `CNAME cms → cname.vercel-dns.com`, **DNS only** (grey cloud).

## 4. Supabase Auth settings

Authentication → URL Configuration:
- Site URL: `https://cms.srcs.online`
- Redirect URLs: `https://cms.srcs.online/login.html**`

Authentication → Sign In / Providers → Email:
- **Allow new users to sign up: off** (people get in only by invitation)
- Email OTP expiration: 3600

Authentication → Emails → SMTP Settings → **Enable custom SMTP** (Supabase's built-in sender only delivers to your own team and a few per hour):
- Sender email `hello@srcs.online`, sender name `Sync Race Studios`
- Host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key

Authentication → Emails → Templates (optional but recommended): set the **Magic Link** subject to `Your sign-in link` and the **Invite user** subject to `You’re invited to edit your website`.

## 5. Make yourself an admin

Authentication → Users → **Invite user** → `admin@srcs.online`. Accept the email once, then tell Claude; it adds you to the `admins` table. Admins can edit every site and add client owners from the editor's **Team** panel.
