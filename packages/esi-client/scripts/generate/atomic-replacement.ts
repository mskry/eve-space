import { randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import type { ReplacementPhase } from './generation-contracts.ts';
import { pathExists } from './internal/fs.ts';
import { assertGeneratedReplacementTargets } from './paths.ts';

export interface ReplacementFileSystem {
  /** Copies staged output next to its destination so the install step is a same-directory rename. */
  materializePath?: (source: string, destination: string) => Promise<void>;
  replacePath?: (source: string, destination: string, phase: ReplacementPhase) => Promise<void>;
  /** Removes a staged, backup, or rolled-back path. */
  removePath?: (path: string) => Promise<void>;
}

interface TransactionEntry {
  readonly backupPath: string;
  backedUp: boolean;
  readonly incomingPath: string;
  installed: boolean;
  readonly livePath: string;
}

/**
 * Installs staged output over the live tree as a transaction: if any target fails to install,
 * every target already installed is rolled back, so a failure during installation leaves the
 * working tree exactly as it was.
 *
 * Staged output is copied beside each destination before any live path is touched, so the
 * install itself is a same-directory rename and never depends on the staging directory sharing
 * a filesystem with the repository. Backup and incoming paths are dot-prefixed so a process
 * killed mid-transaction cannot leave residue that TypeScript's `src/**` include would compile.
 *
 * Once every target is installed the transaction has committed, and discarding the backups it
 * took is cleanup rather than part of the transaction. A cleanup failure still rejects so the
 * leftover paths are noticed, but the installed output stays in place and the error says so.
 */
export async function replaceGeneratedPathsAtomically(
  outputDirectory: string,
  projectRoot: string,
  targets: readonly string[],
  fileSystem: ReplacementFileSystem = {},
): Promise<void> {
  assertGeneratedReplacementTargets(targets);
  const materializePath = fileSystem.materializePath ?? copyPath;
  const replacePath = fileSystem.replacePath ?? renamePath;
  const removePath = fileSystem.removePath ?? removeRecursively;
  const transaction: TransactionEntry[] = [];
  let committed = false;
  let failure: unknown;

  try {
    await materializeIncomingPaths(
      outputDirectory,
      projectRoot,
      targets,
      transaction,
      materializePath,
    );
    await installReplacements(transaction, replacePath, removePath);
    committed = true;
  } catch (error) {
    failure = error;
  }

  const cleanupFailures = await cleanupTransactionPaths(transaction, removePath);
  if (failure && cleanupFailures.length > 0) {
    throw new AggregateError([failure, ...cleanupFailures], 'Replacement and cleanup failed', {
      cause: failure,
    });
  }
  if (failure) throw failure;
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      committed
        ? 'Generated output was installed, but replacement cleanup failed'
        : 'Replacement cleanup failed',
    );
  }
}

async function materializeIncomingPaths(
  outputDirectory: string,
  projectRoot: string,
  targets: readonly string[],
  transaction: TransactionEntry[],
  materializePath: (source: string, destination: string) => Promise<void>,
): Promise<void> {
  const transactionId = randomUUID();
  for (const target of targets) {
    const livePath = resolve(projectRoot, target);
    const parent = dirname(livePath);
    const name = basename(livePath);
    const entry: TransactionEntry = {
      backupPath: join(parent, `.${name}.esi-client-backup-${transactionId}`),
      backedUp: false,
      incomingPath: join(parent, `.${name}.esi-client-incoming-${transactionId}`),
      installed: false,
      livePath,
    };
    transaction.push(entry);
    await mkdir(parent, { recursive: true });
    await materializePath(join(outputDirectory, target), entry.incomingPath);
  }
}

async function installReplacements(
  transaction: TransactionEntry[],
  replacePath: (source: string, destination: string, phase: ReplacementPhase) => Promise<void>,
  removePath: (path: string) => Promise<void>,
): Promise<void> {
  try {
    for (const entry of transaction) {
      if (await pathExists(entry.livePath)) {
        await replacePath(entry.livePath, entry.backupPath, 'backup');
        entry.backedUp = true;
      }
      await replacePath(entry.incomingPath, entry.livePath, 'install');
      entry.installed = true;
    }
  } catch (error) {
    const rollbackFailures = await rollbackReplacements(transaction, replacePath, removePath);
    if (rollbackFailures.length > 0) {
      throw new AggregateError([error, ...rollbackFailures], 'Replacement and rollback failed', {
        cause: error,
      });
    }
    throw error;
  }

  // Every target installed, so the transaction has committed and its backups are now ordinary
  // debris. Clearing the flag hands them to the cleanup phase instead of failing the install.
  for (const entry of transaction) entry.backedUp = false;
}

async function rollbackReplacements(
  transaction: TransactionEntry[],
  replacePath: (source: string, destination: string, phase: ReplacementPhase) => Promise<void>,
  removePath: (path: string) => Promise<void>,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const entry of transaction.toReversed()) {
    try {
      if (entry.installed) {
        await removePath(entry.livePath);
        entry.installed = false;
      }
      if (entry.backedUp) {
        await replacePath(entry.backupPath, entry.livePath, 'restore');
        entry.backedUp = false;
      }
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

async function cleanupTransactionPaths(
  transaction: readonly TransactionEntry[],
  removePath: (path: string) => Promise<void>,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const entry of transaction) {
    try {
      await removePath(entry.incomingPath);
      // A backup still flagged here is the only surviving copy of the prior output.
      if (!entry.backedUp) await removePath(entry.backupPath);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

async function removeRecursively(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

async function copyPath(source: string, destination: string): Promise<void> {
  await cp(source, destination, { errorOnExist: true, force: false, recursive: true });
}

async function renamePath(source: string, destination: string): Promise<void> {
  await rename(source, destination);
}
