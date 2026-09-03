# Search Indexing Specification

## Purpose

Control which routes may be indexed by search engines, using a default-deny allowlist enforced server-side (authoritative, works without JS), mirrored client-side for defense-in-depth.

## Requirements

### Requirement: Default-deny X-Robots-Tag per path

The system MUST send `X-Robots-Tag: noindex, nofollow` on every HTTP response for every path except an explicit allowlist (`/`, `/entrar`). A path not on the allowlist MUST NOT become indexable by omission — new routes are noindex by default.

#### Scenario: Private group route stays noindex

- GIVEN a request to `/g/<id>`
- WHEN the server responds
- THEN the response header `X-Robots-Tag: noindex, nofollow` is present

#### Scenario: Ranking sub-route stays noindex

- GIVEN a request to `/g/<id>/ranking`
- WHEN the server responds
- THEN `X-Robots-Tag: noindex, nofollow` is present

#### Scenario: Join-invite route stays noindex

- GIVEN a request to `/join/<token>`
- WHEN the server responds
- THEN `X-Robots-Tag: noindex, nofollow` is present
- AND the token never appears in any canonical or Open Graph tag on an indexable page

#### Scenario: Create-group route stays noindex

- GIVEN a request to `/crear-grupo`
- WHEN the server responds
- THEN `X-Robots-Tag: noindex, nofollow` is present

#### Scenario: Hashed asset stays noindex (unallowlisted by path)

- GIVEN a request to `/assets/index-ab12cd34.js`
- WHEN the server responds
- THEN `X-Robots-Tag: noindex, nofollow` is present (asset paths are not on the allowlist)

#### Scenario: Unknown/future path is noindex by default

- GIVEN a request to a path with no route defined, e.g. `/whatever-new`
- WHEN the server responds (SPA catch-all)
- THEN `X-Robots-Tag: noindex, nofollow` is present — a new route can never become indexable by accident

#### Scenario: Landing is indexable

- GIVEN a request to `/`
- WHEN the server responds
- THEN no `X-Robots-Tag: noindex...` header is sent

#### Scenario: Login is indexable

- GIVEN a request to `/entrar`
- WHEN the server responds
- THEN no `X-Robots-Tag: noindex...` header is sent

### Requirement: robots.txt disallows private paths

`public/robots.txt` MUST exist and disallow crawling of every private path prefix, while allowing the root.

#### Scenario: robots.txt content

- GIVEN a crawler fetches `/robots.txt`
- WHEN it parses the response
- THEN it contains `User-agent: *`, `Allow: /`, `Disallow: /g/`, `Disallow: /join/`, `Disallow: /crear-grupo`

### Requirement: Client meta mirrors the server decision without weakening it

`index.html` MUST NOT carry a static `<meta name="robots">` tag, because the same file is served for every route (SPA catch-all) — a hardcoded tag would either wrongly block `/` or wrongly allow a private route for JS-less crawlers, who must rely solely on the header. A per-route client component MUST set/update `<meta name="robots">` to match the current route on every client-side navigation, defaulting to `noindex, nofollow` unless the route is on the allowlist.

#### Scenario: No static meta in raw HTML

- GIVEN a JS-less crawler fetches `/` or `/g/<id>` (identical `index.html`)
- WHEN it inspects the raw HTML
- THEN no `<meta name="robots" content="noindex...">` tag is present — only the HTTP header differs per route

#### Scenario: Client meta updates on SPA navigation into a private route

- GIVEN a user is on `/entrar` (indexable, no noindex meta)
- WHEN they navigate client-side to `/g/<id>` without a full reload
- THEN a `<meta name="robots" content="noindex, nofollow">` tag is added/updated to reflect the new route

#### Scenario: Client meta clears on SPA navigation back to an indexable route

- GIVEN a user is on `/g/<id>` (noindex meta present)
- WHEN they navigate client-side back to `/`
- THEN the noindex meta is removed or updated so the route is not marked noindex

### Requirement: Landing canonical and Open Graph tags carry no private data

The landing page MUST expose a canonical link and Open Graph tags that reference only the public site root, never a group ID, invite token, or other private identifier.

#### Scenario: Canonical and OG URL are the bare origin

- GIVEN the landing page `/`
- WHEN inspecting `<link rel="canonical">` and `<meta property="og:url">`
- THEN both equal the site root with no query string or path segment beyond `/`
