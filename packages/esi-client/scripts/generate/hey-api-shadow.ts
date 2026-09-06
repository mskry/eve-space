import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkHeyApiShadowGeneration } from './hey-api.ts';

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const result = await checkHeyApiShadowGeneration();
  process.stdout.write(
    `Hey API shadow generation is deterministic: ${result.fileCount} files (${result.sha256}); ` +
      `${result.operationAccounting.generated} generated and ` +
      `${result.operationAccounting.reviewedExcluded} reviewed-excluded operations ` +
      `account for ${result.operationAccounting.source} source operations.\n`,
  );
}
