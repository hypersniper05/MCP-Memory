// Updates the DSH market index (dsh-market.json) to point at a commit of this repository.
//
// The index format requires each version to pin an exact commit and carry its committer time
// (https://github.com/deepseek-ai/deepseek-harness — plugin market index format 1).
//
// Usage (from the repository root, after committing plugin changes):
//   node tools/update-market-index.mjs            # point at HEAD
//   node tools/update-market-index.mjs <sha40>    # point at a specific commit
// Then commit the updated dsh-market.json and push. The index file itself may point at the
// previous commit; only the plugin code must be present at the pinned commit.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'dsh-market.json')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

const commit = process.argv[2] ?? git('rev-parse', 'HEAD')
if (!/^[0-9a-f]{40}$/.test(commit)) {
  console.error(`not a full lowercase commit id: ${commit}`)
  process.exit(1)
}
const full = git('rev-parse', '--verify', `${commit}^{commit}`)
const publishTimestamp = Number(git('show', '-s', '--format=%ct', full))

const index = JSON.parse(readFileSync(file, 'utf8'))
for (const plugin of index.plugins) {
  for (const version of plugin.versions) {
    if (version.source.type !== 'git') continue
    version.source.commit = full
    version.publishTimestamp = publishTimestamp
  }
}
writeFileSync(file, JSON.stringify(index, null, 2) + '\n')
console.log(`dsh-market.json: pinned ${full} (${new Date(publishTimestamp * 1000).toISOString()})`)
