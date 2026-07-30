const maximumIndexedWords = 80;
const maximumPrefixesPerWord = 24;

export function normaliseSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-NG')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokeniseSearchText(value: string) {
  const normalisedValue = normaliseSearchText(value);

  return normalisedValue
    ? [...new Set(normalisedValue.split(' '))].slice(0, maximumIndexedWords)
    : [];
}

export function createSearchTokenProjection(values: readonly string[]) {
  const exactTokens = [
    ...new Set(values.flatMap((value) => tokeniseSearchText(value))),
  ].slice(0, maximumIndexedWords);
  const searchTokens = new Set<string>();

  for (const token of exactTokens) {
    searchTokens.add(token);

    const maximumPrefixLength = Math.min(
      token.length,
      maximumPrefixesPerWord,
    );

    for (
      let prefixLength = 2;
      prefixLength <= maximumPrefixLength;
      prefixLength += 1
    ) {
      searchTokens.add(token.slice(0, prefixLength));
    }
  }

  return {
    exactTokens,
    searchTokens: [...searchTokens].slice(0, 240),
  };
}

export function scoreCatalogueSearchResult(
  query: string,
  candidate: {
    title: string;
    exactTokens: readonly string[];
    searchTokens: readonly string[];
  },
) {
  const normalisedQuery = normaliseSearchText(query);
  const queryTokens = tokeniseSearchText(query);
  const normalisedTitle = normaliseSearchText(candidate.title);
  let score = 0;

  if (normalisedTitle === normalisedQuery) {
    score += 1_000;
  } else if (normalisedTitle.startsWith(normalisedQuery)) {
    score += 500;
  } else if (normalisedTitle.includes(normalisedQuery)) {
    score += 250;
  }

  for (const queryToken of queryTokens) {
    if (candidate.exactTokens.includes(queryToken)) {
      score += 80;
    } else if (candidate.searchTokens.includes(queryToken)) {
      score += 30;
    }
  }

  return score;
}
