# The Teeth Boutique — website

The public website of The Teeth Boutique (1933 W Irving Park Rd, Suite 1, Chicago, IL 60613), published at
https://www.theteethboutique.com with GitHub Pages.

| Path | What it is |
| --- | --- |
| `site/` | The 89 built pages, one folder per URL, plus `404.html`, `sitemap.xml`, `robots.txt`, `static/` (CSS, JS, logos, the four fillable PDFs), `CNAME` (the custom domain) and `.nojekyll`. This folder is published as is. |
| `site/patient-information/…` and the other legacy folders | 64 small pages, one per address of the old site, that send the visitor on to the new address (`tools/redirects.csv` lists them). GitHub Pages cannot send server-side 301s, so these pages do the job with an instant `meta refresh`, a `canonical` link to the new address and `noindex`. |
| `site/.htaccess`, `site/_redirects` | The same 64 redirects for an Apache or Netlify host. Not published here (the workflow leaves them out). |
| `tools/make_redirect_pages.py` | Regenerates the redirect pages from `tools/redirects.csv`. Run it from the repository root after changing the list. |
| `.github/workflows/pages.yml` | Publishes `site/` on every push to `main`, or from the Actions tab. |

The site's source kit (the page copy, the Jinja template, the build script and the Node/PostgreSQL backend)
lives in the private repository `TheTeethBoutique/TB-Site`. Rebuild there, then copy `dist/` over `site/`
here and run `tools/make_redirect_pages.py` again.

## What works without the backend

Every page is static. Three pages talk to the practice's own API at `https://api.theteethboutique.com`
(not yet deployed):

- `/book/` shows the booking form; when the API is unreachable it tells the visitor to call 773-857-2290.
- `/portal/` shows "The portal is briefly unavailable. Call 773-857-2290".
- `/staff/` asks for a staff token and is excluded from search engines by `robots.txt`.

Nothing else depends on it. Online payment in the portal stays off until a Stripe publishable key is added to
`site/portal/index.html` (see `server/FRONTEND_INTEGRATION.md` in the source kit).

## Going live (one-time)

Today the domain is registered at GoDaddy, its DNS is served by the old website vendor's nameservers
(`ns1.pbhsdns.com`, `ns2.pbhsdns.com`), and the old site answers on Cloudflare addresses. Email for the domain
is at Proton Mail and must keep working, so every mail record below is copied from the current zone.

1. **GitHub → this repository → Settings → Pages → Build and deployment → Source: GitHub Actions.** Then
   under Custom domain enter `www.theteethboutique.com` and save. (The `CNAME` file in `site/` sets the same
   value on every deploy.)
2. **Merge to `main`** (or run the workflow from the Actions tab). The site is then served at
   `https://m-dminus.github.io/The-Teeth-Boutique/` until the domain points here.
3. **GoDaddy → the domain → DNS → Nameservers → change to GoDaddy's default nameservers.** This takes the zone
   away from the old vendor. Before saving, confirm DNSSEC is off (it is, as of 2026-10-09: no DS record).
4. **GoDaddy → DNS records.** Delete whatever GoDaddy pre-fills for `@` and `www` (parking/forwarding records),
   then add exactly these:

   | Type | Name | Value | Why |
   | --- | --- | --- | --- |
   | A | `@` | `185.199.108.153` | GitHub Pages (apex → redirects to www) |
   | A | `@` | `185.199.109.153` | GitHub Pages |
   | A | `@` | `185.199.110.153` | GitHub Pages |
   | A | `@` | `185.199.111.153` | GitHub Pages |
   | AAAA | `@` | `2606:50c0:8000::153` | GitHub Pages (IPv6) |
   | AAAA | `@` | `2606:50c0:8001::153` | GitHub Pages (IPv6) |
   | AAAA | `@` | `2606:50c0:8002::153` | GitHub Pages (IPv6) |
   | AAAA | `@` | `2606:50c0:8003::153` | GitHub Pages (IPv6) |
   | CNAME | `www` | `m-dminus.github.io` | GitHub Pages (the site) |
   | MX | `@` | `mail.protonmail.ch` priority `10` | Proton Mail (current) |
   | MX | `@` | `mailsec.protonmail.ch` priority `20` | Proton Mail (current) |
   | TXT | `@` | `v=spf1 include:_spf.protonmail.ch ~all` | Proton Mail SPF (current) |
   | TXT | `@` | `protonmail-verification=a12b2ad03081292ce526fab7121fde9ac4b263b8` | Proton domain verification (current) |
   | TXT | `_dmarc` | `v=DMARC1; p=quarantine` | DMARC (current) |
   | CNAME | `protonmail._domainkey` | `protonmail.domainkey.dsbkb4uug2qelew7pepoigkawelyo6kf7hrde6z7lxeraxvo5gcxq.domains.proton.ch` | Proton DKIM (current) |
   | CNAME | `protonmail2._domainkey` | `protonmail2.domainkey.dsbkb4uug2qelew7pepoigkawelyo6kf7hrde6z7lxeraxvo5gcxq.domains.proton.ch` | Proton DKIM (current) |
   | CNAME | `protonmail3._domainkey` | `protonmail3.domainkey.dsbkb4uug2qelew7pepoigkawelyo6kf7hrde6z7lxeraxvo5gcxq.domains.proton.ch` | Proton DKIM (current) |

   Do not add a wildcard (`*`) record. The mail records are the ones the current zone answers with on
   2026-10-09; if the old vendor's zone holds other records (a subdomain for another service), ask them for a
   zone export before switching, because those would stop resolving.
5. **Wait for DNS**, then in GitHub → Settings → Pages tick **Enforce HTTPS** once it becomes available (GitHub
   issues the certificate itself; the option can take up to 24 hours to appear after DNS changes).
6. **Verify the domain in GitHub** (Settings → Pages → Verified domains for the account) by adding the TXT record
   GitHub shows there. This stops anyone else from pointing a GitHub Pages site at a subdomain of the domain.

To go back to the old site: switch the nameservers at GoDaddy back to `ns1.pbhsdns.com` / `ns2.pbhsdns.com`.

## Checks before launch

Serve `site/` with any static file server and browse it. A crawl of every internal link and asset from `/`
on 2026-10-09 found 0 broken links and 0 page errors and reached every page; every redirect page's target
exists; the JavaScript parses; the pages are 7-bit ASCII.
