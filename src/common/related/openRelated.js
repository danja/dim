import path from 'path'
import VectorIndex from '../vectors/VectorIndex.js'
import RelatedIndex from './RelatedIndex.js'

/**
 * The related index next to the bookmark index: data/related.index (+ .json)
 * and data/related.state.json. Derived data — delete them and the next sync
 * rebuilds them.
 */
export async function openRelated ({ config, projectRoot, bookmarks, embeddings }) {
  const bookmarkPath = path.resolve(projectRoot, config.get('index.path'))
  const dir = path.dirname(bookmarkPath)
  const index = await VectorIndex.open({ dimension: config.get('embedding.dimension'), path: path.join(dir, 'related.index'), model: config.get('embedding.model') })
  return new RelatedIndex({ index, bookmarks, embeddings, statePath: path.join(dir, 'related.state.json') }).load()
}

export default openRelated
