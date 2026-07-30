import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

describe('Firebase server and client boundaries', () => {
  it('keeps Firebase Admin and Firestore out of the browser Firebase module', async () => {
    const clientModule = await readFile(
      path.join(projectRoot, 'lib/firebase/client.ts'),
      'utf8',
    );

    expect(clientModule).toContain("'use client'");
    expect(clientModule).not.toContain('firebase-admin');
    expect(clientModule).not.toContain("from 'firebase/firestore'");
  });

  it('marks every catalogue repository as server-only', async () => {
    const repositoryModules = await Promise.all([
      readFile(
        path.join(
          projectRoot,
          'lib/repositories/catalogue/CatalogueRepository.ts',
        ),
        'utf8',
      ),
      readFile(
        path.join(
          projectRoot,
          'lib/repositories/catalogue/CatalogueClaimRepository.ts',
        ),
        'utf8',
      ),
    ]);

    for (const repositoryModule of repositoryModules) {
      expect(repositoryModule.trimStart()).toMatch(
        /^import 'server-only';/,
      );
      expect(repositoryModule).toContain('firebase-admin/firestore');
    }
  });
});
