import { describe, expect, it } from 'vitest';

import {
  createSearchTokenProjection,
  normaliseSearchText,
  scoreCatalogueSearchResult,
  tokeniseSearchText,
} from '@/lib/utils/catalogue/searchTokens';

describe('catalogue search projection', () => {
  it('normalises punctuation, casing, spacing, and diacritics', () => {
    expect(normaliseSearchText('  Élite POP—Paint  ')).toBe(
      'elite pop paint',
    );
    expect(tokeniseSearchText('POP paint, pop finish')).toEqual([
      'pop',
      'paint',
      'finish',
    ]);
  });

  it('creates bounded prefixes for partial product searches', () => {
    const projection = createSearchTokenProjection([
      'Signature POP Paint',
      'Interior ceiling finish',
    ]);

    expect(projection.exactTokens).toContain('signature');
    expect(projection.searchTokens).toContain('sig');
    expect(projection.searchTokens).toContain('signature');
    expect(projection.searchTokens).toContain('ceil');
    expect(projection.searchTokens.length).toBeLessThanOrEqual(240);
  });

  it('ranks an exact commercial title above a body-token match', () => {
    const exactCandidate = createSearchTokenProjection([
      'White Bond',
      'Interior adhesive',
    ]);
    const bodyCandidate = createSearchTokenProjection([
      'Project Finish',
      'Suitable for white bond applications',
    ]);

    expect(
      scoreCatalogueSearchResult('white bond', {
        title: 'White Bond',
        ...exactCandidate,
      }),
    ).toBeGreaterThan(
      scoreCatalogueSearchResult('white bond', {
        title: 'Project Finish',
        ...bodyCandidate,
      }),
    );
  });
});
