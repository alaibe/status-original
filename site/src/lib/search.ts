import { Document } from 'flexsearch';

import { basePath } from '@/lib/site';

export type Result = {
  url: string;
  title: string;
  pageTitle?: string;
};

type Data = Array<{ url: string; sections: Array<[string, string | null, Array<string>]> }>;

let index: Promise<Document> | null = null;

function load() {
  index ??= fetch(`${basePath}/search.json`)
    .then((response) => response.json() as Promise<Data>)
    .then((data) => {
      let document = new Document({
        tokenize: 'full',
        document: { id: 'url', index: 'content', store: ['title', 'pageTitle'] },
        context: { resolution: 9, depth: 2, bidirectional: true },
      });
      for (let { url, sections } of data) {
        for (let [title, hash, content] of sections) {
          document.add({
            url: url + (hash ? `#${hash}` : ''),
            title,
            content: [title, ...content].join('\n'),
            pageTitle: hash ? sections[0][0] : '',
          });
        }
      }
      return document;
    });
  return index;
}

export async function search(
  query: string,
  options: { limit?: number } = {}
): Promise<Array<Result>> {
  let document = await load();
  let result = document.search(query, { ...options, enrich: true });
  if (result.length === 0) return [];
  return result[0].result.map((item: unknown) => {
    let doc = item as unknown as { id: string; doc: { title: string; pageTitle?: string } };
    return { url: doc.id, title: doc.doc.title, pageTitle: doc.doc.pageTitle || undefined };
  });
}
