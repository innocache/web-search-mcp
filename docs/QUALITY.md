# Content Extraction Quality Methodology

## Philosophy

The core objective of the extraction engine is to isolate the primary signal from a webpage while aggressively eliminating noise. A high-quality extraction must contain the main article or document content without the surrounding clutter that typically accompanies web pages.

The following elements are explicitly targeted for removal:
* Advertisements and sponsored content
* Site headers, footers, and global navigation
* Cookie banners and GDPR consent prompts
* Newsletter sign-up forms and "subscribe" calls-to-action
* Related links, "most popular" widgets, and recommended content
* Comment sections and social sharing buttons
* Overlays, popups, and paywall indicators

## Extraction Pipeline Quality Controls

The extraction process consists of five distinct stages, each contributing to the final quality of the output:

1.  **Stage 1: Browser Rendering**: The page is loaded in a headless browser to ensure JavaScript-driven content is fully rendered.
2.  **Stage 2: Pre-cleanup**: Structural noise is removed before the main extraction logic runs. This uses a three-tier selector system to prune known non-content elements.
3.  **Stage 3: Readability**: The Mozilla Readability algorithm is applied to isolate the most likely candidate for the main content body.
4.  **Stage 4: Post-cleanup**: Surviving noise that Readability might have missed is removed. This includes boilerplate phrases, link-dense blocks, empty nodes, and inline subscription forms.
5.  **Stage 5: Normalization**: Final whitespace cleaning and formatting are applied to ensure a consistent, readable output.

## Three-Tier Selector System

The pre-cleanup stage employs a hierarchical approach to element removal:

*   **Tier 1: Exact Selectors**: High-confidence selectors targeting specific functional elements like `nav`, `header`, `footer`, `.cookie-banner`, and specific ad provider iframes. These are removed unless they are nested within an `article` or `main` element.
*   **Tier 2: Partial Pattern Matching**: Moderate-confidence removal based on class or ID substrings (e.g., "sidebar", "promo", "social", "comment").
*   **Tier 3: Preserve Rules**: Explicit overrides that protect essential content structures such as `article`, `main`, `figure`, `code`, `blockquote`, and `table`, even if they match a removal pattern.

**Execution Order**:
1. Mark preserved elements (Tier 3)
2. Remove exact matches (Tier 1)
3. Remove partial matches (Tier 2)
4. Remove hidden elements (`display:none`, `visibility:hidden`, `aria-hidden="true"`)
5. Handle lazy-load images and SVG icons
6. Prune empty nodes
7. Clean temporary marks

## Quality Scoring Algorithm

The quality of each extraction is quantified using a multi-factor scoring algorithm defined in `qualityScore.ts`. The final score is a value between 0 and 100.

### Scoring Components

*   **Length (0-40 points)**:
    *   >= 5000 chars: 40 pts
    *   >= 2000 chars: 30 pts
    *   >= 1000 chars: 20 pts
    *   >= 300 chars: 10 pts
    *   >= 50 chars: 5 pts
*   **Sentence Density (0-25 points)**:
    *   Average sentence length 40-200 chars: 25 pts
    *   Average sentence length 20-300 chars: 12 pts
*   **Link Density Penalty (0 to -20 points)**:
    *   > 50% links: -20 pts
    *   > 30% links: -10 pts
    *   > 15% links: -5 pts
*   **Boilerplate Penalty (0 to -15 points)**:
    *   -3 points per boilerplate phrase match, capped at -15.
*   **Metadata Bonuses (0-20 points)**:
    *   Title present: +7 pts
    *   Byline present: +4 pts
    *   Excerpt present: +4 pts
    *   Date present: +5 pts
*   **Readability Success**: +15 points if the Readability algorithm successfully identified a content candidate.

### Score Interpretation

| Score | Label |
| :--- | :--- |
| >= 85 | excellent |
| >= 70 | good |
| >= 50 | fair |
| >= 30 | poor |
| < 30 | failed |

### Weak Extraction Conditions

An extraction is flagged as "weak" if any of the following are true:
*   Final score < 45
*   Text length < 300 characters AND link density > 35%
*   Total text length < 120 characters

## Boilerplate Detection

Boilerplate detection identifies non-content blocks that survive structural cleanup. A block (paragraph, list item, etc.) is considered boilerplate and removed if:
*   It contains 2 or more matches from the `BOILERPLATE_PHRASES` regex list.
*   It contains 1 match and the total text length is less than 100 characters.
*   The link density within the block exceeds 60% (for blocks under 200 characters).

Common patterns include "All rights reserved", "Privacy Policy", "Subscribe to our newsletter", and "Share on Twitter".

## Quality Audit Process

To maintain high extraction standards, a quality audit is performed against 12 Tier A URLs representing diverse page types (news, blogs, documentation, wikis, forums, and hub pages).

*   **Pass Threshold**: A score of >= 65 is required for article-type pages.
*   **Expected Failures**: Hub pages (indices) and paywalled/subscriber-only content are expected to return lower scores or be flagged as weak extractions.

The audit can be executed using the following command:
```bash
npx tsx scripts/run-quality-audit.mts
```

## Current Audit Results

| URL | Score | Status |
| :--- | :--- | :--- |
| AP News | 90 | Pass |
| BBC News | 93 | Pass |
| GitHub Blog | 100 | Pass |
| MDN Promise | 91 | Pass |
| Wikipedia (LLM) | 88 | Pass |
| Paul Graham | 81 | Pass |
| NYT homepage | 81 | Pass |
| Dev.to | 96 | Pass |
| Reddit (LocalLLaMA) | 70 | Pass |
| Medium (Freedium) | 81 | Pass |
| Reuters (index) | — | Expected fail (hub page) |
| Substack (Pragmatic Eng) | — | Expected fail (subscriber-only) |

## Improving Quality

Quality can be iteratively improved by:
1.  **Adding Selectors**: Update `src/extraction/selectorConfig.ts` to include new Tier 1 or Tier 2 selectors for emerging ad patterns or site-specific noise.
2.  **Adjusting Weights**: Modify the point values in `src/extraction/qualityScore.ts` to better reflect the importance of specific features (e.g., increasing the penalty for link density).
3.  **Refining Boilerplate**: Add new regex patterns to `BOILERPLATE_PHRASES` to catch recurring non-content text.
