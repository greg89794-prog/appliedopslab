# appliedopslab.com

A single static page for Applied Ops Lab: plain HTML and CSS, no JavaScript, no cookies, no tracking, no third-party requests. It is hosted on Cloudflare Pages' free tier.

```
src/                      Site source (copied to dist/ by the build)
  index.html              The page. <!--@name--> markers are filled in by the build.
  styles.css              All styles. The build renames it to styles.<hash>.css.
  404.html, favicon.svg, og-image.png, robots.txt, sitemap.xml
  _headers                Cloudflare Pages security and cache headers
  fonts/                  IBM Plex Sans (SIL Open Font License, licence included)
data/cutting-example.json The numbers behind Figure 1
scripts/build.mjs         Build and checks (no dependencies)
scripts/serve.mjs         Local preview server
```

## Local development

You need Node.js 18 or later. There is nothing to install: the project has no npm dependencies.

```sh
npm run dev        # build, then serve dist/ at http://localhost:8788
```

Rerun `npm run dev` after editing a file. There is no watch mode.

## Production build

```sh
npm run build      # writes dist/
```

The build stops with an error if any of these checks fail:

- **Figure 1's math.** Each bar's parts plus one 0.125 in kerf per cut, plus the offcut, must equal exactly 240 in. Both patterns must cut exactly the parts that were ordered. "Cut in the order received" must match what you get by cutting the orders in sequence and starting a new bar whenever the next part doesn't fit.
- **Links.** Every `#anchor` must exist, every local file must exist, and every `mailto:` must go to greg@appliedopslab.com. The page must load nothing from other sites.
- **Content rules.** The page must not contain percentages, pricing or trial language, testimonial phrasing, legal-entity suffixes such as LLC or Inc., or `<script>` tags.

To change the example, edit `data/cutting-example.json` and rebuild. The diagram and captions are regenerated from that file.

## Cloudflare Pages settings

| Setting                | Value           |
| ---------------------- | --------------- |
| Framework preset       | None            |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Root directory         | *(leave blank)* |
| Environment variables  | none needed     |

The Node version is pinned to 22 by `.node-version`. Everything here fits within the free plan: one static site, well under the build and file limits.

## Publishing to appliedopslab.com

Nothing here has been deployed. No DNS records were changed, and no accounts were connected.

### 1. Put the code on GitHub

```sh
git init
git add .
git commit -m "Applied Ops Lab site"
git branch -M main
git remote add origin https://github.com/<you>/appliedopslab-site.git   # create an empty repo first
git push -u origin main
```

`dist/` is gitignored, because Cloudflare builds the site itself.

### 2. Create the Pages project

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git**. (If the dashboard only offers Workers, look for the "Looking to deploy Pages?" link.)
2. Authorize GitHub and select the repository.
3. Enter the settings from the table above, then select **Save and Deploy**.
4. When the build finishes, open the `https://<project>.pages.dev` address and review the site. Preview addresses send a `noindex` header, so search engines skip them.

From then on, each push to `main` deploys automatically.

### 3. Attach appliedopslab.com

**First, protect email.** Before changing anything, open **DNS → Records** for the domain and note the existing MX, SPF (TXT starting with `v=spf1`), DKIM (TXT/CNAME under `*._domainkey`), and DMARC (TXT at `_dmarc`) records. Screenshot or export them. Leave them all in place. The website needs only the apex and `www` records.

1. Open the Pages project, then **Custom domains → Set up a custom domain**, and enter `appliedopslab.com`.
2. **If the domain's DNS is on Cloudflare** (the nameservers are `*.ns.cloudflare.com`), Cloudflare offers to create a proxied CNAME for the apex. Accept it. The apex then points to `<project>.pages.dev`, and no MX or TXT records are touched.
   - If an old A or AAAA record already exists for the apex (for example, a registrar parking page), Cloudflare asks before replacing it. Replace only that web record.
3. **If the DNS is at another provider**, Pages can't serve the bare apex unless the zone is on Cloudflare. Two options:
   - Move the domain's nameservers to Cloudflare. Add the site in Cloudflare first and confirm that its imported records include every MX, SPF, DKIM, and DMARC record from your notes. Only then switch nameservers at the registrar.
   - Or keep DNS where it is and serve the site on `www`: add a CNAME `www → <project>.pages.dev` there, then forward the apex to `https://www.appliedopslab.com` with the registrar's redirect feature. If you do this, change the canonical URL, `og:url`, sitemap, and robots.txt to `www`.
4. Wait for the domain's status in Pages to change to **Active**. This usually takes a few minutes, sometimes longer.

### 4. Redirect www to the canonical apex

1. In **Custom domains**, add `www.appliedopslab.com` too. This creates a `www` CNAME to the project, which handles TLS for that host.
2. In the zone, go to **Rules → Redirect Rules → Create rule**. Choose the "Redirect from WWW to root" template, or set it up by hand:
   - When incoming requests match: Hostname equals `www.appliedopslab.com`
   - Then: Dynamic redirect, expression `concat("https://appliedopslab.com", http.request.uri.path)`, status **301**, preserve query string.
3. Optionally, redirect `<project>.pages.dev` the same way. It's already `noindex`, so this isn't required.

### 5. Verify HTTPS and email

- **SSL/TLS → Overview**: set the mode to **Full (strict)**, and under **Edge Certificates** turn on **Always Use HTTPS**.
- In a browser, check that each of these ends at `https://appliedopslab.com/` with a valid padlock:
  - `https://appliedopslab.com`
  - `http://appliedopslab.com`
  - `https://www.appliedopslab.com/anything`, which should redirect to `https://appliedopslab.com/anything`
- From a terminal:
  ```sh
  curl -sI https://appliedopslab.com | head -1                # HTTP/2 200
  curl -sI https://www.appliedopslab.com | grep -i location   # https://appliedopslab.com/
  dig +short MX appliedopslab.com                             # same MX hosts as before
  dig +short TXT appliedopslab.com                            # SPF still present
  dig +short TXT _dmarc.appliedopslab.com                     # DMARC still present
  ```
- Send a test email to greg@appliedopslab.com and reply from it, to confirm delivery in both directions.
- Optional: submit `https://appliedopslab.com/sitemap.xml` in Google Search Console.

## Design notes

- **Tone.** A white page, charcoal text, and one navy accent, with IBM Plex Sans throughout. Plex was designed for engineering documentation, so it reads as technical without looking like a startup. It is served from this site, so no font service sees visitors.
- **Figure 1 is the centerpiece.** It is laid out like a drawing sheet, with a title block covering parts, stock, kerf, and offcut rules. Both patterns use the same three bars and leave the same 39.125 in of offcut. Cutting in order leaves three short pieces of scrap. Planning the set as a whole leaves a single 36.5 in remnant that can be reused. The figure makes its point without claiming a saving. On phones it switches to a compact version that labels parts by letter.
- **One motif, used sparingly.** A stock bar with saw cuts appears in the logo and the favicon.
- **No JavaScript.** "Share Your Experience" jumps to the contact section. "Send an Email" opens a draft with the subject "Cutting Optimization Research".
